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
      markerStatus: 'idle',
      isRunning: false,
      unreadDone: false,
      lastAssistantPreview: 'Finished the refactor.',
    })

    service.stopSession('char-codex')
  })

  test('hydrates explicit Codex need_input anchors during sync without requiring terminal open or resume', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'agito-runtime-home-'))
    const transcriptDir = join(fakeHome, '.codex', 'sessions', '2026', '03', '17')
    mkdirSync(transcriptDir, { recursive: true })

    const sessionId = 'session-codex-sync'
    writeFileSync(
      join(transcriptDir, `rollout-${sessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: '2026-03-17T00:00:00.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'request_user_input',
            arguments: '{"questions":[{"question":"Proceed?"}]}',
            call_id: 'call_sync_question',
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
      needsInputReason: 'question',
      unreadDone: false,
    })

    service.stopSession('char-sync')
  })

  test('does not resurrect done during initial transcript replay on startup', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'agito-runtime-home-'))
    const transcriptDir = join(fakeHome, '.claude', 'projects', '-tmp-project')
    mkdirSync(transcriptDir, { recursive: true })

    const sessionId = 'session-claude-done'
    writeFileSync(
      join(transcriptDir, `${sessionId}.jsonl`),
      [
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: 'Finished the task.' }],
          },
        }),
      ].join('\n') + '\n'
    )

    const characters: Character[] = [
      {
        id: 'char-done',
        name: 'done',
        soul: '',
        skin: '',
        engine: 'claude-code',
        gridPosition: null,
        currentSessionId: sessionId,
        sessionHistory: [sessionId],
        stats: {
          createdAt: '2026-03-17T00:00:00.000Z',
          totalTasks: 0,
          totalCommits: 0,
        },
      },
    ]
    const sessions: SessionMapping[] = [
      {
        characterId: 'char-done',
        sessionId,
        engineType: 'claude-code',
        workingDirectory: '/tmp/project',
        createdAt: '2026-03-17T00:00:00.000Z',
        lastActiveAt: '2026-03-17T00:00:01.000Z',
      },
    ]

    const service = new CharacterRuntimeService({ homeDirectory: fakeHome })
    service.syncCharacters(characters, sessions)

    expect(service.getState('char-done')).toMatchObject({
      markerStatus: 'idle',
      unreadDone: false,
      lastAssistantPreview: 'Finished the task.',
    })

    service.stopSession('char-done')
  })

  test('ignores Claude stop hook progress during initial transcript replay on startup', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'agito-runtime-home-'))
    const transcriptDir = join(fakeHome, '.claude', 'projects', '-tmp-project')
    mkdirSync(transcriptDir, { recursive: true })

    const sessionId = 'session-claude-stop-hook'
    writeFileSync(
      join(transcriptDir, `${sessionId}.jsonl`),
      [
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: 'Finished the task.' }],
          },
        }),
        JSON.stringify({
          type: 'progress',
          toolUseID: 'toolu_stop',
          parentToolUseID: 'toolu_stop',
          data: {
            type: 'hook_progress',
            hookEvent: 'Stop',
          },
        }),
        JSON.stringify({
          type: 'system',
          subtype: 'turn_duration',
          durationMs: 1000,
        }),
      ].join('\n') + '\n'
    )

    const characters: Character[] = [
      {
        id: 'char-stop-hook',
        name: 'stop-hook',
        soul: '',
        skin: '',
        engine: 'claude-code',
        gridPosition: null,
        currentSessionId: sessionId,
        sessionHistory: [sessionId],
        stats: {
          createdAt: '2026-03-17T00:00:00.000Z',
          totalTasks: 0,
          totalCommits: 0,
        },
      },
    ]
    const sessions: SessionMapping[] = [
      {
        characterId: 'char-stop-hook',
        sessionId,
        engineType: 'claude-code',
        workingDirectory: '/tmp/project',
        createdAt: '2026-03-17T00:00:00.000Z',
        lastActiveAt: '2026-03-17T00:00:01.000Z',
      },
    ]

    const service = new CharacterRuntimeService({ homeDirectory: fakeHome })
    service.syncCharacters(characters, sessions)

    expect(service.getState('char-stop-hook')).toMatchObject({
      markerStatus: 'idle',
      isRunning: false,
      activeToolName: null,
      unreadDone: false,
      lastAssistantPreview: 'Finished the task.',
    })

    service.stopSession('char-stop-hook')
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

  test('acknowledges need_input on attention without erasing the underlying anchor', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'agito-runtime-home-'))
    const transcriptDir = join(fakeHome, '.codex', 'sessions', '2026', '03', '17')
    mkdirSync(transcriptDir, { recursive: true })

    const sessionId = 'session-codex-attention'
    writeFileSync(
      join(transcriptDir, `rollout-${sessionId}.jsonl`),
      JSON.stringify({
        timestamp: '2026-03-17T00:00:00.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'request_user_input',
          arguments: '{"questions":[{"question":"Proceed?"}]}',
          call_id: 'call_attention_question',
        },
      }) + '\n'
    )

    const characters: Character[] = [
      {
        id: 'char-attention',
        name: 'attention',
        soul: '',
        skin: '',
        engine: 'codex',
        gridPosition: null,
        currentSessionId: sessionId,
        sessionHistory: [sessionId],
        stats: {
          createdAt: '2026-03-17T00:00:00.000Z',
          totalTasks: 0,
          totalCommits: 0,
        },
      },
    ]
    const sessions: SessionMapping[] = [
      {
        characterId: 'char-attention',
        sessionId,
        engineType: 'codex',
        workingDirectory: '/tmp/project',
        createdAt: '2026-03-17T00:00:00.000Z',
        lastActiveAt: '2026-03-17T00:00:01.000Z',
      },
    ]

    const service = new CharacterRuntimeService({ homeDirectory: fakeHome })
    service.syncCharacters(characters, sessions)

    expect(service.getState('char-attention')).toMatchObject({
      markerStatus: 'need_input',
      needsInput: true,
      needsInputReason: 'question',
      acknowledgedNeedInputAt: null,
    })

    service.setAttention('char-attention', true)

    expect(service.getState('char-attention')).toMatchObject({
      markerStatus: 'idle',
      needsInput: true,
      needsInputReason: 'question',
    })
    expect(service.getState('char-attention')?.acknowledgedNeedInputAt).toEqual(expect.any(Number))

    service.setAttention('char-attention', false)

    expect(service.getState('char-attention')).toMatchObject({
      markerStatus: 'idle',
      needsInput: true,
      needsInputReason: 'question',
    })

    service.stopSession('char-attention')
  })
})
