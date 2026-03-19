import type { EngineType } from './types'

export type CharacterMarkerStatus =
  | 'no_session'
  | 'idle'
  | 'running'
  | 'unknown'
  | 'need_input'
  | 'done'
  | 'error'

export type NeedInputReason = 'question' | 'approval' | 'plan_handoff'

export interface NeedInputEvidence {
  strength: 'explicit' | 'contextual' | 'heuristic'
  engine: Extract<EngineType, 'claude-code' | 'codex'>
  anchorType: string
  anchorId?: string
  detectedAt: number
}

export interface CharacterRuntimeState {
  characterId: string
  engine: EngineType | null
  sessionId: string | null
  hasLiveRuntime: boolean
  markerStatus: CharacterMarkerStatus
  isRunning: boolean
  isUnknown: boolean
  needsInput: boolean
  unreadDone: boolean
  activeToolName: string | null
  attentionActive: boolean
  lastTurnEndedAt: number | null
  lastRunningActivityAt: number | null
  lastAssistantPreview: string | null
  lastError: string | null
  needsInputReason: NeedInputReason | null
  needsInputEvidence: NeedInputEvidence | null
  acknowledgedNeedInputAt: number | null
}

interface BuildInitialRuntimeStateOptions {
  characterId: string
  engine: EngineType | null
  sessionId?: string | null
  hasLiveRuntime?: boolean
}

export function buildInitialRuntimeState(
  options: BuildInitialRuntimeStateOptions
): CharacterRuntimeState {
  const sessionId = options.sessionId ?? null
  const hasLiveRuntime = options.hasLiveRuntime ?? false
  return {
    characterId: options.characterId,
    engine: options.engine,
    sessionId,
    hasLiveRuntime,
    markerStatus: sessionId || hasLiveRuntime ? 'idle' : 'no_session',
    isRunning: false,
    isUnknown: false,
    needsInput: false,
    unreadDone: false,
    activeToolName: null,
    attentionActive: false,
    lastTurnEndedAt: null,
    lastRunningActivityAt: null,
    lastAssistantPreview: null,
    lastError: null,
    needsInputReason: null,
    needsInputEvidence: null,
    acknowledgedNeedInputAt: null,
  }
}

export function hasVisibleNeedInput(
  state: Pick<CharacterRuntimeState, 'needsInput' | 'needsInputEvidence' | 'acknowledgedNeedInputAt'>
): boolean {
  if (!state.needsInput || !state.needsInputEvidence) return false
  if (state.acknowledgedNeedInputAt === null) return true
  return state.needsInputEvidence.detectedAt > state.acknowledgedNeedInputAt
}

export function deriveCharacterMarkerStatus(
  state: CharacterRuntimeState
): CharacterMarkerStatus {
  if (state.sessionId === null && !state.hasLiveRuntime) return 'no_session'
  if (state.lastError) return 'error'
  if (hasVisibleNeedInput(state)) return 'need_input'
  if (state.isUnknown) return 'unknown'
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

export function shouldAcknowledgeNeedInputOnAttention(input: {
  needsInput: boolean
  wasAttentionActive: boolean
  isAttentionActive: boolean
}): boolean {
  return input.needsInput && !input.wasAttentionActive && input.isAttentionActive
}

export function shouldScheduleDoneAutoClear(input: {
  unreadDone: boolean
  isAttentionActive: boolean
}): boolean {
  return input.unreadDone && input.isAttentionActive
}
