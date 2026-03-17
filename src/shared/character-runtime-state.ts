import type { EngineType } from './types'

export type CharacterMarkerStatus =
  | 'no_session'
  | 'idle'
  | 'running'
  | 'need_input'
  | 'done'
  | 'error'

export interface CharacterRuntimeState {
  characterId: string
  engine: EngineType | null
  sessionId: string | null
  markerStatus: CharacterMarkerStatus
  isRunning: boolean
  needsInput: boolean
  unreadDone: boolean
  activeToolName: string | null
  attentionActive: boolean
  lastTurnEndedAt: number | null
  lastAssistantPreview: string | null
  lastError: string | null
}

interface BuildInitialRuntimeStateOptions {
  characterId: string
  engine: EngineType | null
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
  /\bwaiting for your\b/iu,
  /\bconfirmation\b/iu,
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
    isRunning: false,
    needsInput: false,
    unreadDone: false,
    activeToolName: null,
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
  if (state.sessionId === null) return 'no_session'
  if (state.lastError) return 'error'
  if (state.needsInput) return 'need_input'
  if (state.isRunning) return 'running'
  if (state.unreadDone) return 'done'
  return 'idle'
}

export function getCharacterMarkerStatus(
  runtimeState: Pick<CharacterRuntimeState, 'markerStatus'> | null | undefined,
  sessionId: string | null | undefined
): CharacterMarkerStatus {
  if (runtimeState?.markerStatus) return runtimeState.markerStatus
  return sessionId ? 'idle' : 'no_session'
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
