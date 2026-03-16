import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CharacterRuntimeService } from '../src/main/character-runtime-service'
import type { Character, SessionMapping } from '../src/shared/types'

describe('CharacterRuntimeService', () => {
  test('loads Codex status from nested transcript files instead of falling back to a synthetic running state', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'agito-runtime-home-'))
    const transcriptDir = join(fakeHome, '.codex', 'sessions', '2026', '03', '17')
    mkdirSync(transcriptDir, { recursive: true })

    const sessionId = 'session-codex-nested'
    const transcriptPath = join(transcriptDir, `rollout-${sessionId}.jsonl`)
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          timestamp: '2026-03-17T00:00:00.000Z',
          type: 'event_msg',
          payload: {
            type: 'agent_message',
            message: 'Finished the refactor.',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-17T00:00:01.000Z',
          type: 'event_msg',
          payload: {
            type: 'task_complete',
          },
        }),
      ].join('\n') + '\n'
    )

    const service = new CharacterRuntimeService({ homeDirectory: fakeHome })
    service.startSession({
      characterId: 'char-codex',
      engine: 'codex',
      sessionId,
      workingDirectory: '/tmp/project',
    })

    expect(service.getState('char-codex')).toMatchObject({
      sessionId,
      markerStatus: 'done',
      isRunning: false,
      unreadDone: true,
      lastAssistantPreview: 'Finished the refactor.',
    })

    service.stopSession('char-codex')
  })

  test('hydrates bound session status during sync without requiring terminal open or resume', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'agito-runtime-home-'))
    const transcriptDir = join(fakeHome, '.codex', 'sessions', '2026', '03', '17')
    mkdirSync(transcriptDir, { recursive: true })

    const sessionId = 'session-codex-sync'
    writeFileSync(
      join(transcriptDir, `rollout-${sessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: '2026-03-17T00:00:00.000Z',
          type: 'event_msg',
          payload: {
            type: 'agent_message',
            message: 'Waiting for your confirmation.',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-17T00:00:01.000Z',
          type: 'event_msg',
          payload: {
            type: 'task_complete',
          },
        }),
      ].join('\n') + '\n'
    )

    const characters: Character[] = [
      {
        id: 'char-sync',
        name: 'sync',
        soul: '',
        skin: '',
        engine: 'codex',
        gridPosition: null,
        currentSessionId: sessionId,
        sessionHistory: [sessionId],
        status: 'idle',
        stats: {
          createdAt: '2026-03-17T00:00:00.000Z',
          totalTasks: 0,
          totalCommits: 0,
        },
      },
    ]
    const sessions: SessionMapping[] = [
      {
        characterId: 'char-sync',
        sessionId,
        engineType: 'codex',
        workingDirectory: '/tmp/project',
        createdAt: '2026-03-17T00:00:00.000Z',
        lastActiveAt: '2026-03-17T00:00:01.000Z',
      },
    ]

    const service = new CharacterRuntimeService({ homeDirectory: fakeHome })
    service.syncCharacters(characters, sessions)

    expect(service.getState('char-sync')).toMatchObject({
      markerStatus: 'need_input',
      needsInput: true,
      unreadDone: false,
      lastAssistantPreview: 'Waiting for your confirmation.',
    })

    service.stopSession('char-sync')
  })

  test('clears transient transcript errors when attention is acquired', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'agito-runtime-home-'))
    const transcriptDir = join(fakeHome, '.claude', 'projects', '-tmp-project')
    mkdirSync(transcriptDir, { recursive: true })

    const sessionId = 'session-claude-error'
    writeFileSync(
      join(transcriptDir, `${sessionId}.jsonl`),
      JSON.stringify({
        type: 'assistant',
        error: 'invalid_request',
      }) + '\n'
    )

    const characters: Character[] = [
      {
        id: 'char-error',
        name: 'error',
        soul: '',
        skin: '',
        engine: 'claude-code',
        gridPosition: null,
        currentSessionId: sessionId,
        sessionHistory: [sessionId],
        status: 'idle',
        stats: {
          createdAt: '2026-03-17T00:00:00.000Z',
          totalTasks: 0,
          totalCommits: 0,
        },
      },
    ]
    const sessions: SessionMapping[] = [
      {
        characterId: 'char-error',
        sessionId,
        engineType: 'claude-code',
        workingDirectory: '/tmp/project',
        createdAt: '2026-03-17T00:00:00.000Z',
        lastActiveAt: '2026-03-17T00:00:01.000Z',
      },
    ]

    const service = new CharacterRuntimeService({ homeDirectory: fakeHome })
    service.syncCharacters(characters, sessions)

    expect(service.getState('char-error')).toMatchObject({
      markerStatus: 'error',
      lastError: 'invalid_request',
    })

    service.setAttention('char-error', true)

    expect(service.getState('char-error')).toMatchObject({
      markerStatus: 'idle',
      lastError: null,
    })

    service.stopSession('char-error')
  })
})
