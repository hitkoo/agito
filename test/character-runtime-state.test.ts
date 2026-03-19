import { describe, expect, test } from 'bun:test'
import {
  buildInitialRuntimeState,
  deriveCharacterMarkerStatus,
  shouldAcknowledgeNeedInputOnAttention,
  shouldClearDoneOnAttention,
  shouldScheduleDoneAutoClear,
} from '../src/shared/character-runtime-state'

describe('deriveCharacterMarkerStatus', () => {
  test('returns no_session when no session is assigned', () => {
    expect(
      deriveCharacterMarkerStatus(
        buildInitialRuntimeState({
          characterId: 'char-1',
          engine: 'claude-code',
        })
      )
    ).toBe('no_session')
  })

  test('returns idle when a live runtime exists without a saved session id', () => {
    expect(
      deriveCharacterMarkerStatus(
        buildInitialRuntimeState({
          characterId: 'char-1',
          engine: 'codex',
          hasLiveRuntime: true,
        })
      )
    ).toBe('idle')
  })

  test('prioritizes explicit input over running and done', () => {
    expect(
      deriveCharacterMarkerStatus({
        ...buildInitialRuntimeState({
          characterId: 'char-1',
          engine: 'claude-code',
          sessionId: 'session-1',
        }),
        isRunning: true,
        unreadDone: true,
        needsInput: true,
        needsInputReason: 'question',
        needsInputEvidence: {
          strength: 'explicit',
          engine: 'claude-code',
          anchorType: 'ask_user_question',
          detectedAt: 100,
        },
      })
    ).toBe('need_input')
  })

  test('shows running before done and idle while work is still active', () => {
    expect(
      deriveCharacterMarkerStatus({
        ...buildInitialRuntimeState({
          characterId: 'char-1',
          engine: 'codex',
          sessionId: 'session-1',
        }),
        isRunning: true,
        unreadDone: true,
      })
    ).toBe('running')
  })

  test('shows unknown before done and idle once running has gone stale', () => {
    expect(
      deriveCharacterMarkerStatus({
        ...buildInitialRuntimeState({
          characterId: 'char-1',
          engine: 'codex',
          sessionId: 'session-1',
        }),
        unreadDone: true,
        isUnknown: true,
      })
    ).toBe('unknown')
  })

  test('keeps unread completion as done until attended', () => {
    expect(
      deriveCharacterMarkerStatus({
        ...buildInitialRuntimeState({
          characterId: 'char-1',
          engine: 'codex',
          sessionId: 'session-1',
        }),
        unreadDone: true,
      })
    ).toBe('done')
  })

  test('falls back to idle when session is alive and there is no outstanding work', () => {
    expect(
      deriveCharacterMarkerStatus({
        ...buildInitialRuntimeState({
          characterId: 'char-1',
          engine: 'claude-code',
          sessionId: 'session-1',
        }),
      })
    ).toBe('idle')
  })

  test('uses explicit runtime errors for error', () => {
    expect(
      deriveCharacterMarkerStatus({
        ...buildInitialRuntimeState({
          characterId: 'char-1',
          engine: 'claude-code',
          sessionId: 'session-1',
        }),
        lastError: 'turn_aborted',
      })
    ).toBe('error')
  })

  test('hides need_input after the same anchor is acknowledged via attention', () => {
    expect(
      deriveCharacterMarkerStatus({
        ...buildInitialRuntimeState({
          characterId: 'char-1',
          engine: 'claude-code',
          sessionId: 'session-1',
        }),
        needsInput: true,
        needsInputReason: 'approval',
        needsInputEvidence: {
          strength: 'explicit',
          engine: 'claude-code',
          anchorType: 'permission_request',
          detectedAt: 100,
        },
        acknowledgedNeedInputAt: 100,
      })
    ).toBe('idle')
  })

  test('re-shows need_input when a newer anchor arrives after acknowledgement', () => {
    expect(
      deriveCharacterMarkerStatus({
        ...buildInitialRuntimeState({
          characterId: 'char-1',
          engine: 'claude-code',
          sessionId: 'session-1',
        }),
        needsInput: true,
        needsInputReason: 'approval',
        needsInputEvidence: {
          strength: 'explicit',
          engine: 'claude-code',
          anchorType: 'permission_request',
          detectedAt: 101,
        },
        acknowledgedNeedInputAt: 100,
      })
    ).toBe('need_input')
  })
})

describe('done attention handling', () => {
  test('clears done immediately when attention is newly acquired', () => {
    expect(
      shouldClearDoneOnAttention({
        unreadDone: true,
        wasAttentionActive: false,
        isAttentionActive: true,
      })
    ).toBe(true)
  })

  test('schedules auto-clear when the session was already attended at turn end', () => {
    expect(
      shouldScheduleDoneAutoClear({
        unreadDone: true,
        isAttentionActive: true,
      })
    ).toBe(true)

    expect(
      shouldScheduleDoneAutoClear({
        unreadDone: true,
        isAttentionActive: false,
      })
    ).toBe(false)
  })

  test('acknowledges visible need_input when attention is newly acquired', () => {
    expect(
      shouldAcknowledgeNeedInputOnAttention({
        needsInput: true,
        wasAttentionActive: false,
        isAttentionActive: true,
      })
    ).toBe(true)

    expect(
      shouldAcknowledgeNeedInputOnAttention({
        needsInput: true,
        wasAttentionActive: true,
        isAttentionActive: true,
      })
    ).toBe(false)
  })
})
