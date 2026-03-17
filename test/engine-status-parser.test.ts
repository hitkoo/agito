import { describe, expect, test } from 'bun:test'
import {
  createClaudeSemanticParser,
  createCodexSemanticParser,
} from '../src/main/engine-status-parser'

describe('createClaudeSemanticParser', () => {
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
