import { describe, expect, test } from 'bun:test'
import {
  buildInitialRuntimeState,
  deriveCharacterMarkerStatus,
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
})
