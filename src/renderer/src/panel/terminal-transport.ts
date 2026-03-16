import { IPC_COMMANDS, IPC_EVENTS } from '../../../shared/ipc-channels'
import type { TerminalSessionSnapshot } from '../../../shared/terminal-dock-state'

export interface TerminalOutputEvent {
  characterId: string
  data: string
  seq: number
}

export interface TerminalTransport {
  getSnapshot(characterId: string): Promise<TerminalSessionSnapshot>
  write(characterId: string, data: string): Promise<void>
  resize(characterId: string, cols: number, rows: number): Promise<void>
  subscribeOutput(handler: (payload: TerminalOutputEvent) => void): () => void
}

export const electronTerminalTransport: TerminalTransport = {
  getSnapshot: (characterId) => window.api.invoke<TerminalSessionSnapshot>(IPC_COMMANDS.TERMINAL_GET_SNAPSHOT, characterId),
  write: async (characterId, data) => {
    await window.api.invoke(IPC_COMMANDS.PTY_WRITE, { characterId, data })
  },
  resize: async (characterId, cols, rows) => {
    await window.api.invoke(IPC_COMMANDS.PTY_RESIZE, { characterId, cols, rows })
  },
  subscribeOutput: (handler) => {
    return window.api.on(IPC_EVENTS.PTY_DATA, (...args: unknown[]) => {
      handler(args[0] as TerminalOutputEvent)
    })
  },
}
