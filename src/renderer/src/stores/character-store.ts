import { create } from 'zustand'
import type { Character, AgitoPersistentData } from '../../../shared/types'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'

interface CharacterStore {
  characters: Character[]
  loadFromMain: () => Promise<void>
  setCharacters: (characters: Character[]) => void
  addCharacter: (character: Character) => void
  removeCharacter: (characterId: string) => void
}

export const useCharacterStore = create<CharacterStore>((set, get) => ({
  characters: [],

  loadFromMain: async () => {
    const data = await window.api.invoke<AgitoPersistentData>(IPC_COMMANDS.STORE_READ)
    set({ characters: data.characters })
  },

  setCharacters: (characters) => set({ characters }),

  addCharacter: (character) => {
    const updated = [...get().characters, character]
    set({ characters: updated })
    window.api.invoke(IPC_COMMANDS.STORE_WRITE, 'characters', updated)
  },

  removeCharacter: (characterId) => {
    const updated = get().characters.filter((c) => c.id !== characterId)
    set({ characters: updated })
    window.api.invoke(IPC_COMMANDS.STORE_WRITE, 'characters', updated)
  },
}))
