import { create } from 'zustand'
import type { RoomLayout, PlacedItem, GridPosition, AgitoPersistentData, ItemFootprint } from '../../../shared/types'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import { GRID_COLS, GRID_ROWS } from '../../../shared/constants'

function cellKey(x: number, y: number): string {
  return `${x},${y}`
}

function buildOccupiedSet(items: PlacedItem[]): Set<string> {
  const set = new Set<string>()
  for (const item of items) {
    for (let dy = 0; dy < item.footprint.h; dy++) {
      for (let dx = 0; dx < item.footprint.w; dx++) {
        set.add(cellKey(item.position.x + dx, item.position.y + dy))
      }
    }
  }
  return set
}

interface RoomStore {
  layout: RoomLayout
  occupiedCells: Set<string>
  loadFromMain: () => Promise<void>
  setLayout: (layout: RoomLayout) => void
  addItem: (item: PlacedItem) => void
  removeItem: (itemId: string) => void
  moveItem: (itemId: string, newPosition: GridPosition) => void
  resizeItem: (itemId: string, newFootprint: ItemFootprint) => void
  updateItemZOrder: (itemId: string, zOrder: number) => void
  findEmptyPosition: (width: number, height: number) => GridPosition | null
}

export const useRoomStore = create<RoomStore>((set, get) => ({
  layout: { background: '', items: [] },
  occupiedCells: new Set<string>(),

  loadFromMain: async () => {
    const data = await window.api.invoke<AgitoPersistentData>(IPC_COMMANDS.STORE_READ)
    set({
      layout: data.roomLayout,
      occupiedCells: buildOccupiedSet(data.roomLayout.items),
    })
  },

  setLayout: (layout) =>
    set({ layout, occupiedCells: buildOccupiedSet(layout.items) }),

  addItem: (item) => {
    const updated = { ...get().layout, items: [...get().layout.items, item] }
    set({ layout: updated, occupiedCells: buildOccupiedSet(updated.items) })
    window.api.invoke(IPC_COMMANDS.STORE_WRITE, 'roomLayout', updated)
  },

  removeItem: (itemId) => {
    const updated = {
      ...get().layout,
      items: get().layout.items.filter((i) => i.id !== itemId),
    }
    set({ layout: updated, occupiedCells: buildOccupiedSet(updated.items) })
    window.api.invoke(IPC_COMMANDS.STORE_WRITE, 'roomLayout', updated)
  },

  moveItem: (itemId, newPosition) => {
    const updated = {
      ...get().layout,
      items: get().layout.items.map((i) =>
        i.id === itemId ? { ...i, position: newPosition } : i
      ),
    }
    set({ layout: updated, occupiedCells: buildOccupiedSet(updated.items) })
    window.api.invoke(IPC_COMMANDS.STORE_WRITE, 'roomLayout', updated)
  },

  resizeItem: (itemId, newFootprint) => {
    const updated = {
      ...get().layout,
      items: get().layout.items.map((i) =>
        i.id === itemId ? { ...i, footprint: newFootprint } : i
      ),
    }
    set({ layout: updated, occupiedCells: buildOccupiedSet(updated.items) })
    window.api.invoke(IPC_COMMANDS.STORE_WRITE, 'roomLayout', updated)
  },

  updateItemZOrder: (itemId, zOrder) => {
    const updated = {
      ...get().layout,
      items: get().layout.items.map((i) =>
        i.id === itemId ? { ...i, zOrder } : i
      ),
    }
    set({ layout: updated, occupiedCells: buildOccupiedSet(updated.items) })
    window.api.invoke(IPC_COMMANDS.STORE_WRITE, 'roomLayout', updated)
  },

  findEmptyPosition: (width, height) => {
    const occupied = get().occupiedCells
    for (let y = 0; y <= GRID_ROWS - height; y++) {
      for (let x = 0; x <= GRID_COLS - width; x++) {
        let fits = true
        for (let dy = 0; dy < height && fits; dy++) {
          for (let dx = 0; dx < width && fits; dx++) {
            if (occupied.has(cellKey(x + dx, y + dy))) fits = false
          }
        }
        if (fits) return { x, y }
      }
    }
    return null
  },
}))
