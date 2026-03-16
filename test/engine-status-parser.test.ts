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

  test('classifies question-style turn completions as need_input instead of done', () => {
    const parser = createClaudeSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Which directory should I use next?' }],
        },
      })
    )

    expect(parser.getState()).toMatchObject({
      unreadDone: false,
      needsInput: true,
      lastAssistantPreview: 'Which directory should I use next?',
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

  test('uses the latest assistant message preview to classify need_input', () => {
    const parser = createCodexSemanticParser()

    parser.ingestLine(
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          text: 'Should I proceed with the migration?',
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
      unreadDone: false,
      needsInput: true,
      lastAssistantPreview: 'Should I proceed with the migration?',
    })
  })
})
