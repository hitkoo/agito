import { existsSync, readFileSync, readdirSync, statSync, watchFile, unwatchFile } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import {
  buildInitialRuntimeState,
  deriveCharacterMarkerStatus,
  shouldClearDoneOnAttention,
  shouldScheduleDoneAutoClear,
  type CharacterRuntimeState,
} from '../shared/character-runtime-state'
import type { Character, EngineType } from '../shared/types'
import {
  createClaudeSemanticParser,
  createCodexSemanticParser,
} from './engine-status-parser'

const IDLE_FALLBACK_MS = 2000
const DONE_AUTO_CLEAR_MS = 2000
const TRANSCRIPT_POLL_MS = 500

const APPROVAL_PATTERNS = [
  /\bapproval\b/iu,
  /\bapprove\b/iu,
  /\bpermission\b/iu,
  /\bconfirm\b/iu,
]

const INPUT_PATTERNS = [
  /\bpress enter\b/iu,
  /\bwhich\b/iu,
  /\bwhat should\b/iu,
  /\bhow should\b/iu,
  /\blet me know\b/iu,
  /\?\s*$/u,
]

interface SemanticParser {
  ingestLine(line: string): void
  getState(): CharacterRuntimeState
}

interface RuntimeEntry {
  state: CharacterRuntimeState
  parser: SemanticParser | null
  transcriptPath: string | null
  transcriptPollTimer: ReturnType<typeof setInterval> | null
  idleTimer: ReturnType<typeof setTimeout> | null
  doneTimer: ReturnType<typeof setTimeout> | null
  fileOffset: number
  lineBuffer: string
  heuristicNeedsApproval: boolean
  heuristicNeedsInput: boolean
}

interface StartRuntimeSessionOptions {
  characterId: string
  engine: EngineType
  sessionId: string
  workingDirectory: string
}

interface RuntimeUpdateListener {
  (state: CharacterRuntimeState): void
}

function createParser(engine: EngineType): SemanticParser {
  return engine === 'claude-code'
    ? createClaudeSemanticParser()
    : createCodexSemanticParser()
}

function createEntry(characterId: string, engine: EngineType, sessionId: string | null): RuntimeEntry {
  return {
    state: buildInitialRuntimeState({
      characterId,
      engine,
      sessionId,
    }),
    parser: sessionId ? createParser(engine) : null,
    transcriptPath: null,
    transcriptPollTimer: null,
    idleTimer: null,
    doneTimer: null,
    fileOffset: 0,
    lineBuffer: '',
    heuristicNeedsApproval: false,
    heuristicNeedsInput: false,
  }
}

export class CharacterRuntimeService {
  private readonly entries = new Map<string, RuntimeEntry>()
  private readonly listeners = new Set<RuntimeUpdateListener>()

  onUpdate(listener: RuntimeUpdateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  syncCharacters(characters: Character[]): void {
    const ids = new Set(characters.map((character) => character.id))

    for (const character of characters) {
      const existing = this.entries.get(character.id)
      if (!existing) {
        this.entries.set(
          character.id,
          createEntry(character.id, character.engine, character.currentSessionId)
        )
      } else {
        existing.state.engine = character.engine
        if (character.currentSessionId === null && existing.state.sessionId !== null) {
          this.stopSession(character.id)
        } else if (character.currentSessionId !== null && existing.state.sessionId === null) {
          existing.state.sessionId = character.currentSessionId
          this.updateState(existing)
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

    entry.state.sessionId = options.sessionId
    entry.state.expectedAlive = true
    entry.state.ptyAlive = true
    entry.state.isRunning = true
    entry.state.markerStatus = deriveCharacterMarkerStatus(entry.state)

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

  handlePtyData(characterId: string, data: string): void {
    const entry = this.entries.get(characterId)
    if (!entry) return

    entry.state.expectedAlive = entry.state.sessionId !== null
    entry.state.ptyAlive = true

    const approvalDetected = APPROVAL_PATTERNS.some((pattern) => pattern.test(data))
    const inputDetected = !approvalDetected && INPUT_PATTERNS.some((pattern) => pattern.test(data))

    if (approvalDetected) {
      entry.heuristicNeedsApproval = true
      entry.heuristicNeedsInput = false
      entry.state.isRunning = false
      this.clearIdleTimer(entry)
    } else if (inputDetected) {
      entry.heuristicNeedsInput = true
      entry.heuristicNeedsApproval = false
      entry.state.isRunning = false
      this.clearIdleTimer(entry)
    } else if (!entry.state.needsApproval && !entry.state.needsInput) {
      entry.state.isRunning = true
      entry.state.unreadDone = false
      this.scheduleIdleFallback(entry)
    }

    this.syncFromParser(entry)
  }

  handleUserInput(characterId: string): void {
    const entry = this.entries.get(characterId)
    if (!entry) return

    entry.heuristicNeedsApproval = false
    entry.heuristicNeedsInput = false
    entry.state.needsApproval = false
    entry.state.needsInput = false
    entry.state.unreadDone = false
    entry.state.isRunning = entry.state.sessionId !== null
    entry.state.lastError = null
    this.scheduleIdleFallback(entry)
    this.updateState(entry)
  }

  handlePtyExit(characterId: string, exitCode: number): void {
    const entry = this.entries.get(characterId)
    if (!entry) return

    this.clearIdleTimer(entry)
    entry.state.ptyAlive = false
    entry.state.isRunning = false
    if (entry.state.sessionId !== null) {
      entry.state.expectedAlive = true
      entry.state.lastError = exitCode === 0 ? 'disconnected' : `exit ${exitCode}`
    } else {
      entry.state.expectedAlive = false
    }
    this.updateState(entry)
  }

  setAttention(characterId: string, attentionActive: boolean): void {
    const entry = this.entries.get(characterId)
    if (!entry) return

    const wasAttentionActive = entry.state.attentionActive
    entry.state.attentionActive = attentionActive

    if (
      shouldClearDoneOnAttention({
        unreadDone: entry.state.unreadDone,
        wasAttentionActive,
        isAttentionActive: attentionActive,
      })
    ) {
      entry.state.unreadDone = false
      entry.state.lastTurnEndedAt = null
    }

    this.syncDoneAutoClear(entry)
    this.updateState(entry)
  }

  private getOrCreateEntry(characterId: string, engine: EngineType): RuntimeEntry {
    const existing = this.entries.get(characterId)
    if (existing) return existing

    const entry = createEntry(characterId, engine, null)
    this.entries.set(characterId, entry)
    return entry
  }

  private resetEntry(entry: RuntimeEntry, sessionId: string, engine: EngineType): void {
    this.clearTimers(entry)
    this.detachTranscript(entry)
    entry.parser = createParser(engine)
    entry.state = buildInitialRuntimeState({
      characterId: entry.state.characterId,
      engine,
      sessionId,
    })
    entry.fileOffset = 0
    entry.lineBuffer = ''
    entry.heuristicNeedsApproval = false
    entry.heuristicNeedsInput = false
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

  private syncFromParser(entry: RuntimeEntry): void {
    const parserState = entry.parser?.getState()
    if (!parserState) {
      this.updateState(entry)
      return
    }

    entry.state.isRunning = parserState.isRunning
    entry.state.activeToolName = parserState.activeToolName
    entry.state.activeToolKind = parserState.activeToolKind
    entry.state.lastAssistantPreview = parserState.lastAssistantPreview
    entry.state.lastTurnEndedAt = parserState.lastTurnEndedAt
    entry.state.lastError = parserState.lastError ?? entry.state.lastError
    entry.state.needsApproval = entry.heuristicNeedsApproval
    entry.state.needsInput = entry.heuristicNeedsInput || parserState.needsInput
    entry.state.unreadDone =
      !entry.state.needsApproval &&
      !entry.state.needsInput &&
      parserState.unreadDone

    this.syncDoneAutoClear(entry)
    this.updateState(entry)
  }

  private syncDoneAutoClear(entry: RuntimeEntry): void {
    if (
      shouldScheduleDoneAutoClear({
        unreadDone: entry.state.unreadDone,
        isAttentionActive: entry.state.attentionActive,
      })
    ) {
      if (entry.doneTimer) return
      entry.doneTimer = setTimeout(() => {
        entry.doneTimer = null
        if (!entry.state.unreadDone || !entry.state.attentionActive) return
        entry.state.unreadDone = false
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

  private scheduleIdleFallback(entry: RuntimeEntry): void {
    this.clearIdleTimer(entry)
    entry.idleTimer = setTimeout(() => {
      entry.idleTimer = null
      if (entry.state.needsApproval || entry.state.needsInput || entry.state.unreadDone) return
      entry.state.isRunning = false
      this.updateState(entry)
    }, IDLE_FALLBACK_MS)
  }

  private clearIdleTimer(entry: RuntimeEntry): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
      entry.idleTimer = null
    }
  }

  private clearTimers(entry: RuntimeEntry): void {
    this.clearIdleTimer(entry)
    if (entry.doneTimer) {
      clearTimeout(entry.doneTimer)
      entry.doneTimer = null
    }
    if (entry.transcriptPollTimer) {
      clearInterval(entry.transcriptPollTimer)
      entry.transcriptPollTimer = null
    }
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
      this.syncFromParser(entry)
    } catch {
      // keep fallback PTY-driven status
    }
  }

  private startTranscriptPolling(
    entry: RuntimeEntry,
    engine: EngineType,
    sessionId: string,
    workingDirectory: string
  ): void {
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
    engine: EngineType,
    sessionId: string,
    workingDirectory: string
  ): string | null {
    if (engine === 'claude-code') {
      const encodedDir = workingDirectory.replace(/\//g, '-')
      const directPath = join(homedir(), '.claude', 'projects', encodedDir, `${sessionId}.jsonl`)
      if (existsSync(directPath)) return directPath

      const projectRoot = join(homedir(), '.claude', 'projects')
      if (!existsSync(projectRoot)) return null
      for (const entry of readdirSync(projectRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const filePath = join(projectRoot, entry.name, `${sessionId}.jsonl`)
        if (existsSync(filePath)) return filePath
      }
      return null
    }

    const codexRoots = [
      join(homedir(), '.codex', 'sessions'),
      join(homedir(), '.codex', 'archived_sessions'),
    ]
    for (const root of codexRoots) {
      if (!existsSync(root)) continue
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
        if (entry.name.includes(sessionId)) {
          return join(root, entry.name)
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
