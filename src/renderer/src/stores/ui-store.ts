import { create } from 'zustand'
import type { AssetCategory, TerminalDockSyncState } from '../../../shared/types'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import {
  createEmptyDockLayout,
  getActiveCharacterId,
  type DockLayout,
} from '../../../shared/terminal-dock-layout'

export type AppTab = 'runtime' | 'layout' | 'generate' | 'characters' | 'settings'
export type ThemeMode = 'system' | 'light' | 'dark'
export type GenerateView = 'generator' | 'buy_credits'

interface ContextMenuState {
  characterId: string
  x: number
  y: number
}

interface TerminalDockState {
  floatMode: boolean
  terminalVisible: boolean
  barVisible: boolean
  focusedPaneId: string
  activeCharacterId: string | null
  layout: DockLayout
}

interface UIStore {
  activeTab: AppTab
  generateView: GenerateView
  preferredGenerateCategory: AssetCategory | null
  sidebarExpanded: boolean
  selectedCharacterId: string | null
  panelWidth: number
  contextMenu: ContextMenuState | null
  terminalDock: TerminalDockState
  terminalRefreshKey: Record<string, number>
  draggingManifestId: string | null
  selectedLayoutItem: { type: 'furniture'; id: string } | { type: 'character'; id: string } | null
  isDraggingItem: boolean
  layoutContextMenu: {
    type: 'furniture' | 'character'
    id: string
    x: number
    y: number
  } | null
  layoutClipboard:
    | {
        type: 'furniture'
        manifestId: string
        footprint: { w: number; h: number }
      }
    | {
        type: 'character'
        id: string
        name: string
      }
    | null
  theme: ThemeMode
  setActiveTab: (tab: AppTab) => void
  openBuyCredits: () => void
  openGenerateHome: (category?: AssetCategory) => void
  consumePreferredGenerateCategory: () => void
  toggleSidebar: () => void
  selectCharacter: (id: string | null) => void
  setPanelWidth: (width: number) => void
  openContextMenu: (characterId: string, x: number, y: number) => void
  closeContextMenu: () => void
  setDraggingManifestId: (id: string | null) => void
  selectLayoutItem: (item: { type: 'furniture' | 'character'; id: string } | null) => void
  setIsDraggingItem: (dragging: boolean) => void
  openLayoutContextMenu: (type: 'furniture' | 'character', id: string, x: number, y: number) => void
  closeLayoutContextMenu: () => void
  setLayoutClipboard: (item: UIStore['layoutClipboard']) => void
  setTheme: (theme: ThemeMode) => void
  showMainDock: () => void
  openTerminalDock: (characterId: string) => void
  closeTerminalDock: () => void
  setTerminalDockFloatMode: (enabled: boolean) => void
  setTerminalDockLayout: (layout: DockLayout) => void
  syncTerminalDock: (state: TerminalDockSyncState) => void
  bumpTerminalRefreshKey: (characterId: string) => void
}

const initialDockLayout = createEmptyDockLayout()

export const useUIStore = create<UIStore>((set) => ({
  activeTab: 'runtime',
  generateView: 'generator',
  preferredGenerateCategory: null,
  sidebarExpanded: false,
  selectedCharacterId: null,
  panelWidth: 50,
  contextMenu: null,
  terminalDock: {
    floatMode: false,
    terminalVisible: false,
    barVisible: false,
    focusedPaneId: initialDockLayout.focusedPaneId,
    activeCharacterId: null,
    layout: initialDockLayout,
  },
  terminalRefreshKey: {},
  draggingManifestId: null,
  selectedLayoutItem: null,
  isDraggingItem: false,
  layoutContextMenu: null,
  layoutClipboard: null,
  theme: 'dark',
  setActiveTab: (tab) =>
    set({
      activeTab: tab,
      generateView: 'generator',
      preferredGenerateCategory: null,
      contextMenu: null,
      selectedLayoutItem: null,
    }),
  openBuyCredits: () =>
    set({
      activeTab: 'generate',
      generateView: 'buy_credits',
      preferredGenerateCategory: null,
      contextMenu: null,
      selectedLayoutItem: null,
    }),
  openGenerateHome: (category) =>
    set({
      activeTab: 'generate',
      generateView: 'generator',
      preferredGenerateCategory: category ?? null,
      contextMenu: null,
      selectedLayoutItem: null,
    }),
  consumePreferredGenerateCategory: () => set({ preferredGenerateCategory: null }),
  toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
  selectCharacter: (id) => set({ selectedCharacterId: id }),
  setPanelWidth: (width) => set({ panelWidth: Math.max(30, Math.min(70, width)) }),
  openContextMenu: (characterId, x, y) => set({ contextMenu: { characterId, x, y } }),
  closeContextMenu: () => set({ contextMenu: null }),
  setDraggingManifestId: (id) => set({ draggingManifestId: id }),
  selectLayoutItem: (item) => set({ selectedLayoutItem: item }),
  setIsDraggingItem: (dragging) => set({ isDraggingItem: dragging }),
  openLayoutContextMenu: (type, id, x, y) => set({ layoutContextMenu: { type, id, x, y } }),
  closeLayoutContextMenu: () => set({ layoutContextMenu: null }),
  setLayoutClipboard: (item) => set({ layoutClipboard: item }),
  setTheme: (theme) => set({ theme }),
  showMainDock: () => {
    void window.api.invoke(IPC_COMMANDS.MAIN_WINDOW_SHOW)
  },
  openTerminalDock: (characterId) => {
    void window.api.invoke(IPC_COMMANDS.TERMINAL_DOCK_SHOW, { characterId })
  },
  closeTerminalDock: () => {
    void window.api.invoke(IPC_COMMANDS.TERMINAL_DOCK_HIDE)
  },
  setTerminalDockFloatMode: (enabled) => {
    void window.api.invoke(IPC_COMMANDS.TERMINAL_DOCK_SET_FLOAT_MODE, { enabled })
  },
  setTerminalDockLayout: (layout) =>
    set((s) => {
      void window.api.invoke(IPC_COMMANDS.TERMINAL_DOCK_SET_LAYOUT, {
        layout,
        focusedPaneId: layout.focusedPaneId,
        activeCharacterId: getActiveCharacterId(layout),
      })

      return {
        terminalDock: {
          ...s.terminalDock,
          layout,
          focusedPaneId: layout.focusedPaneId,
          activeCharacterId: getActiveCharacterId(layout),
        },
      }
    }),
  syncTerminalDock: (state) =>
    set((s) => ({
      terminalDock: {
        ...s.terminalDock,
        floatMode: state.floatMode,
        terminalVisible: state.terminalVisible,
        barVisible: state.barVisible,
        focusedPaneId: state.focusedPaneId,
        activeCharacterId: state.activeCharacterId,
        layout: state.layout,
      },
    })),
  bumpTerminalRefreshKey: (characterId) =>
    set((s) => ({
      terminalRefreshKey: {
        ...s.terminalRefreshKey,
        [characterId]: (s.terminalRefreshKey[characterId] ?? 0) + 1,
      },
    })),
}))
