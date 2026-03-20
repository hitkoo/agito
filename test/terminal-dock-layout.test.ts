import { describe, expect, test } from 'bun:test'
import {
  activatePaneSurface,
  closeDockSurface,
  createEmptyDockLayout,
  ensureCharacterSurface,
  findCharacterSurface,
  focusDockPane,
  getActiveCharacterId,
  getPaneById,
  listOpenCharacterIds,
  listPaneCharacterIds,
  moveSurfaceToPane,
  removeDockPane,
  reorderPaneSurface,
  splitDockPane,
  type DockLayout,
} from '../src/shared/terminal-dock-layout'

function expectPane(layout: DockLayout, paneId: string) {
  const pane = getPaneById(layout, paneId)
  expect(pane).not.toBeNull()
  return pane!
}

describe('createEmptyDockLayout', () => {
  test('starts with one empty pane', () => {
    const layout = createEmptyDockLayout()
    const pane = expectPane(layout, layout.root.id)

    expect(layout.focusedPaneId).toBe(layout.root.id)
    expect(pane.type).toBe('pane')
    expect(pane.surfaces).toEqual([])
    expect(pane.activeSurfaceId).toBeNull()
  })
})

describe('ensureCharacterSurface', () => {
  test('adds a missing character to the focused pane and activates it', () => {
    const layout = ensureCharacterSurface(createEmptyDockLayout(), 'char-1')
    const pane = expectPane(layout, layout.focusedPaneId)

    expect(pane.surfaces.map((surface) => surface.characterId)).toEqual(['char-1'])
    expect(getActiveCharacterId(layout)).toBe('char-1')
  })

  test('focuses an existing character instead of duplicating it', () => {
    let layout = ensureCharacterSurface(createEmptyDockLayout(), 'char-1')
    layout = splitDockPane(layout, layout.focusedPaneId, 'horizontal')
    layout = ensureCharacterSurface(layout, 'char-2')
    layout = ensureCharacterSurface(layout, 'char-1')

    expect(getActiveCharacterId(layout)).toBe('char-1')
    expect(layout.focusedPaneId).not.toBeNull()
    expect(listPaneCharacterIds(layout)).toEqual([['char-1'], ['char-2']])
  })
})

describe('layout lookup helpers', () => {
  test('lists every open character id in pane order', () => {
    let layout = ensureCharacterSurface(createEmptyDockLayout(), 'char-1')
    layout = ensureCharacterSurface(layout, 'char-2')
    const firstPaneId = layout.focusedPaneId
    layout = splitDockPane(layout, firstPaneId, 'horizontal')
    layout = ensureCharacterSurface(layout, 'char-3')

    expect(listOpenCharacterIds(layout)).toEqual(['char-1', 'char-2', 'char-3'])
  })

  test('finds the pane and surface for an open character', () => {
    let layout = ensureCharacterSurface(createEmptyDockLayout(), 'char-1')
    const firstPaneId = layout.focusedPaneId
    layout = splitDockPane(layout, firstPaneId, 'horizontal')
    const secondPaneId = layout.focusedPaneId
    layout = ensureCharacterSurface(layout, 'char-2')

    expect(findCharacterSurface(layout, 'char-2')).toMatchObject({
      paneId: secondPaneId,
      surface: {
        characterId: 'char-2',
      },
    })
    expect(findCharacterSurface(layout, 'missing')).toBeNull()
  })
})

describe('splitDockPane', () => {
  test('replaces the target pane with a split and creates a new empty sibling pane', () => {
    let layout = ensureCharacterSurface(createEmptyDockLayout(), 'char-1')
    const originalPaneId = layout.focusedPaneId
    layout = splitDockPane(layout, originalPaneId, 'vertical')

    expect(layout.root.type).toBe('split')
    expect(layout.focusedPaneId).not.toBe(originalPaneId)
    expectPane(layout, originalPaneId)
    expectPane(layout, layout.focusedPaneId)
    expect(getActiveCharacterId(layout)).toBeNull()
  })
})

describe('reorderPaneSurface', () => {
  test('reorders surfaces within a pane', () => {
    let layout = ensureCharacterSurface(createEmptyDockLayout(), 'char-1')
    layout = ensureCharacterSurface(layout, 'char-2')
    layout = ensureCharacterSurface(layout, 'char-3')

    layout = reorderPaneSurface(layout, layout.focusedPaneId, 'char-3', 0)

    const pane = expectPane(layout, layout.focusedPaneId)
    expect(pane.surfaces.map((surface) => surface.characterId)).toEqual([
      'char-3',
      'char-1',
      'char-2',
    ])
    expect(pane.activeSurfaceId).toBe(pane.surfaces[0]?.id ?? null)
  })
})

describe('moveSurfaceToPane', () => {
  test('moves a surface into another pane and focuses the destination pane', () => {
    let layout = ensureCharacterSurface(createEmptyDockLayout(), 'char-1')
    const firstPaneId = layout.focusedPaneId
    layout = splitDockPane(layout, firstPaneId, 'horizontal')
    const secondPaneId = layout.focusedPaneId
    layout = ensureCharacterSurface(layout, 'char-2')

    layout = moveSurfaceToPane(layout, 'char-1', secondPaneId, 1)

    expect(layout.focusedPaneId).toBe(secondPaneId)
    expect(expectPane(layout, firstPaneId).surfaces).toEqual([])
    expect(expectPane(layout, secondPaneId).surfaces.map((surface) => surface.characterId)).toEqual([
      'char-2',
      'char-1',
    ])
    expect(getActiveCharacterId(layout)).toBe('char-1')
  })
})

describe('closeDockSurface', () => {
  test('removes the surface from the pane without removing the pane', () => {
    let layout = ensureCharacterSurface(createEmptyDockLayout(), 'char-1')
    const paneId = layout.focusedPaneId
    layout = closeDockSurface(layout, paneId, 'char-1')

    expect(expectPane(layout, paneId).surfaces).toEqual([])
    expect(getActiveCharacterId(layout)).toBeNull()
  })
})

describe('activatePaneSurface', () => {
  test('updates the pane active surface and focuses that pane', () => {
    let layout = ensureCharacterSurface(createEmptyDockLayout(), 'char-1')
    layout = ensureCharacterSurface(layout, 'char-2')
    const pane = expectPane(layout, layout.focusedPaneId)
    const firstSurfaceId = pane.surfaces[0]?.id

    expect(firstSurfaceId).toBeTruthy()
    layout = activatePaneSurface(layout, pane.id, firstSurfaceId!)

    expect(expectPane(layout, pane.id).activeSurfaceId).toBe(firstSurfaceId)
    expect(getActiveCharacterId(layout)).toBe('char-1')
  })
})

describe('focusDockPane', () => {
  test('returns the same layout when the pane is already focused', () => {
    const layout = createEmptyDockLayout()

    expect(focusDockPane(layout, layout.focusedPaneId)).toBe(layout)
  })

  test('focuses a different pane without changing the pane tree', () => {
    let layout = ensureCharacterSurface(createEmptyDockLayout(), 'char-1')
    const firstPaneId = layout.focusedPaneId
    layout = splitDockPane(layout, firstPaneId, 'horizontal')
    const secondPaneId = layout.focusedPaneId

    const next = focusDockPane(layout, firstPaneId)

    expect(next).not.toBe(layout)
    expect(next.focusedPaneId).toBe(firstPaneId)
    expect(listPaneCharacterIds(next)).toEqual(listPaneCharacterIds(layout))
    expect(getPaneById(next, secondPaneId)).not.toBeNull()
  })
})

describe('removeDockPane', () => {
  test('collapses the split tree and keeps the surviving pane focused', () => {
    let layout = ensureCharacterSurface(createEmptyDockLayout(), 'char-1')
    const firstPaneId = layout.focusedPaneId
    layout = splitDockPane(layout, firstPaneId, 'horizontal')
    const secondPaneId = layout.focusedPaneId
    layout = ensureCharacterSurface(layout, 'char-2')

    layout = removeDockPane(layout, secondPaneId)

    expect(layout.root.type).toBe('pane')
    expect(layout.focusedPaneId).toBe(firstPaneId)
    expect(listPaneCharacterIds(layout)).toEqual([['char-1']])
    expect(getActiveCharacterId(layout)).toBe('char-1')
  })
})
