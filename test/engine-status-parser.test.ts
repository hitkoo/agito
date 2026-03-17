import { describe, expect, test } from 'bun:test'
import {
  createClaudeSemanticParser,
  createCodexSemanticParser,
} from '../src/main/engine-status-parser'

describe('createClaudeSemanticParser', () => {
  test('starts running immediately when a new Claude user turn begins after done', () => {
    const parser = createClaudeSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Previous turn finished.' }],
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      isRunning: false,
      unreadDone: true,
    })

    parser.ingestLine(
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: 'Please update the marker behavior.',
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      isRunning: true,
      activeToolName: null,
      unreadDone: false,
      needsInput: false,
    })
  })

  test('tracks running tool activity and emits done for normal turn completion', () => {
    const parser = createClaudeSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_123',
              name: 'Bash',
              input: { command: 'ls -la' },
            },
          ],
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      isRunning: true,
      activeToolName: 'Bash',
      unreadDone: false,
      needsInput: false,
    })

    parser.ingestLine(
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_123',
              content: [{ type: 'text', text: 'ok' }],
            },
          ],
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Finished the change.' }],
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      isRunning: false,
      activeToolName: null,
      unreadDone: true,
      needsInput: false,
      lastAssistantPreview: 'Finished the change.',
    })
  })

  test('clears active tool on real Claude tool_result payload shape', () => {
    const parser = createClaudeSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_real',
              name: 'Bash',
              input: { command: 'pwd' },
            },
          ],
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_real',
              content: [{ type: 'text', text: 'ok' }],
            },
          ],
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      isRunning: true,
      activeToolName: null,
    })
  })

  test('tracks AskUserQuestion as explicit need_input until the matching answer arrives', () => {
    const parser = createClaudeSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_question',
              name: 'AskUserQuestion',
              input: {
                questions: [{ question: 'Where should I configure this?' }],
              },
            },
          ],
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      isRunning: false,
      unreadDone: false,
      needsInput: true,
      needsInputReason: 'question',
      needsInputEvidence: {
        strength: 'explicit',
        engine: 'claude-code',
        anchorType: 'ask_user_question',
        anchorId: 'toolu_question',
      },
    })

    parser.ingestLine(
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_question',
              content:
                'User has answered your questions: "Where should I configure this?"="Global".',
            },
          ],
        },
        toolUseResult: {
          questions: [{ question: 'Where should I configure this?' }],
          answers: {
            'Where should I configure this?': 'Global',
          },
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      needsInput: false,
      needsInputReason: null,
      needsInputEvidence: null,
    })
  })

  test('marks Claude thinking blocks as running before any text is emitted', () => {
    const parser = createClaudeSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: null,
          content: [
            {
              type: 'thinking',
              thinking: 'Analyzing the request.',
            },
          ],
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      isRunning: true,
      activeToolName: null,
      unreadDone: false,
      needsInput: false,
    })
  })

  test('marks Claude agent progress records as running even before assistant text is emitted', () => {
    const parser = createClaudeSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'progress',
        toolUseID: 'toolu_progress',
        data: {
          type: 'agent_progress',
          message: {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [],
            },
          },
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      isRunning: true,
      activeToolName: null,
      unreadDone: false,
      needsInput: false,
    })
  })

  test('ignores Claude hook progress for semantic running state', () => {
    const parser = createClaudeSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'progress',
        toolUseID: 'toolu_hook',
        data: {
          type: 'hook_progress',
          hookEvent: 'PreToolUse',
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      isRunning: false,
      activeToolName: null,
      unreadDone: false,
      needsInput: false,
    })
  })

  test('does not reopen running from Claude stop hook progress after completion', () => {
    const parser = createClaudeSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_build',
              name: 'Bash',
              input: { command: 'pnpm build' },
            },
          ],
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_build',
              content: 'ok',
            },
          ],
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Finished the build.' }],
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'progress',
        toolUseID: 'toolu_stop',
        parentToolUseID: 'toolu_stop',
        data: {
          type: 'hook_progress',
          hookEvent: 'Stop',
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'system',
        subtype: 'turn_duration',
        durationMs: 1000,
      })
    )

    expect(parser.getState()).toMatchObject({
      isRunning: false,
      activeToolName: null,
      unreadDone: true,
      needsInput: false,
      lastAssistantPreview: 'Finished the build.',
    })
  })

  test('reopens running from Claude agent progress after a completed turn', () => {
    const parser = createClaudeSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Main turn finished.' }],
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'progress',
        toolUseID: 'toolu_agent',
        parentToolUseID: 'toolu_agent',
        data: {
          type: 'agent_progress',
          message: {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [],
            },
          },
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      isRunning: true,
      activeToolName: null,
      unreadDone: false,
      needsInput: false,
    })
  })

  test('ignores Claude query progress records for semantic status', () => {
    const parser = createClaudeSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'progress',
        data: {
          type: 'query_update',
          query: 'status system',
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      isRunning: false,
      activeToolName: null,
      unreadDone: false,
      needsInput: false,
    })
  })

  test('warns on unknown Claude progress types without changing semantic state', () => {
    const parser = createClaudeSemanticParser()
    const originalWarn = console.warn
    const warnings: unknown[][] = []
    console.warn = (...args: unknown[]) => {
      warnings.push(args)
    }

    try {
      parser.ingestLine(
        JSON.stringify({
          type: 'progress',
          data: {
            type: 'future_progress_type',
          },
        })
      )
    } finally {
      console.warn = originalWarn
    }

    expect(parser.getState()).toMatchObject({
      isRunning: false,
      activeToolName: null,
      unreadDone: false,
      needsInput: false,
    })
    expect(warnings).toHaveLength(1)
    expect(String(warnings[0]?.[0] ?? '')).toContain('Unknown Claude progress type')
    expect(String(warnings[0]?.[1] ?? '')).toContain('future_progress_type')
  })

  test('treats errors as transient and clears them on later semantic activity', () => {
    const parser = createClaudeSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'assistant',
        error: 'invalid_request',
      })
    )

    expect(parser.getState()).toMatchObject({
      lastError: 'invalid_request',
    })

    parser.ingestLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Finished cleanly.' }],
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      lastError: null,
      unreadDone: true,
      needsInput: false,
    })
  })

  test('marks explicit approval waits from Claude tool_result errors', () => {
    const parser = createClaudeSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_approval',
              name: 'Bash',
              input: { command: 'git log --oneline -20' },
            },
          ],
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_approval',
              is_error: true,
              content:
                'Claude requested permissions to read from /Users/seungjin/Desktop/seungjin/agito, but you have not granted it yet.',
            },
          ],
        },
        toolUseResult:
          'Error: Claude requested permissions to read from /Users/seungjin/Desktop/seungjin/agito, but you have not granted it yet.',
      })
    )

    expect(parser.getState()).toMatchObject({
      isRunning: false,
      needsInput: true,
      needsInputReason: 'approval',
      needsInputEvidence: {
        strength: 'explicit',
        engine: 'claude-code',
        anchorType: 'permission_request',
        anchorId: 'toolu_approval',
      },
    })
  })

  test('does not classify denied Claude permissions as need_input', () => {
    const parser = createClaudeSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_denied',
              name: 'Edit',
              input: { file_path: '/tmp/test.ts' },
            },
          ],
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_denied',
              is_error: true,
              content:
                'Permission for this tool use was denied. The tool use was rejected.',
            },
          ],
        },
        toolUseResult:
          'Error: Permission for this tool use was denied. The tool use was rejected.',
      })
    )

    expect(parser.getState()).toMatchObject({
      needsInput: false,
      needsInputReason: null,
      needsInputEvidence: null,
    })
  })

  test('marks plan handoff from plan mode only when a Claude plan artifact is emitted', () => {
    const parser = createClaudeSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'user',
        permissionMode: 'plan',
        message: {
          role: 'user',
          content: 'Plan this refactor.',
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_plan',
              content: 'Plan saved.',
            },
          ],
        },
        toolUseResult: {
          plan: '# Example plan',
          filePath: '/Users/seungjin/.claude/plans/example.md',
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'The plan is ready.' }],
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      isRunning: false,
      needsInput: true,
      needsInputReason: 'plan_handoff',
      needsInputEvidence: {
        strength: 'contextual',
        engine: 'claude-code',
        anchorType: 'plan_artifact',
      },
    })
  })

  test('does not keep a Claude plan artifact pending after implementation starts', () => {
    const parser = createClaudeSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'user',
        permissionMode: 'plan',
        message: {
          role: 'user',
          content: 'Plan this refactor.',
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_exit_plan',
              name: 'ExitPlanMode',
              input: { plan: '# Example plan' },
            },
          ],
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_exit_plan',
              content: 'Plan saved.',
            },
          ],
        },
        toolUseResult: {
          plan: '# Example plan',
          filePath: '/Users/seungjin/.claude/plans/example.md',
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: 'tool_use',
          content: [{ type: 'text', text: 'Implementing the refactor now.' }],
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_bash',
              name: 'Bash',
              input: { command: 'git status --short' },
            },
          ],
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_bash',
              content: 'M src/main/engine-status-parser.ts',
            },
          ],
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Implemented the refactor.' }],
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      isRunning: false,
      needsInput: false,
      needsInputReason: null,
      needsInputEvidence: null,
      unreadDone: true,
    })
  })

  test('consumes a Claude plan artifact on the immediate next assistant turn only', () => {
    const parser = createClaudeSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'user',
        permissionMode: 'plan',
        message: {
          role: 'user',
          content: 'Plan this refactor.',
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_plan',
              content: 'Plan saved.',
            },
          ],
        },
        toolUseResult: {
          plan: '# Example plan',
          filePath: '/Users/seungjin/.claude/plans/example.md',
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_read',
              name: 'Read',
              input: { file_path: '/tmp/example.ts' },
            },
          ],
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Implemented the plan.' }],
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      needsInput: false,
      needsInputReason: null,
      needsInputEvidence: null,
      unreadDone: true,
    })
  })

  test('marks ExitPlanMode as an explicit Claude plan handoff anchor', () => {
    const parser = createClaudeSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'user',
        permissionMode: 'plan',
        message: {
          role: 'user',
          content: 'Proceed with the approved plan.',
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_exit_plan',
              name: 'ExitPlanMode',
              input: {
                allowedPrompts: [{ tool: 'Bash', prompt: 'run typecheck' }],
                plan: '# Example plan',
                planFilePath: '/Users/seungjin/.claude/plans/example.md',
              },
            },
          ],
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      isRunning: false,
      unreadDone: false,
      needsInput: true,
      needsInputReason: 'plan_handoff',
      needsInputEvidence: {
        strength: 'explicit',
        engine: 'claude-code',
        anchorType: 'exit_plan_mode',
        anchorId: 'toolu_exit_plan',
      },
    })
  })
})

describe('createCodexSemanticParser', () => {
  test('tracks tool calls and marks completion on task_complete', () => {
    const parser = createCodexSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'task_started' },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: '{"cmd":"pwd"}',
          call_id: 'call_123',
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      isRunning: true,
      activeToolName: 'exec_command',
    })

    parser.ingestLine(
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'call_123',
          output: 'ok',
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'task_complete' },
      })
    )

    expect(parser.getState()).toMatchObject({
      isRunning: false,
      activeToolName: null,
      unreadDone: true,
      needsInput: false,
    })
  })

  test('marks request_user_input as explicit need_input until the tool returns', () => {
    const parser = createCodexSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'request_user_input',
          arguments: '{"questions":[{"question":"Proceed?"}]}',
          call_id: 'call_question',
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      isRunning: false,
      needsInput: true,
      needsInputReason: 'question',
      needsInputEvidence: {
        strength: 'explicit',
        engine: 'codex',
        anchorType: 'request_user_input',
        anchorId: 'call_question',
      },
    })

    parser.ingestLine(
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'call_question',
          output: '{"answers":{"Proceed?":"Yes"}}',
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      needsInput: false,
      needsInputReason: null,
      needsInputEvidence: null,
    })
  })

  test('accepts real Codex agent_message payloads that use message instead of text', () => {
    const parser = createCodexSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          message: 'Implementing the requested refactor now.',
          phase: 'commentary',
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      isRunning: true,
      lastAssistantPreview: 'Implementing the requested refactor now.',
    })
  })

  test('marks require_escalated exec_command calls as approval waits', () => {
    const parser = createCodexSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments:
            '{"cmd":"uv run pytest tests/test_auth.py","sandbox_permissions":"require_escalated"}',
          call_id: 'call_escalated',
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      isRunning: false,
      needsInput: true,
      needsInputReason: 'approval',
      needsInputEvidence: {
        strength: 'explicit',
        engine: 'codex',
        anchorType: 'require_escalated',
        anchorId: 'call_escalated',
      },
    })

    parser.ingestLine(
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'call_escalated',
          output: 'approved',
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      isRunning: true,
      activeToolName: null,
      unreadDone: false,
      needsInput: false,
      needsInputReason: null,
      needsInputEvidence: null,
    })
  })

  test('clears aborted errors on subsequent semantic events', () => {
    const parser = createCodexSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'turn_aborted',
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      lastError: 'turn_aborted',
    })

    parser.ingestLine(
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'task_started',
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      lastError: null,
      isRunning: true,
    })
  })

  test('marks plan handoff when a plan-mode turn finishes with a proposed plan', () => {
    const parser = createCodexSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'task_started',
          collaboration_mode_kind: 'plan',
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'turn_context',
        payload: {
          collaboration_mode: {
            mode: 'plan',
          },
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: '<proposed_plan>\n# Example\n</proposed_plan>',
            },
          ],
          phase: 'final_answer',
        },
      })
    )

    parser.ingestLine(
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'task_complete' },
      })
    )

    expect(parser.getState()).toMatchObject({
      isRunning: false,
      unreadDone: false,
      needsInput: true,
      needsInputReason: 'plan_handoff',
      needsInputEvidence: {
        strength: 'contextual',
        engine: 'codex',
        anchorType: 'proposed_plan',
      },
    })
  })
})
