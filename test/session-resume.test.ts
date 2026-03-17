import { describe, expect, test } from 'bun:test'
import type { SessionMapping } from '../src/shared/types'
import {
  buildSessionResumeInvokeArgs,
  upsertSessionMappingOnResume,
} from '../src/shared/session-resume'

function makeMapping(overrides: Partial<SessionMapping> = {}): SessionMapping {
  return {
    characterId: 'char-1',
    sessionId: 'session-1',
    engineType: 'codex',
    workingDirectory: '/tmp/work-a',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActiveAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

describe('buildSessionResumeInvokeArgs', () => {
  test('includes stored workingDirectory and engineType when mapping exists', () => {
    expect(
      buildSessionResumeInvokeArgs({
        characterId: 'char-2',
        sessionId: 'session-1',
        sessions: [makeMapping({ engineType: 'claude-code', workingDirectory: '/tmp/work-b' })],
      })
    ).toEqual({
      characterId: 'char-2',
      sessionId: 'session-1',
      engineType: 'claude-code',
      workingDirectory: '/tmp/work-b',
    })
  })

  test('falls back to bare resume args when mapping is missing', () => {
    expect(
      buildSessionResumeInvokeArgs({
        characterId: 'char-2',
        sessionId: 'missing-session',
        sessions: [makeMapping()],
      })
    ).toEqual({
      characterId: 'char-2',
      sessionId: 'missing-session',
    })
  })
})

describe('upsertSessionMappingOnResume', () => {
  test('overwrites stale metadata when explicit resume metadata is provided', () => {
    const next = upsertSessionMappingOnResume({
      sessions: [
        makeMapping({
          characterId: 'old-char',
          engineType: 'claude-code',
          workingDirectory: '/tmp/stale',
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
      ],
      characterId: 'char-2',
      sessionId: 'session-1',
      engineType: 'codex',
      workingDirectory: '/tmp/fresh',
      now: '2026-02-01T00:00:00.000Z',
      overwriteExistingMetadata: true,
    })

    expect(next).toEqual([
      {
        characterId: 'char-2',
        sessionId: 'session-1',
        engineType: 'codex',
        workingDirectory: '/tmp/fresh',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastActiveAt: '2026-02-01T00:00:00.000Z',
      },
    ])
  })

  test('only bumps lastActiveAt when resume metadata was not explicit', () => {
    const next = upsertSessionMappingOnResume({
      sessions: [makeMapping()],
      characterId: 'char-2',
      sessionId: 'session-1',
      engineType: 'claude-code',
      workingDirectory: '/tmp/fresh',
      now: '2026-02-01T00:00:00.000Z',
      overwriteExistingMetadata: false,
    })

    expect(next).toEqual([
      {
        ...makeMapping(),
        lastActiveAt: '2026-02-01T00:00:00.000Z',
      },
    ])
  })

  test('creates a mapping for externally scanned sessions that were not stored yet', () => {
    const next = upsertSessionMappingOnResume({
      sessions: [makeMapping({ sessionId: 'other-session' })],
      characterId: 'char-2',
      sessionId: 'session-1',
      engineType: 'codex',
      workingDirectory: '/tmp/fresh',
      now: '2026-02-01T00:00:00.000Z',
      overwriteExistingMetadata: true,
    })

    expect(next).toEqual([
      makeMapping({ sessionId: 'other-session' }),
      {
        characterId: 'char-2',
        sessionId: 'session-1',
        engineType: 'codex',
        workingDirectory: '/tmp/fresh',
        createdAt: '2026-02-01T00:00:00.000Z',
        lastActiveAt: '2026-02-01T00:00:00.000Z',
      },
    ])
  })
})
