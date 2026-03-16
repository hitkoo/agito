import {
  buildInitialRuntimeState,
  classifyAssistantPreview,
  type CharacterRuntimeState,
} from '../shared/character-runtime-state'
import type { EngineType } from '../shared/types'

interface SemanticParser {
  ingestLine(line: string): void
  getState(): CharacterRuntimeState
}

interface ClaudeMessageBlock {
  type?: string
  text?: string
  id?: string
  name?: string
}

interface ClaudeRecord {
  type?: string
  message?: {
    role?: string
    stop_reason?: string | null
    content?: ClaudeMessageBlock[]
  }
  error?: string
}

interface CodexRecord {
  type?: string
  payload?: {
    type?: string
    text?: string
    name?: string
    call_id?: string
  }
}

function createBaseParser(engine: EngineType): {
  state: CharacterRuntimeState
  setPreview: (preview: string | null | undefined) => void
  startRunning: (toolName?: string | null) => void
  finishTool: () => void
  completeTurn: () => void
  setError: (message: string) => void
} {
  const state = buildInitialRuntimeState({
    characterId: `parser:${engine}`,
    engine,
    sessionId: 'semantic-session',
  })
  state.expectedAlive = true
  state.ptyAlive = true

  return {
    state,
    setPreview(preview) {
      state.lastAssistantPreview = preview?.trim() || null
    },
    startRunning(toolName) {
      state.isRunning = true
      state.unreadDone = false
      state.needsInput = false
      state.needsApproval = false
      state.activeToolName = toolName ?? state.activeToolName
      state.activeToolKind = toolName ?? state.activeToolKind
    },
    finishTool() {
      state.activeToolName = null
      state.activeToolKind = null
    },
    completeTurn() {
      state.isRunning = false
      state.activeToolName = null
      state.activeToolKind = null
      state.lastTurnEndedAt = Date.now()
      const completionKind = classifyAssistantPreview(state.lastAssistantPreview)
      state.needsInput = completionKind === 'need_input'
      state.unreadDone = completionKind === 'done'
    },
    setError(message) {
      state.isRunning = false
      state.lastError = message
      state.ptyAlive = false
    },
  }
}

export function createClaudeSemanticParser(): SemanticParser {
  const { state, setPreview, startRunning, finishTool, completeTurn, setError } =
    createBaseParser('claude-code')
  const activeTools = new Set<string>()

  return {
    ingestLine(line: string): void {
      let record: ClaudeRecord
      try {
        record = JSON.parse(line) as ClaudeRecord
      } catch {
        return
      }

      if (record.error) {
        setError(record.error)
        return
      }

      if (record.type === 'assistant') {
        const blocks = record.message?.content ?? []
        const text = blocks
          .filter((block) => block.type === 'text' && block.text)
          .map((block) => block.text ?? '')
          .join('\n')
          .trim()
        if (text) {
          setPreview(text)
          startRunning()
        }

        for (const block of blocks) {
          if (block.type === 'tool_use' && block.id) {
            activeTools.add(block.id)
            setPreview(null)
            startRunning(block.name ?? 'tool')
          }
        }

        if (record.message?.stop_reason === 'end_turn') {
          completeTurn()
        }
        return
      }

      if (record.type === 'user') {
        const blocks = record.message?.content ?? []
        for (const block of blocks) {
          if (block.type === 'tool_result' && block.id) {
            activeTools.delete(block.id)
          }
        }
        if (activeTools.size === 0) {
          finishTool()
        }
      }
    },
    getState(): CharacterRuntimeState {
      return { ...state }
    },
  }
}

export function createCodexSemanticParser(): SemanticParser {
  const { state, setPreview, startRunning, finishTool, completeTurn, setError } =
    createBaseParser('codex')
  const activeCalls = new Set<string>()

  return {
    ingestLine(line: string): void {
      let record: CodexRecord
      try {
        record = JSON.parse(line) as CodexRecord
      } catch {
        return
      }

      const payloadType = record.payload?.type

      if (record.type === 'event_msg' && payloadType === 'task_started') {
        startRunning()
        return
      }

      if (record.type === 'event_msg' && payloadType === 'agent_message') {
        setPreview(record.payload?.text ?? null)
        startRunning()
        return
      }

      if (record.type === 'event_msg' && payloadType === 'task_complete') {
        completeTurn()
        return
      }

      if (record.type === 'event_msg' && payloadType === 'turn_aborted') {
        setError('turn_aborted')
        return
      }

      if (record.type === 'response_item' && payloadType === 'function_call') {
        const callId = record.payload?.call_id
        if (callId) activeCalls.add(callId)
        startRunning(record.payload?.name ?? 'tool')
        return
      }

      if (
        record.type === 'response_item' &&
        (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output')
      ) {
        const callId = record.payload?.call_id
        if (callId) activeCalls.delete(callId)
        if (activeCalls.size === 0) {
          finishTool()
        }
      }
    },
    getState(): CharacterRuntimeState {
      return { ...state }
    },
  }
}
