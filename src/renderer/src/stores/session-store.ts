import { create } from 'zustand'
import type { SessionMapping, AgitoPersistentData } from '../../../shared/types'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'

interface SessionStore {
  sessions: SessionMapping[]
  loadFromMain: () => Promise<void>
  setSessions: (sessions: SessionMapping[]) => void
  addSession: (session: SessionMapping) => void
  removeSession: (sessionId: string) => void
  getSessionForCharacter: (characterId: string) => SessionMapping | undefined
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],

  loadFromMain: async () => {
    const data = await window.api.invoke<AgitoPersistentData>(IPC_COMMANDS.STORE_READ)
    set({ sessions: data.sessions })
  },

  setSessions: (sessions) => set({ sessions }),

  addSession: (session) => {
    const updated = [...get().sessions, session]
    set({ sessions: updated })
  },

  removeSession: (sessionId) => {
    const updated = get().sessions.filter((s) => s.sessionId !== sessionId)
    set({ sessions: updated })
  },

  getSessionForCharacter: (characterId) => {
    return get().sessions.find((s) => s.characterId === characterId)
  },
}))
