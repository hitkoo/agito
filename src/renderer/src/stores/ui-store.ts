import { create } from 'zustand'

export type AppTab = 'runtime' | 'layout' | 'generate' | 'characters' | 'settings'
export type ThemeMode = 'system' | 'light' | 'dark'

interface ContextMenuState {
  characterId: string
  x: number
  y: number
}

interface TerminalDockState {
  visible: boolean
  minimized: boolean
  activeCharacterId: string | null
  position: { x: number; y: number }
  size: { width: number; height: number }
}

interface UIStore {
  // Tab navigation
  activeTab: AppTab
  sidebarExpanded: boolean

  // Runtime mode
  selectedCharacterId: string | null
  panelWidth: number
  contextMenu: ContextMenuState | null

  // Terminal dock
  terminalDock: TerminalDockState

  // Layout mode
  draggingManifestId: string | null
  selectedLayoutItem: { type: 'furniture'; id: string } | { type: 'character'; id: string } | null
  isDraggingItem: boolean
  layoutContextMenu: {
    type: 'furniture' | 'character'
    id: string
    x: number
    y: number
  } | null
  layoutClipboard: {
    type: 'furniture'
    manifestId: string
    footprint: { w: number; h: number }
  } | {
    type: 'character'
    id: string
    name: string
  } | null

  // Theme
  theme: ThemeMode

  // Actions
  setActiveTab: (tab: AppTab) => void
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

  // Terminal dock actions
  openTerminalDock: (characterId: string) => void
  closeTerminalDock: () => void
  minimizeTerminalDock: () => void
  restoreTerminalDock: () => void
  setDockActiveCharacter: (characterId: string) => void
  setDockPosition: (position: { x: number; y: number }) => void
  setDockSize: (size: { width: number; height: number }) => void
}

export const useUIStore = create<UIStore>((set) => ({
  activeTab: 'runtime',
  sidebarExpanded: false,

  selectedCharacterId: null,
  panelWidth: 50,
  contextMenu: null,

  draggingManifestId: null,
  selectedLayoutItem: null,
  isDraggingItem: false,
  layoutContextMenu: null,
  layoutClipboard: null,

  theme: 'dark',

  terminalDock: {
    visible: false,
    minimized: false,
    activeCharacterId: null,
    position: { x: -1, y: -1 }, // -1 = auto-center on first open
    size: { width: 720, height: 520 },
  },

  setActiveTab: (tab) => set({ activeTab: tab, contextMenu: null, selectedLayoutItem: null }),
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

  openTerminalDock: (characterId) =>
    set((s) => ({
      terminalDock: { ...s.terminalDock, visible: true, minimized: false, activeCharacterId: characterId },
    })),
  closeTerminalDock: () =>
    set((s) => ({
      terminalDock: { ...s.terminalDock, visible: false },
    })),
  minimizeTerminalDock: () =>
    set((s) => ({
      terminalDock: { ...s.terminalDock, minimized: true },
    })),
  restoreTerminalDock: () =>
    set((s) => ({
      terminalDock: { ...s.terminalDock, minimized: false },
    })),
  setDockActiveCharacter: (characterId) =>
    set((s) => ({
      terminalDock: { ...s.terminalDock, activeCharacterId: characterId },
    })),
  setDockPosition: (position) =>
    set((s) => ({
      terminalDock: { ...s.terminalDock, position },
    })),
  setDockSize: (size) =>
    set((s) => ({
      terminalDock: { ...s.terminalDock, size },
    })),
}))
