import { create } from 'zustand'
import type { RoomLayout, PlacedItem, GridPosition, AgitoPersistentData, ItemFootprint, CropRect } from '../../../shared/types'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import { GRID_COLS, GRID_ROWS, MIN_GRID_COLS, MIN_GRID_ROWS, MAX_GRID_COLS, MAX_GRID_ROWS } from '../../../shared/constants'

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
  gridCols: number
  gridRows: number
  occupiedCells: Set<string>
  loadFromMain: () => Promise<void>
  setLayout: (layout: RoomLayout) => void
  setGridSize: (cols: number, rows: number) => void
  addItem: (item: PlacedItem) => void
  removeItem: (itemId: string) => void
  moveItem: (itemId: string, newPosition: GridPosition) => void
  resizeItem: (itemId: string, newFootprint: ItemFootprint) => void
  updateItemZOrder: (itemId: string, zOrder: number) => void
  findEmptyPosition: (width: number, height: number) => GridPosition | null
  rotateItem: (itemId: string, degrees: 90 | -90) => void
  flipItem: (itemId: string, axis: 'x' | 'y') => void
  cropItem: (itemId: string, crop: CropRect | null) => void
}

export const useRoomStore = create<RoomStore>((set, get) => ({
  layout: { background: '', items: [], gridCols: GRID_COLS, gridRows: GRID_ROWS },
  gridCols: GRID_COLS,
  gridRows: GRID_ROWS,
  occupiedCells: new Set<string>(),

  loadFromMain: async () => {
    const data = await window.api.invoke<AgitoPersistentData>(IPC_COMMANDS.STORE_READ)
    const cols = data.roomLayout.gridCols ?? GRID_COLS
    const rows = data.roomLayout.gridRows ?? GRID_ROWS
    set({
      layout: { ...data.roomLayout, gridCols: cols, gridRows: rows },
      gridCols: cols,
      gridRows: rows,
      occupiedCells: buildOccupiedSet(data.roomLayout.items),
    })
  },

  setLayout: (layout) =>
    set({ layout, occupiedCells: buildOccupiedSet(layout.items) }),

  setGridSize: (cols, rows) => {
    const clampedCols = Math.max(MIN_GRID_COLS, Math.min(MAX_GRID_COLS, cols))
    const clampedRows = Math.max(MIN_GRID_ROWS, Math.min(MAX_GRID_ROWS, rows))
    const updated = { ...get().layout, gridCols: clampedCols, gridRows: clampedRows }
    set({ layout: updated, gridCols: clampedCols, gridRows: clampedRows })
    window.api.invoke(IPC_COMMANDS.STORE_WRITE, 'roomLayout', updated)
  },

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
    const cols = get().gridCols
    const rows = get().gridRows
    for (let y = 0; y <= rows - height; y++) {
      for (let x = 0; x <= cols - width; x++) {
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

  rotateItem: (itemId, degrees) => {
    const updated = {
      ...get().layout,
      items: get().layout.items.map((i) => {
        if (i.id !== itemId) return i
        const current = i.rotation ?? 0
        const next = ((current + degrees) % 360 + 360) % 360 as 0 | 90 | 180 | 270
        return { ...i, rotation: next }
      }),
    }
    set({ layout: updated, occupiedCells: buildOccupiedSet(updated.items) })
    window.api.invoke(IPC_COMMANDS.STORE_WRITE, 'roomLayout', updated)
  },

  flipItem: (itemId, axis) => {
    const updated = {
      ...get().layout,
      items: get().layout.items.map((i) => {
        if (i.id !== itemId) return i
        return axis === 'x' ? { ...i, flipX: !i.flipX } : { ...i, flipY: !i.flipY }
      }),
    }
    set({ layout: updated, occupiedCells: buildOccupiedSet(updated.items) })
    window.api.invoke(IPC_COMMANDS.STORE_WRITE, 'roomLayout', updated)
  },

  cropItem: (itemId, crop) => {
    const updated = {
      ...get().layout,
      items: get().layout.items.map((i) =>
        i.id === itemId ? { ...i, crop } : i
      ),
    }
    set({ layout: updated, occupiedCells: buildOccupiedSet(updated.items) })
    window.api.invoke(IPC_COMMANDS.STORE_WRITE, 'roomLayout', updated)
  },
}))
