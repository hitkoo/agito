import { create } from 'zustand'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import type { CharacterRuntimeState } from '../../../shared/character-runtime-state'
import type { AgitoPersistentData } from '../../../shared/types'

interface RuntimeStore {
  states: Record<string, CharacterRuntimeState>
  loadFromMain: () => Promise<void>
  syncStates: (states: CharacterRuntimeState[]) => void
  updateState: (state: CharacterRuntimeState) => void
}

export const useRuntimeStore = create<RuntimeStore>((set) => ({
  states: {},

  loadFromMain: async () => {
    const data = await window.api.invoke<AgitoPersistentData>(IPC_COMMANDS.STORE_READ)
    const runtimeStates = data.runtimeStates ?? []
    const nextStates: Record<string, CharacterRuntimeState> = {}
    for (const state of runtimeStates) {
      nextStates[state.characterId] = state
    }
    set({ states: nextStates })
  },

  syncStates: (states) => {
    const nextStates: Record<string, CharacterRuntimeState> = {}
    for (const state of states) {
      nextStates[state.characterId] = state
    }
    set({ states: nextStates })
  },

  updateState: (state) =>
    set((current) => ({
      states: {
        ...current.states,
        [state.characterId]: state,
      },
    })),
}))
