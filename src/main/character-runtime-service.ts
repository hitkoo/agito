import { existsSync, readFileSync, readdirSync, watchFile, unwatchFile } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import {
  buildInitialRuntimeState,
  deriveCharacterMarkerStatus,
  hasVisibleNeedInput,
  shouldAcknowledgeNeedInputOnAttention,
  shouldClearDoneOnAttention,
  shouldScheduleDoneAutoClear,
  type CharacterRuntimeState,
} from '../shared/character-runtime-state'
import type { Character, EngineType, SessionMapping } from '../shared/types'
import {
  createClaudeSemanticParser,
  createCodexSemanticParser,
} from './engine-status-parser'

const DONE_AUTO_CLEAR_MS = 2000
const TRANSCRIPT_POLL_MS = 500

interface SemanticParser {
  ingestLine(line: string): void
  getState(): CharacterRuntimeState
  getMeta(): {
    pendingNeedInputCandidate: {
      reason: 'approval' | 'question' | 'plan_handoff'
      engine: 'claude-code' | 'codex'
      anchorType: string
      anchorId?: string
      detectedAt: number
    } | null
    pendingCompletionCandidate: {
      engine: 'claude-code'
      anchorType: string
      detectedAt: number
    } | null
  }
}

interface RuntimeEntry {
  state: CharacterRuntimeState
  parser: SemanticParser | null
  transcriptPath: string | null
  transcriptPollTimer: ReturnType<typeof setInterval> | null
  doneTimer: ReturnType<typeof setTimeout> | null
  approvalTimer: ReturnType<typeof setTimeout> | null
  completionTimer: ReturnType<typeof setTimeout> | null
  approvalCandidate: SemanticParser['getMeta'] extends () => infer T
    ? T extends { pendingNeedInputCandidate: infer C }
      ? C
      : never
    : never
  approvalEvidence: CharacterRuntimeState['needsInputEvidence']
  completionCandidate: SemanticParser['getMeta'] extends () => infer T
    ? T extends { pendingCompletionCandidate: infer C }
      ? C
      : never
    : never
  completionTurnEndedAt: number | null
  consumedDoneTurnEndedAt: number | null
  fileOffset: number
  lineBuffer: string
}

interface StartRuntimeSessionOptions {
  characterId: string
  engine: EngineType | null
  sessionId: string
  workingDirectory: string
}

interface RuntimeUpdateListener {
  (state: CharacterRuntimeState): void
}

function createParser(engine: EngineType | null): SemanticParser | null {
  if (engine === null) return null
  return engine === 'claude-code'
    ? createClaudeSemanticParser()
    : createCodexSemanticParser()
}

function createEntry(characterId: string, engine: EngineType | null, sessionId: string | null): RuntimeEntry {
  return {
    state: buildInitialRuntimeState({
      characterId,
      engine,
      sessionId,
    }),
    parser: sessionId ? createParser(engine) : null,
    transcriptPath: null,
    transcriptPollTimer: null,
    doneTimer: null,
    approvalTimer: null,
    completionTimer: null,
    approvalCandidate: null,
    approvalEvidence: null,
    completionCandidate: null,
    completionTurnEndedAt: null,
    consumedDoneTurnEndedAt: null,
    fileOffset: 0,
    lineBuffer: '',
  }
}

export class CharacterRuntimeService {
  private readonly entries = new Map<string, RuntimeEntry>()
  private readonly listeners = new Set<RuntimeUpdateListener>()
  private readonly homeDirectory: string
  private readonly approvalHeuristicDelayMs: number
  private readonly completionHeuristicDelayMs: number

  constructor(options?: {
    homeDirectory?: string
    approvalHeuristicDelayMs?: number
    completionHeuristicDelayMs?: number
  }) {
    this.homeDirectory = options?.homeDirectory ?? homedir()
    this.approvalHeuristicDelayMs = options?.approvalHeuristicDelayMs ?? 7000
    this.completionHeuristicDelayMs = options?.completionHeuristicDelayMs ?? 10000
  }

  onUpdate(listener: RuntimeUpdateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  syncCharacters(characters: Character[], sessions: SessionMapping[] = []): void {
    const ids = new Set(characters.map((character) => character.id))
    const sessionsById = new Map(sessions.map((session) => [session.sessionId, session]))

    for (const character of characters) {
      const existing = this.entries.get(character.id)
      if (!existing) {
        const entry = createEntry(character.id, character.engine, character.currentSessionId)
        this.entries.set(character.id, entry)
        this.syncTranscriptBinding(
          entry,
          character.engine,
          character.currentSessionId,
          sessionsById.get(character.currentSessionId ?? '')
        )
      } else {
        existing.state.engine = character.engine
        if (character.currentSessionId === null && existing.state.sessionId !== null) {
          this.stopSession(character.id)
        } else if (character.currentSessionId !== existing.state.sessionId) {
          this.rebindSession(existing, character.currentSessionId, character.engine)
          this.syncTranscriptBinding(
            existing,
            character.engine,
            character.currentSessionId,
            sessionsById.get(character.currentSessionId ?? '')
          )
          this.updateState(existing)
        } else {
          this.syncTranscriptBinding(
            existing,
            character.engine,
            character.currentSessionId,
            sessionsById.get(character.currentSessionId ?? '')
          )
        }
      }
    }

    for (const [characterId] of this.entries) {
      if (!ids.has(characterId)) {
        this.disposeEntry(characterId)
      }
    }
  }

  getAllStates(): CharacterRuntimeState[] {
    return Array.from(this.entries.values(), (entry) => ({ ...entry.state }))
  }

  getState(characterId: string): CharacterRuntimeState | null {
    return this.entries.get(characterId)?.state ?? null
  }

  startSession(options: StartRuntimeSessionOptions): void {
    const entry = this.getOrCreateEntry(options.characterId, options.engine)
    this.resetEntry(entry, options.sessionId, options.engine)

    const transcriptPath = this.resolveTranscriptPath(
      options.engine,
      options.sessionId,
      options.workingDirectory
    )
    if (transcriptPath) {
      this.attachTranscript(entry, transcriptPath)
    } else {
      this.startTranscriptPolling(entry, options.engine, options.sessionId, options.workingDirectory)
    }

    this.emit(entry.state)
  }

  stopSession(characterId: string): void {
    const entry = this.entries.get(characterId)
    if (!entry) return

    this.clearTimers(entry)
    this.detachTranscript(entry)
    entry.parser = null
    entry.state = buildInitialRuntimeState({
      characterId,
      engine: entry.state.engine,
    })
    this.emit(entry.state)
  }

  setAttention(characterId: string, attentionActive: boolean): void {
    const entry = this.entries.get(characterId)
    if (!entry) return

    const wasAttentionActive = entry.state.attentionActive
    const hadVisibleNeedInput = hasVisibleNeedInput(entry.state)
    entry.state.attentionActive = attentionActive

    if (
      shouldClearDoneOnAttention({
        unreadDone: entry.state.unreadDone,
        wasAttentionActive,
        isAttentionActive: attentionActive,
      })
    ) {
      entry.consumedDoneTurnEndedAt = entry.state.lastTurnEndedAt
      entry.state.unreadDone = false
      entry.state.lastTurnEndedAt = null
    }

    if (entry.state.lastError && !wasAttentionActive && attentionActive) {
      entry.state.lastError = null
    }

    if (
      hadVisibleNeedInput &&
      shouldAcknowledgeNeedInputOnAttention({
        needsInput: entry.state.needsInput,
        wasAttentionActive,
        isAttentionActive: attentionActive,
      })
    ) {
      entry.state.acknowledgedNeedInputAt = Date.now()
    }

    this.syncDoneAutoClear(entry)
    this.updateState(entry)
  }

  private getOrCreateEntry(characterId: string, engine: EngineType | null): RuntimeEntry {
    const existing = this.entries.get(characterId)
    if (existing) return existing

    const entry = createEntry(characterId, engine, null)
    this.entries.set(characterId, entry)
    return entry
  }

  private resetEntry(entry: RuntimeEntry, sessionId: string, engine: EngineType | null): void {
    this.clearTimers(entry)
    this.detachTranscript(entry)
    entry.parser = createParser(engine)
    entry.state = buildInitialRuntimeState({
      characterId: entry.state.characterId,
      engine,
      sessionId,
    })
    entry.approvalCandidate = null
    entry.approvalEvidence = null
    entry.completionCandidate = null
    entry.completionTurnEndedAt = null
    entry.fileOffset = 0
    entry.lineBuffer = ''
  }

  private syncTranscriptBinding(
    entry: RuntimeEntry,
    engine: EngineType | null,
    sessionId: string | null,
    sessionMapping?: SessionMapping
  ): void {
    if (!sessionId || entry.transcriptPath || entry.transcriptPollTimer || !sessionMapping || engine === null) {
      return
    }

    const transcriptPath = this.resolveTranscriptPath(
      engine,
      sessionId,
      sessionMapping.workingDirectory
    )
    if (transcriptPath) {
      this.attachTranscript(entry, transcriptPath)
      return
    }

    this.startTranscriptPolling(entry, engine, sessionId, sessionMapping.workingDirectory)
  }

  private rebindSession(
    entry: RuntimeEntry,
    sessionId: string | null,
    engine: EngineType | null
  ): void {
    this.clearTimers(entry)
    this.detachTranscript(entry)
    entry.parser = sessionId ? createParser(engine) : null
    entry.state = buildInitialRuntimeState({
      characterId: entry.state.characterId,
      engine,
      sessionId,
    })
    entry.consumedDoneTurnEndedAt = null
    entry.completionCandidate = null
    entry.completionTurnEndedAt = null
    entry.fileOffset = 0
    entry.lineBuffer = ''
  }

  private updateState(entry: RuntimeEntry): void {
    entry.state.markerStatus = deriveCharacterMarkerStatus(entry.state)
    this.emit(entry.state)
  }

  private emit(state: CharacterRuntimeState): void {
    const snapshot = { ...state }
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  private syncFromParser(
    entry: RuntimeEntry,
    options: { suppressUnreadDone?: boolean } = {}
  ): void {
    const parserState = entry.parser?.getState()
    const parserMeta = entry.parser?.getMeta()
    if (!parserState) {
      this.updateState(entry)
      return
    }

    this.syncApprovalHeuristic(entry, parserMeta?.pendingNeedInputCandidate ?? null)
    this.syncCompletionHeuristic(entry, parserMeta?.pendingCompletionCandidate ?? null)

    const acknowledgedNeedInputAt = entry.state.acknowledgedNeedInputAt
    const heuristicNeedInput =
      !parserState.needsInput && entry.approvalEvidence?.strength === 'heuristic'
        ? entry.approvalEvidence
        : null
    const effectiveNeedsInput = parserState.needsInput || Boolean(heuristicNeedInput)
    const parserDoneTurnEndedAt = parserState.lastTurnEndedAt
    const heuristicDoneTurnEndedAt =
      !parserState.unreadDone &&
      !effectiveNeedsInput &&
      !parserState.lastError &&
      entry.completionTurnEndedAt !== null
        ? entry.completionTurnEndedAt
        : null
    const effectiveDoneTurnEndedAt = parserDoneTurnEndedAt ?? heuristicDoneTurnEndedAt
    const effectiveUnreadDone = parserState.unreadDone || heuristicDoneTurnEndedAt !== null

    if (options.suppressUnreadDone && !effectiveNeedsInput && effectiveUnreadDone) {
      entry.consumedDoneTurnEndedAt = effectiveDoneTurnEndedAt
    }

    const hasConsumedCurrentDone =
      effectiveUnreadDone &&
      effectiveDoneTurnEndedAt !== null &&
      entry.consumedDoneTurnEndedAt !== null &&
      effectiveDoneTurnEndedAt === entry.consumedDoneTurnEndedAt

    entry.state.isRunning = parserState.isRunning
    entry.state.activeToolName = parserState.activeToolName
    entry.state.lastAssistantPreview = parserState.lastAssistantPreview
    entry.state.lastTurnEndedAt = effectiveDoneTurnEndedAt
    entry.state.lastError = parserState.lastError
    entry.state.needsInput = effectiveNeedsInput
    entry.state.needsInputReason = parserState.needsInput
      ? parserState.needsInputReason
      : heuristicNeedInput
        ? 'approval'
        : null
    entry.state.needsInputEvidence = parserState.needsInput
      ? parserState.needsInputEvidence
      : heuristicNeedInput
    entry.state.acknowledgedNeedInputAt = effectiveNeedsInput ? acknowledgedNeedInputAt : null
    entry.state.unreadDone =
      !hasConsumedCurrentDone &&
      !effectiveNeedsInput &&
      effectiveUnreadDone

    if (heuristicNeedInput) {
      entry.state.isRunning = false
      entry.state.activeToolName = null
      entry.state.unreadDone = false
    }

    if (heuristicDoneTurnEndedAt !== null) {
      entry.state.isRunning = false
      entry.state.activeToolName = null
    }

    this.syncDoneAutoClear(entry)
    this.updateState(entry)
  }

  private syncApprovalHeuristic(
    entry: RuntimeEntry,
    candidate: RuntimeEntry['approvalCandidate']
  ): void {
    if (!candidate || candidate.reason !== 'approval' || candidate.engine !== 'claude-code') {
      this.clearApprovalHeuristic(entry)
      return
    }

    const current = entry.approvalCandidate
    const isSameCandidate =
      current?.anchorId === candidate.anchorId &&
      current?.anchorType === candidate.anchorType &&
      current?.detectedAt === candidate.detectedAt

    entry.approvalCandidate = candidate

    if (isSameCandidate) {
      return
    }

    this.clearApprovalTimer(entry)
    entry.approvalEvidence = null

    const elapsedMs = Math.max(0, Date.now() - candidate.detectedAt)
    const remainingMs = this.approvalHeuristicDelayMs - elapsedMs

    if (remainingMs <= 0) {
      this.fireApprovalHeuristic(entry, candidate)
      return
    }

    entry.approvalTimer = setTimeout(() => {
      entry.approvalTimer = null
      const latest = entry.approvalCandidate
      if (
        !latest ||
        latest.anchorId !== candidate.anchorId ||
        latest.anchorType !== candidate.anchorType ||
        latest.detectedAt !== candidate.detectedAt
      ) {
        return
      }
      this.fireApprovalHeuristic(entry, latest)
    }, remainingMs)
  }

  private fireApprovalHeuristic(
    entry: RuntimeEntry,
    candidate: NonNullable<RuntimeEntry['approvalCandidate']>
  ): void {
    entry.approvalEvidence = {
      strength: 'heuristic',
      engine: 'claude-code',
      anchorType: 'pre_tool_use_timeout',
      anchorId: candidate.anchorId,
      detectedAt: Date.now(),
    }
    this.syncFromParser(entry)
  }

  private syncCompletionHeuristic(
    entry: RuntimeEntry,
    candidate: RuntimeEntry['completionCandidate']
  ): void {
    if (!candidate || candidate.engine !== 'claude-code') {
      this.clearCompletionHeuristic(entry)
      return
    }

    const current = entry.completionCandidate
    const isSameCandidate =
      current?.anchorType === candidate.anchorType &&
      current?.detectedAt === candidate.detectedAt

    entry.completionCandidate = candidate

    if (isSameCandidate) {
      return
    }

    this.clearCompletionTimer(entry)
    entry.completionTurnEndedAt = null

    const elapsedMs = Math.max(0, Date.now() - candidate.detectedAt)
    const remainingMs = this.completionHeuristicDelayMs - elapsedMs

    if (remainingMs <= 0) {
      entry.completionTurnEndedAt = Date.now()
      return
    }

    entry.completionTimer = setTimeout(() => {
      entry.completionTimer = null
      const latest = entry.completionCandidate
      if (
        !latest ||
        latest.anchorType !== candidate.anchorType ||
        latest.detectedAt !== candidate.detectedAt
      ) {
        return
      }
      entry.completionTurnEndedAt = Date.now()
      this.syncFromParser(entry)
    }, remainingMs)
  }

  private syncDoneAutoClear(entry: RuntimeEntry): void {
    const hasTransientState = entry.state.unreadDone || Boolean(entry.state.lastError)
    if (
      shouldScheduleDoneAutoClear({
        unreadDone: hasTransientState,
        isAttentionActive: entry.state.attentionActive,
      })
    ) {
      if (entry.doneTimer) return
      entry.doneTimer = setTimeout(() => {
        entry.doneTimer = null
        if ((!entry.state.unreadDone && !entry.state.lastError) || !entry.state.attentionActive) return
        entry.consumedDoneTurnEndedAt = entry.state.lastTurnEndedAt
        entry.state.unreadDone = false
        entry.state.lastError = null
        entry.state.lastTurnEndedAt = null
        this.updateState(entry)
      }, DONE_AUTO_CLEAR_MS)
      return
    }

    if (entry.doneTimer) {
      clearTimeout(entry.doneTimer)
      entry.doneTimer = null
    }
  }

  private clearTimers(entry: RuntimeEntry): void {
    if (entry.doneTimer) {
      clearTimeout(entry.doneTimer)
      entry.doneTimer = null
    }
    this.clearApprovalHeuristic(entry)
    this.clearCompletionHeuristic(entry)
    if (entry.transcriptPollTimer) {
      clearInterval(entry.transcriptPollTimer)
      entry.transcriptPollTimer = null
    }
  }

  private clearApprovalTimer(entry: RuntimeEntry): void {
    if (entry.approvalTimer) {
      clearTimeout(entry.approvalTimer)
      entry.approvalTimer = null
    }
  }

  private clearApprovalHeuristic(entry: RuntimeEntry): void {
    this.clearApprovalTimer(entry)
    entry.approvalCandidate = null
    entry.approvalEvidence = null
  }

  private clearCompletionTimer(entry: RuntimeEntry): void {
    if (entry.completionTimer) {
      clearTimeout(entry.completionTimer)
      entry.completionTimer = null
    }
  }

  private clearCompletionHeuristic(entry: RuntimeEntry): void {
    this.clearCompletionTimer(entry)
    entry.completionCandidate = null
    entry.completionTurnEndedAt = null
  }

  private attachTranscript(entry: RuntimeEntry, transcriptPath: string): void {
    entry.transcriptPath = transcriptPath
    this.readTranscript(entry, true)
    watchFile(transcriptPath, { interval: TRANSCRIPT_POLL_MS }, () => {
      this.readTranscript(entry)
    })
  }

  private detachTranscript(entry: RuntimeEntry): void {
    if (entry.transcriptPath) {
      try {
        unwatchFile(entry.transcriptPath)
      } catch {
        // ignore
      }
    }
    entry.transcriptPath = null
    entry.fileOffset = 0
    entry.lineBuffer = ''
  }

  private readTranscript(entry: RuntimeEntry, fromStart = false): void {
    if (!entry.transcriptPath || !existsSync(entry.transcriptPath) || !entry.parser) return

    try {
      const fileText = readFileSync(entry.transcriptPath, 'utf-8')
      if (fromStart) {
        entry.fileOffset = 0
        entry.lineBuffer = ''
      }
      const nextText = fileText.slice(entry.fileOffset)
      if (!nextText) return
      entry.fileOffset = fileText.length
      const lines = (entry.lineBuffer + nextText).split('\n')
      entry.lineBuffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        entry.parser.ingestLine(line)
      }
      this.syncFromParser(entry, { suppressUnreadDone: fromStart })
    } catch {
      // ignore transcript read errors and keep the last semantic state
    }
  }

  private startTranscriptPolling(
    entry: RuntimeEntry,
    engine: EngineType | null,
    sessionId: string,
    workingDirectory: string
  ): void {
    if (engine === null) return
    entry.transcriptPollTimer = setInterval(() => {
      const transcriptPath = this.resolveTranscriptPath(engine, sessionId, workingDirectory)
      if (!transcriptPath) return
      if (entry.transcriptPollTimer) {
        clearInterval(entry.transcriptPollTimer)
        entry.transcriptPollTimer = null
      }
      this.attachTranscript(entry, transcriptPath)
    }, TRANSCRIPT_POLL_MS)
  }

  private resolveTranscriptPath(
    engine: EngineType | null,
    sessionId: string,
    workingDirectory: string
  ): string | null {
    if (engine === null) return null
    if (engine === 'claude-code') {
      const encodedDir = workingDirectory.replace(/\//g, '-')
      const directPath = join(this.homeDirectory, '.claude', 'projects', encodedDir, `${sessionId}.jsonl`)
      if (existsSync(directPath)) return directPath

      const projectRoot = join(this.homeDirectory, '.claude', 'projects')
      if (!existsSync(projectRoot)) return null
      for (const entry of readdirSync(projectRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const filePath = join(projectRoot, entry.name, `${sessionId}.jsonl`)
        if (existsSync(filePath)) return filePath
      }
      return null
    }

    return this.findCodexTranscriptPath(sessionId)
  }

  private findCodexTranscriptPath(sessionId: string): string | null {
    const codexRoots = [
      join(this.homeDirectory, '.codex', 'sessions'),
      join(this.homeDirectory, '.codex', 'archived_sessions'),
    ]

    for (const root of codexRoots) {
      const match = this.findTranscriptPathRecursive(root, sessionId)
      if (match) return match
    }

    return null
  }

  private findTranscriptPathRecursive(root: string, sessionId: string): string | null {
    if (!existsSync(root)) return null

    const stack = [root]
    while (stack.length > 0) {
      const current = stack.pop()
      if (!current) continue

      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const nextPath = join(current, entry.name)
        if (entry.isDirectory()) {
          stack.push(nextPath)
          continue
        }

        if (entry.isFile() && entry.name.endsWith('.jsonl') && entry.name.includes(sessionId)) {
          return nextPath
        }
      }
    }

    return null
  }

  private disposeEntry(characterId: string): void {
    const entry = this.entries.get(characterId)
    if (!entry) return
    this.clearTimers(entry)
    this.detachTranscript(entry)
    this.entries.delete(characterId)
  }
}
