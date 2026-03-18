import { describe, expect, test } from 'bun:test'
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs'
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

  test('does not resurrect a suppressed Claude done state on later transcript sync during session refresh', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'agito-runtime-home-'))
    const transcriptDir = join(fakeHome, '.claude', 'projects', '-tmp-project')
    mkdirSync(transcriptDir, { recursive: true })

    const sessionId = 'session-claude-refresh-done'
    const transcriptPath = join(transcriptDir, `${sessionId}.jsonl`)
    writeFileSync(
      transcriptPath,
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

    const service = new CharacterRuntimeService({ homeDirectory: fakeHome })
    service.startSession({
      characterId: 'char-refresh-done',
      engine: 'claude-code',
      sessionId,
      workingDirectory: '/tmp/project',
    })

    expect(service.getState('char-refresh-done')).toMatchObject({
      markerStatus: 'idle',
      unreadDone: false,
      lastAssistantPreview: 'Finished the task.',
    })

    appendFileSync(
      transcriptPath,
      JSON.stringify({
        type: 'progress',
        toolUseID: 'toolu_refresh_marker',
        parentToolUseID: 'toolu_refresh_marker',
        data: {
          type: 'hook_progress',
          hookEvent: 'SessionStart',
        },
      }) + '\n'
    )

    await Bun.sleep(650)

    expect(service.getState('char-refresh-done')).toMatchObject({
      markerStatus: 'idle',
      unreadDone: false,
      lastAssistantPreview: 'Finished the task.',
    })

    service.stopSession('char-refresh-done')
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

  test('hydrates Claude turn_duration completions as idle on startup even without end_turn', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'agito-runtime-home-'))
    const transcriptDir = join(fakeHome, '.claude', 'projects', '-tmp-project')
    mkdirSync(transcriptDir, { recursive: true })

    const sessionId = 'session-claude-turn-duration'
    writeFileSync(
      join(transcriptDir, `${sessionId}.jsonl`),
      [
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            stop_reason: 'tool_use',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_turn_duration_startup',
                name: 'Bash',
                input: { command: 'pnpm build' },
              },
            ],
          },
        }),
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_turn_duration_startup',
                content: 'ok',
              },
            ],
          },
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            stop_reason: null,
            content: [{ type: 'text', text: 'Build verification passed.' }],
          },
        }),
        JSON.stringify({
          type: 'progress',
          toolUseID: 'toolu_turn_duration_stop',
          parentToolUseID: 'toolu_turn_duration_stop',
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
        id: 'char-turn-duration',
        name: 'turn-duration',
        soul: '',
        skin: '',
        engine: 'claude-code',
        gridPosition: null,
        currentSessionId: sessionId,
        sessionHistory: [sessionId],
        stats: {
          createdAt: '2026-03-18T00:00:00.000Z',
          totalTasks: 0,
          totalCommits: 0,
        },
      },
    ]
    const sessions: SessionMapping[] = [
      {
        characterId: 'char-turn-duration',
        sessionId,
        engineType: 'claude-code',
        workingDirectory: '/tmp/project',
        createdAt: '2026-03-18T00:00:00.000Z',
        lastActiveAt: '2026-03-18T00:00:01.000Z',
      },
    ]

    const service = new CharacterRuntimeService({ homeDirectory: fakeHome })
    service.syncCharacters(characters, sessions)

    expect(service.getState('char-turn-duration')).toMatchObject({
      markerStatus: 'idle',
      isRunning: false,
      activeToolName: null,
      unreadDone: false,
      lastAssistantPreview: 'Build verification passed.',
    })

    service.stopSession('char-turn-duration')
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

  test('promotes stalled Claude PreToolUse approval waits into heuristic need_input after a timeout', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'agito-runtime-home-'))
    const transcriptDir = join(fakeHome, '.claude', 'projects', '-tmp-project')
    mkdirSync(transcriptDir, { recursive: true })

    const sessionId = 'session-claude-approval-timeout'
    writeFileSync(
      join(transcriptDir, `${sessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: '2026-03-18T02:01:10.522Z',
          type: 'assistant',
          message: {
            role: 'assistant',
            stop_reason: 'tool_use',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_approval_timeout',
                name: 'Bash',
                input: { command: 'pnpm build 2>&1 | tail -5' },
              },
            ],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-18T02:01:10.536Z',
          type: 'progress',
          toolUseID: 'toolu_approval_timeout',
          data: {
            type: 'hook_progress',
            hookEvent: 'PreToolUse',
          },
        }),
      ].join('\n') + '\n'
    )

    const characters: Character[] = [
      {
        id: 'char-approval-timeout',
        name: 'approval-timeout',
        soul: '',
        skin: '',
        engine: 'claude-code',
        gridPosition: null,
        currentSessionId: sessionId,
        sessionHistory: [sessionId],
        stats: {
          createdAt: '2026-03-18T02:01:10.000Z',
          totalTasks: 0,
          totalCommits: 0,
        },
      },
    ]
    const sessions: SessionMapping[] = [
      {
        characterId: 'char-approval-timeout',
        sessionId,
        engineType: 'claude-code',
        workingDirectory: '/tmp/project',
        createdAt: '2026-03-18T02:01:10.000Z',
        lastActiveAt: '2026-03-18T02:01:10.000Z',
      },
    ]

    const service = new CharacterRuntimeService({
      homeDirectory: fakeHome,
      approvalHeuristicDelayMs: 10,
    })
    service.syncCharacters(characters, sessions)

    expect(service.getState('char-approval-timeout')).toMatchObject({
      markerStatus: 'running',
      activeToolName: 'Bash',
      needsInput: false,
    })

    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(service.getState('char-approval-timeout')).toMatchObject({
      markerStatus: 'need_input',
      isRunning: false,
      activeToolName: null,
      needsInput: true,
      needsInputReason: 'approval',
      needsInputEvidence: {
        strength: 'heuristic',
        engine: 'claude-code',
        anchorType: 'pre_tool_use_timeout',
        anchorId: 'toolu_approval_timeout',
      },
    })

    service.stopSession('char-approval-timeout')
  })

  test('hydrates stale Claude PreToolUse approval waits as heuristic need_input immediately on startup', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'agito-runtime-home-'))
    const transcriptDir = join(fakeHome, '.claude', 'projects', '-tmp-project')
    mkdirSync(transcriptDir, { recursive: true })

    const sessionId = 'session-claude-approval-startup'
    writeFileSync(
      join(transcriptDir, `${sessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: '2000-01-01T00:00:00.000Z',
          type: 'assistant',
          message: {
            role: 'assistant',
            stop_reason: 'tool_use',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_approval_startup',
                name: 'Bash',
                input: { command: 'pnpm build 2>&1 | tail -5' },
              },
            ],
          },
        }),
        JSON.stringify({
          timestamp: '2000-01-01T00:00:00.100Z',
          type: 'progress',
          toolUseID: 'toolu_approval_startup',
          data: {
            type: 'hook_progress',
            hookEvent: 'PreToolUse',
          },
        }),
      ].join('\n') + '\n'
    )

    const characters: Character[] = [
      {
        id: 'char-approval-startup',
        name: 'approval-startup',
        soul: '',
        skin: '',
        engine: 'claude-code',
        gridPosition: null,
        currentSessionId: sessionId,
        sessionHistory: [sessionId],
        stats: {
          createdAt: '2000-01-01T00:00:00.000Z',
          totalTasks: 0,
          totalCommits: 0,
        },
      },
    ]
    const sessions: SessionMapping[] = [
      {
        characterId: 'char-approval-startup',
        sessionId,
        engineType: 'claude-code',
        workingDirectory: '/tmp/project',
        createdAt: '2000-01-01T00:00:00.000Z',
        lastActiveAt: '2000-01-01T00:00:01.000Z',
      },
    ]

    const service = new CharacterRuntimeService({
      homeDirectory: fakeHome,
      approvalHeuristicDelayMs: 50,
    })
    service.syncCharacters(characters, sessions)

    expect(service.getState('char-approval-startup')).toMatchObject({
      markerStatus: 'need_input',
      isRunning: false,
      activeToolName: null,
      needsInput: true,
      needsInputReason: 'approval',
      needsInputEvidence: {
        strength: 'heuristic',
        engine: 'claude-code',
        anchorType: 'pre_tool_use_timeout',
        anchorId: 'toolu_approval_startup',
      },
    })

    service.stopSession('char-approval-startup')
  })

  test('hydrates Claude user interrupts as error instead of a new running turn', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'agito-runtime-home-'))
    const transcriptDir = join(fakeHome, '.claude', 'projects', '-tmp-project')
    mkdirSync(transcriptDir, { recursive: true })

    const sessionId = 'session-claude-interrupt'
    writeFileSync(
      join(transcriptDir, `${sessionId}.jsonl`),
      [
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            stop_reason: 'tool_use',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_interrupt',
                name: 'Grep',
                input: { pattern: 'status-pulse', path: '/tmp/example.ts' },
              },
            ],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-17T18:17:11.647Z',
          type: 'progress',
          toolUseID: 'toolu_interrupt',
          data: {
            type: 'hook_progress',
            hookEvent: 'PreToolUse',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-17T18:17:15.355Z',
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'text', text: '[Request interrupted by user]' }],
          },
        }),
      ].join('\n') + '\n'
    )

    const characters: Character[] = [
      {
        id: 'char-interrupt',
        name: 'interrupt',
        soul: '',
        skin: '',
        engine: 'claude-code',
        gridPosition: null,
        currentSessionId: sessionId,
        sessionHistory: [sessionId],
        stats: {
          createdAt: '2026-03-17T18:17:00.000Z',
          totalTasks: 0,
          totalCommits: 0,
        },
      },
    ]
    const sessions: SessionMapping[] = [
      {
        characterId: 'char-interrupt',
        sessionId,
        engineType: 'claude-code',
        workingDirectory: '/tmp/project',
        createdAt: '2026-03-17T18:17:00.000Z',
        lastActiveAt: '2026-03-17T18:17:16.000Z',
      },
    ]

    const service = new CharacterRuntimeService({
      homeDirectory: fakeHome,
      approvalHeuristicDelayMs: 10,
    })
    service.syncCharacters(characters, sessions)

    expect(service.getState('char-interrupt')).toMatchObject({
      markerStatus: 'error',
      isRunning: false,
      activeToolName: null,
      needsInput: false,
      lastError: 'interrupted_by_user',
    })

    service.stopSession('char-interrupt')
  })

  test('hydrates rejected Claude AskUserQuestion flows as error instead of running', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'agito-runtime-home-'))
    const transcriptDir = join(fakeHome, '.claude', 'projects', '-tmp-project')
    mkdirSync(transcriptDir, { recursive: true })

    const sessionId = 'session-claude-askquestion-rejected'
    writeFileSync(
      join(transcriptDir, `${sessionId}.jsonl`),
      [
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            stop_reason: 'tool_use',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_question_rejected',
                name: 'AskUserQuestion',
                input: {
                  questions: [{ question: 'status marker 변경사항 확인 완료했나요?' }],
                },
              },
            ],
          },
        }),
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_question_rejected',
                is_error: true,
                content:
                  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.",
              },
            ],
          },
          toolUseResult: 'User rejected tool use',
        }),
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }],
          },
        }),
      ].join('\n') + '\n'
    )

    const characters: Character[] = [
      {
        id: 'char-askquestion-rejected',
        name: 'askquestion-rejected',
        soul: '',
        skin: '',
        engine: 'claude-code',
        gridPosition: null,
        currentSessionId: sessionId,
        sessionHistory: [sessionId],
        stats: {
          createdAt: '2026-03-17T18:36:47.000Z',
          totalTasks: 0,
          totalCommits: 0,
        },
      },
    ]
    const sessions: SessionMapping[] = [
      {
        characterId: 'char-askquestion-rejected',
        sessionId,
        engineType: 'claude-code',
        workingDirectory: '/tmp/project',
        createdAt: '2026-03-17T18:36:47.000Z',
        lastActiveAt: '2026-03-17T18:37:10.000Z',
      },
    ]

    const service = new CharacterRuntimeService({ homeDirectory: fakeHome })
    service.syncCharacters(characters, sessions)

    expect(service.getState('char-askquestion-rejected')).toMatchObject({
      markerStatus: 'error',
      isRunning: false,
      activeToolName: null,
      needsInput: false,
      lastError: 'interrupted_by_user',
    })

    service.stopSession('char-askquestion-rejected')
  })
})
