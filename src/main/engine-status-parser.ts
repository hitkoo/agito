import {
  buildInitialRuntimeState,
  type CharacterRuntimeState,
  type NeedInputEvidence,
  type NeedInputReason,
} from '../shared/character-runtime-state'
import type { EngineType } from '../shared/types'

interface SemanticParser {
  ingestLine(line: string): void
  getState(): CharacterRuntimeState
  getMeta(): SemanticParserMeta
}

interface PendingNeedInputCandidate {
  reason: NeedInputReason
  engine: Extract<EngineType, 'claude-code' | 'codex'>
  anchorType: string
  anchorId?: string
  detectedAt: number
}

interface PendingCompletionCandidate {
  engine: Extract<EngineType, 'claude-code'>
  anchorType: string
  detectedAt: number
}

interface SemanticParserMeta {
  pendingNeedInputCandidate: PendingNeedInputCandidate | null
  pendingCompletionCandidate: PendingCompletionCandidate | null
}

interface ClaudeMessageBlock {
  type?: string
  text?: string
  id?: string
  name?: string
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

interface ClaudeRecord {
  timestamp?: string | number
  type?: string
  subtype?: string
  permissionMode?: string
  preventedContinuation?: boolean
  data?: {
    type?: string
    hookEvent?: string
  }
  toolUseID?: string
  parentToolUseID?: string
  message?: {
    role?: string
    stop_reason?: string | null
    content?: ClaudeMessageBlock[] | string
  }
  toolUseResult?: unknown
  error?: string
}

interface CodexMessagePart {
  type?: string
  text?: string
}

interface CodexRecord {
  type?: string
  payload?: {
    type?: string
    text?: string
    message?: string
    name?: string
    call_id?: string
    arguments?: string
    collaboration_mode_kind?: string
    collaboration_mode?: {
      mode?: string
    }
    role?: string
    phase?: string
    content?: CodexMessagePart[]
  }
}

function buildNeedInputEvidence(
  engine: Extract<EngineType, 'claude-code' | 'codex'>,
  strength: NeedInputEvidence['strength'],
  anchorType: string,
  anchorId?: string
): NeedInputEvidence {
  return {
    strength,
    engine,
    anchorType,
    anchorId,
    detectedAt: Date.now(),
  }
}

function buildPendingNeedInputCandidate(
  engine: Extract<EngineType, 'claude-code' | 'codex'>,
  reason: NeedInputReason,
  anchorType: string,
  detectedAt: number,
  anchorId?: string
): PendingNeedInputCandidate {
  return {
    reason,
    engine,
    anchorType,
    anchorId,
    detectedAt,
  }
}

function buildPendingCompletionCandidate(
  engine: Extract<EngineType, 'claude-code'>,
  anchorType: string,
  detectedAt: number
): PendingCompletionCandidate {
  return {
    engine,
    anchorType,
    detectedAt,
  }
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

function parseRecordTimestamp(value: string | number | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return Date.now()
}

function getCodexMessageText(parts: CodexMessagePart[] | undefined): string | null {
  if (!Array.isArray(parts)) return null
  const text = parts
    .map((part) => part.text ?? '')
    .join('\n')
    .trim()
  return text || null
}

function extractClaudeToolResultText(record: ClaudeRecord, block: ClaudeMessageBlock): string {
  if (typeof block.content === 'string') return block.content
  if (typeof record.toolUseResult === 'string') return record.toolUseResult
  return ''
}

function isClaudeApprovalPendingText(text: string): boolean {
  const normalized = text.toLowerCase()
  return (
    normalized.includes('requires approval') ||
    normalized.includes("haven't granted it yet") ||
    normalized.includes('have not granted it yet') ||
    normalized.includes('requested permissions to')
  )
}

function isClaudePermissionDeniedText(text: string): boolean {
  return text.toLowerCase().includes('permission for this tool use was denied')
}

function isClaudeUserInterruptText(text: string): boolean {
  const normalized = text.trim()
  return (
    normalized === '[Request interrupted by user]' ||
    normalized === '[Request interrupted by user for tool use]'
  )
}

function isClaudeToolUseRejectedText(text: string): boolean {
  const normalized = text.trim()
  return normalized.startsWith("The user doesn't want to proceed with this tool use.")
}

function hasClaudePlanArtifact(record: ClaudeRecord): boolean {
  if (!record.toolUseResult || typeof record.toolUseResult !== 'object') return false
  const value = record.toolUseResult as Record<string, unknown>
  if (typeof value.plan === 'string' && value.plan.trim()) return true
  return typeof value.filePath === 'string' && value.filePath.includes('/.claude/plans/')
}

function isClaudeRunningProgressType(dataType: string | undefined): boolean {
  return (
    dataType === 'agent_progress' ||
    dataType === 'bash_progress' ||
    dataType === 'mcp_progress'
  )
}

function isClaudeIgnoredProgressType(dataType: string | undefined): boolean {
  return (
    dataType === 'hook_progress' ||
    dataType === 'query_update' ||
    dataType === 'search_results_received'
  )
}

function isCodexPlanModeRecord(record: CodexRecord): boolean {
  if (record.type === 'event_msg' && record.payload?.collaboration_mode_kind) {
    return record.payload.collaboration_mode_kind === 'plan'
  }
  if (record.type === 'turn_context') {
    return record.payload?.collaboration_mode?.mode === 'plan'
  }
  return false
}

function messageContainsProposedPlan(record: CodexRecord): boolean {
  const text =
    record.payload?.message ??
    record.payload?.text ??
    getCodexMessageText(record.payload?.content)
  return typeof text === 'string' && text.includes('<proposed_plan>')
}

function createBaseParser(engine: EngineType): {
  state: CharacterRuntimeState
  setPreview: (preview: string | null | undefined) => void
  clearError: () => void
  clearNeedInput: () => void
  startTurnRunning: () => void
  startRunning: (toolName?: string | null) => void
  finishTool: () => void
  completeTurn: () => void
  setError: (message: string) => void
  setNeedInput: (reason: NeedInputReason, evidence: NeedInputEvidence) => void
} {
  const state = buildInitialRuntimeState({
    characterId: `parser:${engine}`,
    engine,
    sessionId: 'semantic-session',
  })

  return {
    state,
    setPreview(preview) {
      state.lastAssistantPreview = preview?.trim() || null
    },
    clearError() {
      state.lastError = null
    },
    clearNeedInput() {
      state.needsInput = false
      state.needsInputReason = null
      state.needsInputEvidence = null
      state.acknowledgedNeedInputAt = null
    },
    startTurnRunning() {
      state.lastError = null
      state.isRunning = true
      state.unreadDone = false
      state.activeToolName = null
      state.needsInput = false
      state.needsInputReason = null
      state.needsInputEvidence = null
      state.acknowledgedNeedInputAt = null
    },
    startRunning(toolName) {
      state.lastError = null
      state.isRunning = true
      state.unreadDone = false
      state.activeToolName = toolName ?? state.activeToolName
      state.needsInput = false
      state.needsInputReason = null
      state.needsInputEvidence = null
      state.acknowledgedNeedInputAt = null
    },
    finishTool() {
      state.activeToolName = null
    },
    completeTurn() {
      state.lastError = null
      state.isRunning = false
      state.activeToolName = null
      state.lastTurnEndedAt = Date.now()
      state.unreadDone = !state.needsInput
    },
    setError(message) {
      state.isRunning = false
      state.unreadDone = false
      state.needsInput = false
      state.needsInputReason = null
      state.needsInputEvidence = null
      state.acknowledgedNeedInputAt = null
      state.activeToolName = null
      state.lastError = message
    },
    setNeedInput(reason, evidence) {
      state.lastError = null
      state.isRunning = false
      state.unreadDone = false
      state.activeToolName = null
      state.needsInput = true
      state.needsInputReason = reason
      state.needsInputEvidence = evidence
      state.lastTurnEndedAt = Date.now()
    },
  }
}

export function createClaudeSemanticParser(): SemanticParser {
  const {
    state,
    setPreview,
    clearError,
    clearNeedInput,
    startTurnRunning,
    startRunning,
    finishTool,
    completeTurn,
    setError,
    setNeedInput,
  } = createBaseParser('claude-code')
  const activeTools = new Map<string, string>()
  let planModeActive = false
  let pendingPlanHandoffCandidate: { sourceToolUseId?: string } | null = null
  let pendingNeedInputCandidate: PendingNeedInputCandidate | null = null
  let pendingCompletionCandidate: PendingCompletionCandidate | null = null
  let sawAssistantActivityThisTurn = false

  const clearPendingNeedInputCandidate = (toolUseId?: string | null): void => {
    if (!pendingNeedInputCandidate) return
    if (!toolUseId || !pendingNeedInputCandidate.anchorId || pendingNeedInputCandidate.anchorId === toolUseId) {
      pendingNeedInputCandidate = null
    }
  }

  const clearPendingCompletionCandidate = (): void => {
    pendingCompletionCandidate = null
  }

  return {
    ingestLine(line: string): void {
      let record: ClaudeRecord
      try {
        record = JSON.parse(line) as ClaudeRecord
      } catch {
        return
      }

      if (typeof record.permissionMode === 'string') {
        planModeActive = record.permissionMode === 'plan'
      }

      if (record.error) {
        pendingPlanHandoffCandidate = null
        pendingNeedInputCandidate = null
        pendingCompletionCandidate = null
        sawAssistantActivityThisTurn = false
        setError(record.error)
        return
      }

      if (record.type === 'progress') {
        const progressType = record.data?.type
        const progressToolUseId = record.toolUseID ?? record.parentToolUseID

        if (progressType === 'hook_progress') {
          if (record.data?.hookEvent === 'PreToolUse') {
            clearPendingCompletionCandidate()
            const progressToolName = progressToolUseId ? activeTools.get(progressToolUseId) : null
            const isApprovalHeuristicExempt =
              progressToolName === 'Task' || progressToolName === 'AskUserQuestion'
            if (progressToolName && !isApprovalHeuristicExempt) {
              pendingNeedInputCandidate = buildPendingNeedInputCandidate(
                'claude-code',
                'approval',
                'pre_tool_use',
                parseRecordTimestamp(record.timestamp),
                progressToolUseId ?? undefined
              )
            }
          } else {
            clearPendingNeedInputCandidate(progressToolUseId)
          }
          return
        }

        if (!state.needsInput && isClaudeRunningProgressType(progressType)) {
          clearPendingCompletionCandidate()
          clearPendingNeedInputCandidate(progressToolUseId)
          const progressToolName =
            (progressToolUseId ? activeTools.get(progressToolUseId) : null) ??
            state.activeToolName ??
            undefined
          startRunning(progressToolName)
          return
        }
        if (isClaudeIgnoredProgressType(progressType)) {
          return
        }
        console.warn('[agito] Unknown Claude progress type', progressType ?? '<missing>')
        return
      }

      if (record.type === 'assistant') {
        pendingNeedInputCandidate = null
        clearPendingCompletionCandidate()
        const blocks = Array.isArray(record.message?.content) ? record.message.content : []
        const text = blocks
          .filter((block) => block.type === 'text' && block.text)
          .map((block) => block.text ?? '')
          .join('\n')
          .trim()
        const hasToolUseBlock = blocks.some((block) => block.type === 'tool_use')

        if (pendingPlanHandoffCandidate) {
          if (record.message?.stop_reason === 'end_turn' && !hasToolUseBlock) {
            pendingPlanHandoffCandidate = null
            setNeedInput(
              'plan_handoff',
              buildNeedInputEvidence('claude-code', 'contextual', 'plan_artifact')
            )
            state.lastAssistantPreview = text || state.lastAssistantPreview
            return
          }
          pendingPlanHandoffCandidate = null
        }

        const hasThinkingBlock = blocks.some((block) => block.type === 'thinking')
        if (text || hasThinkingBlock || hasToolUseBlock) {
          sawAssistantActivityThisTurn = true
        }
        if (text) {
          setPreview(text)
          startRunning()
        } else if (hasThinkingBlock && !state.needsInput) {
          startRunning()
        }

        for (const block of blocks) {
          if (block.type !== 'tool_use' || !block.id) continue
          activeTools.set(block.id, block.name ?? 'tool')
          if (block.name === 'AskUserQuestion') {
            setPreview(null)
            setNeedInput(
              'question',
              buildNeedInputEvidence('claude-code', 'explicit', 'ask_user_question', block.id)
            )
            continue
          }
          if (block.name === 'ExitPlanMode') {
            setPreview(null)
            setNeedInput(
              'plan_handoff',
              buildNeedInputEvidence('claude-code', 'explicit', 'exit_plan_mode', block.id)
            )
            pendingPlanHandoffCandidate = null
            continue
          }
          setPreview(null)
          startRunning(block.name ?? 'tool')
        }

        if (record.message?.stop_reason === 'end_turn') {
          clearPendingCompletionCandidate()
          completeTurn()
          sawAssistantActivityThisTurn = false
          return
        }

        if (
          text &&
          !hasToolUseBlock &&
          record.message?.stop_reason === null &&
          !state.needsInput &&
          !state.lastError
        ) {
          pendingCompletionCandidate = buildPendingCompletionCandidate(
            'claude-code',
            'null_stop_text',
            parseRecordTimestamp(record.timestamp)
          )
        }
        return
      }

      if (record.type === 'system' && record.subtype === 'stop_hook_summary') {
        if (
          pendingCompletionCandidate &&
          record.preventedContinuation === false &&
          !state.lastError &&
          !state.needsInput
        ) {
          clearPendingCompletionCandidate()
          completeTurn()
          sawAssistantActivityThisTurn = false
          return
        }
        clearPendingCompletionCandidate()
        return
      }

      if (record.type === 'system' && record.subtype === 'turn_duration') {
        if (
          sawAssistantActivityThisTurn &&
          !state.lastError &&
          !state.needsInput
        ) {
          clearPendingCompletionCandidate()
          completeTurn()
          sawAssistantActivityThisTurn = false
        }
        return
      }

      if (record.type !== 'user') return

      const content = record.message?.content
      const blocks = Array.isArray(content) ? content : []
      const userText =
        typeof content === 'string'
          ? content.trim()
          : blocks
              .filter((block) => block.type === 'text' && block.text)
              .map((block) => block.text ?? '')
              .join('\n')
              .trim()
      const hasToolResultBlock = blocks.some((block) => block.type === 'tool_result')
      if (userText && !hasToolResultBlock && isClaudeUserInterruptText(userText)) {
        activeTools.clear()
        finishTool()
        pendingPlanHandoffCandidate = null
        pendingNeedInputCandidate = null
        pendingCompletionCandidate = null
        sawAssistantActivityThisTurn = false
        setError('interrupted_by_user')
        return
      }

      clearError()
      if (userText && !hasToolResultBlock) {
        sawAssistantActivityThisTurn = false
        clearPendingCompletionCandidate()
        startTurnRunning()
        finishTool()
        pendingPlanHandoffCandidate = null
        pendingNeedInputCandidate = null
        return
      }

      for (const block of blocks) {
        if (block.type !== 'tool_result') continue
        const toolUseId = block.tool_use_id ?? block.id
        const toolName = toolUseId ? activeTools.get(toolUseId) : null
        if (toolUseId) {
          activeTools.delete(toolUseId)
        }
        clearPendingNeedInputCandidate(toolUseId)

        const text = extractClaudeToolResultText(record, block)

        if (block.is_error && isClaudeToolUseRejectedText(text)) {
          pendingNeedInputCandidate = null
          pendingPlanHandoffCandidate = null
          pendingCompletionCandidate = null
          sawAssistantActivityThisTurn = false
          setError('interrupted_by_user')
          continue
        }

        if (toolName === 'AskUserQuestion') {
          clearNeedInput()
        }
        if (toolName === 'ExitPlanMode') {
          clearNeedInput()
        }

        if (planModeActive && hasClaudePlanArtifact(record) && toolName !== 'ExitPlanMode') {
          clearNeedInput()
          pendingPlanHandoffCandidate = { sourceToolUseId: toolUseId ?? undefined }
        }

        if (block.is_error && isClaudeApprovalPendingText(text)) {
          pendingNeedInputCandidate = null
          setNeedInput(
            'approval',
            buildNeedInputEvidence('claude-code', 'explicit', 'permission_request', toolUseId)
          )
        } else if (block.is_error && isClaudePermissionDeniedText(text)) {
          pendingNeedInputCandidate = null
          clearNeedInput()
        }
      }

      if (activeTools.size === 0) {
        finishTool()
      }
    },
    getState(): CharacterRuntimeState {
      return { ...state }
    },
    getMeta(): SemanticParserMeta {
      return {
        pendingNeedInputCandidate: pendingNeedInputCandidate
          ? { ...pendingNeedInputCandidate }
          : null,
        pendingCompletionCandidate: pendingCompletionCandidate
          ? { ...pendingCompletionCandidate }
          : null,
      }
    },
  }
}

export function createCodexSemanticParser(): SemanticParser {
  const {
    state,
    setPreview,
    clearError,
    clearNeedInput,
    startTurnRunning,
    startRunning,
    finishTool,
    completeTurn,
    setError,
    setNeedInput,
  } = createBaseParser('codex')
  const activeCalls = new Set<string>()
  let planModeActive = false
  let sawProposedPlan = false

  return {
    ingestLine(line: string): void {
      let record: CodexRecord
      try {
        record = JSON.parse(line) as CodexRecord
      } catch {
        return
      }

      if (record.type === 'turn_context') {
        planModeActive = isCodexPlanModeRecord(record)
      }

      const payloadType = record.payload?.type

      if (record.type === 'event_msg' && payloadType === 'task_started') {
        planModeActive = isCodexPlanModeRecord(record)
        sawProposedPlan = false
        startRunning()
        return
      }

      if (record.type === 'event_msg' && payloadType === 'agent_message') {
        setPreview(record.payload?.message ?? record.payload?.text ?? null)
        startRunning()
        return
      }

      if (record.type === 'event_msg' && payloadType === 'task_complete') {
        if (planModeActive && sawProposedPlan && activeCalls.size === 0) {
          setNeedInput(
            'plan_handoff',
            buildNeedInputEvidence('codex', 'contextual', 'proposed_plan')
          )
          return
        }
        completeTurn()
        return
      }

      if (record.type === 'event_msg' && payloadType === 'turn_aborted') {
        setError('turn_aborted')
        return
      }

      if (
        record.type === 'response_item' &&
        record.payload?.type === 'message' &&
        record.payload.role === 'user'
      ) {
        startTurnRunning()
        return
      }

      if (
        record.type === 'response_item' &&
        record.payload?.type === 'message' &&
        record.payload.role === 'assistant'
      ) {
        const text =
          record.payload.message ??
          record.payload.text ??
          getCodexMessageText(record.payload.content)
        if (text) {
          setPreview(text)
        }
        if (messageContainsProposedPlan(record)) {
          sawProposedPlan = true
        }
        return
      }

      if (record.type === 'response_item' && payloadType === 'function_call') {
        const callId = record.payload?.call_id
        if (callId) activeCalls.add(callId)
        const args = parseJsonObject(record.payload?.arguments)

        if (record.payload?.name === 'request_user_input') {
          setNeedInput(
            'question',
            buildNeedInputEvidence('codex', 'explicit', 'request_user_input', callId)
          )
          return
        }

        if (
          record.payload?.name === 'exec_command' &&
          args?.sandbox_permissions === 'require_escalated'
        ) {
          setNeedInput(
            'approval',
            buildNeedInputEvidence('codex', 'explicit', 'require_escalated', callId)
          )
          return
        }

        startRunning(record.payload?.name ?? 'tool')
        return
      }

      if (
        record.type === 'response_item' &&
        (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output')
      ) {
        clearError()
        const callId = record.payload?.call_id
        if (callId) activeCalls.delete(callId)
        if (callId && state.needsInputEvidence?.anchorId === callId) {
          startTurnRunning()
        }
        if (activeCalls.size === 0) {
          finishTool()
        }
      }
    },
    getState(): CharacterRuntimeState {
      return { ...state }
    },
    getMeta(): SemanticParserMeta {
      return {
        pendingNeedInputCandidate: null,
        pendingCompletionCandidate: null,
      }
    },
  }
}
