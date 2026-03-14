import { create } from 'zustand'

export type AppTab = 'runtime' | 'layout' | 'settings'
export type ThemeMode = 'system' | 'light' | 'dark'

interface ContextMenuState {
  characterId: string
  x: number
  y: number
}

interface UIStore {
  // Tab navigation
  activeTab: AppTab
  sidebarExpanded: boolean

  // Runtime mode
  selectedCharacterId: string | null
  panelWidth: number
  contextMenu: ContextMenuState | null

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
}))
