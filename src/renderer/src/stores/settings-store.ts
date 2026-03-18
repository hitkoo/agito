import { create } from 'zustand'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import type { AgitoSettings } from '../../../shared/types'
import { resolveAgitoSettings } from '../../../shared/settings'

interface SettingsStore {
  settings: AgitoSettings
  loadFromMain: () => Promise<void>
  saveSettings: (settings: AgitoSettings) => Promise<void>
  setTerminalFontSize: (size: number) => Promise<void>
  setTerminalFontFamilies: (families: string[]) => Promise<void>
}

const INITIAL_SETTINGS = resolveAgitoSettings(null)

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: INITIAL_SETTINGS,

  loadFromMain: async () => {
    const settings = await window.api.invoke<AgitoSettings>(IPC_COMMANDS.SETTINGS_READ)
    set({ settings: resolveAgitoSettings(settings) })
  },

  saveSettings: async (settings) => {
    const nextSettings = resolveAgitoSettings(settings)
    set({ settings: nextSettings })
    await window.api.invoke(IPC_COMMANDS.SETTINGS_WRITE, nextSettings)
  },

  setTerminalFontSize: async (size) => {
    const nextSettings = resolveAgitoSettings({
      ...get().settings,
      terminalFontSize: size,
    })
    set({ settings: nextSettings })
    await window.api.invoke(IPC_COMMANDS.SETTINGS_WRITE, nextSettings)
  },

  setTerminalFontFamilies: async (families) => {
    const nextSettings = resolveAgitoSettings({
      ...get().settings,
      terminalFontFamilies: families,
    })
    set({ settings: nextSettings })
    await window.api.invoke(IPC_COMMANDS.SETTINGS_WRITE, nextSettings)
  },
}))
