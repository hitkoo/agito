import type { EngineType } from './types'

export type CharacterMarkerStatus =
  | 'no_session'
  | 'idle'
  | 'running'
  | 'need_input'
  | 'need_approval'
  | 'done'
  | 'error_disconnected'

export interface CharacterRuntimeState {
  characterId: string
  engine: EngineType
  sessionId: string | null
  markerStatus: CharacterMarkerStatus
  expectedAlive: boolean
  ptyAlive: boolean
  isRunning: boolean
  needsInput: boolean
  needsApproval: boolean
  unreadDone: boolean
  activeToolName: string | null
  activeToolKind: string | null
  attentionActive: boolean
  lastTurnEndedAt: number | null
  lastAssistantPreview: string | null
  lastError: string | null
}

interface BuildInitialRuntimeStateOptions {
  characterId: string
  engine: EngineType
  sessionId?: string | null
}

const INPUT_REQUEST_PATTERNS = [
  /\?\s*$/u,
  /\bwhich\b/iu,
  /\bwhat should\b/iu,
  /\bhow should\b/iu,
  /\bwhat would you like\b/iu,
  /\bplease choose\b/iu,
  /\blet me know\b/iu,
  /\bshould i\b/iu,
]

export function buildInitialRuntimeState(
  options: BuildInitialRuntimeStateOptions
): CharacterRuntimeState {
  const sessionId = options.sessionId ?? null
  return {
    characterId: options.characterId,
    engine: options.engine,
    sessionId,
    markerStatus: sessionId ? 'idle' : 'no_session',
    expectedAlive: false,
    ptyAlive: false,
    isRunning: false,
    needsInput: false,
    needsApproval: false,
    unreadDone: false,
    activeToolName: null,
    activeToolKind: null,
    attentionActive: false,
    lastTurnEndedAt: null,
    lastAssistantPreview: null,
    lastError: null,
  }
}

export function classifyAssistantPreview(
  preview: string | null | undefined
): 'need_input' | 'done' {
  const text = (preview ?? '').trim()
  if (!text) return 'done'
  if (INPUT_REQUEST_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'need_input'
  }
  return 'done'
}

export function deriveCharacterMarkerStatus(
  state: CharacterRuntimeState
): CharacterMarkerStatus {
  if (
    state.sessionId !== null &&
    state.expectedAlive &&
    !state.ptyAlive &&
    state.lastError
  ) {
    return 'error_disconnected'
  }

  if (state.sessionId === null) return 'no_session'
  if (state.needsApproval) return 'need_approval'
  if (state.needsInput) return 'need_input'
  if (state.isRunning) return 'running'
  if (state.unreadDone) return 'done'
  if (state.expectedAlive && !state.ptyAlive) return 'error_disconnected'
  return 'idle'
}

export function shouldClearDoneOnAttention(input: {
  unreadDone: boolean
  wasAttentionActive: boolean
  isAttentionActive: boolean
}): boolean {
  return input.unreadDone && !input.wasAttentionActive && input.isAttentionActive
}

export function shouldScheduleDoneAutoClear(input: {
  unreadDone: boolean
  isAttentionActive: boolean
}): boolean {
  return input.unreadDone && input.isAttentionActive
}
