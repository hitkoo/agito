import { describe, expect, test } from 'bun:test'
import type { Character } from '../src/shared/types'
import {
  createEmptyDockLayout,
  ensureCharacterSurface,
  findCharacterSurface,
  getActiveCharacterId,
} from '../src/shared/terminal-dock-layout'
import {
  getResizedTerminalDockFooterHeight,
  getCharacterStatusBadgeState,
  getCharacterDockPresence,
  getClosedCharacters,
  getOpenCharactersInGlobalOrder,
  getCharacterStatusIndicator,
  getSurfaceReorderIndexFromDropTarget,
  getSurfaceDropInsertIndex,
  getLayoutForGlobalCharacterSessionAction,
  resolveTerminalDockFooterHeight,
} from '../src/renderer/src/panel/terminal-dock-ui'

function makeCharacter(id: string, name = id): Character {
  return {
    id,
    name,
    soul: 'souls/default.md',
    skin: '',
    engine: null,
    gridPosition: null,
    currentSessionId: null,
    sessionHistory: [],
    stats: {
      createdAt: '2026-01-01T00:00:00.000Z',
      totalTasks: 0,
      totalCommits: 0,
    },
  }
}

describe('getClosedCharacters', () => {
  test('filters out characters that are already open in any pane', () => {
    let layout = ensureCharacterSurface(createEmptyDockLayout(), 'char-1')
    layout = ensureCharacterSurface(layout, 'char-2')
    const characters = [makeCharacter('char-1'), makeCharacter('char-2'), makeCharacter('char-3')]

    expect(getClosedCharacters(characters, layout).map((character) => character.id)).toEqual(['char-3'])
  })
})

describe('getOpenCharactersInGlobalOrder', () => {
  test('keeps the global footer order while filtering to open characters', () => {
    let layout = ensureCharacterSurface(createEmptyDockLayout(), 'char-3')
    layout = ensureCharacterSurface(layout, 'char-1')
    const characters = [makeCharacter('char-1'), makeCharacter('char-2'), makeCharacter('char-3')]

    expect(getOpenCharactersInGlobalOrder(characters, layout).map((character) => character.id)).toEqual([
      'char-1',
      'char-3',
    ])
  })
})

describe('getCharacterDockPresence', () => {
  test('distinguishes focused active, open elsewhere, and closed characters', () => {
    let layout = ensureCharacterSurface(createEmptyDockLayout(), 'char-1')
    layout = ensureCharacterSurface(layout, 'char-2')

    expect(getCharacterDockPresence(layout, 'char-2')).toBe('focused-active')
    expect(getCharacterDockPresence(layout, 'char-1')).toBe('open')
    expect(getCharacterDockPresence(layout, 'char-3')).toBe('closed')
  })
})

describe('getLayoutForGlobalCharacterSessionAction', () => {
  test('assign opens or focuses the character surface', () => {
    const layout = getLayoutForGlobalCharacterSessionAction(createEmptyDockLayout(), 'char-1', 'assign')

    expect(getActiveCharacterId(layout)).toBe('char-1')
    expect(findCharacterSurface(layout, 'char-1')).not.toBeNull()
  })

  test('reassign focuses an existing character surface instead of duplicating it', () => {
    let layout = ensureCharacterSurface(createEmptyDockLayout(), 'char-1')
    layout = ensureCharacterSurface(layout, 'char-2')

    const next = getLayoutForGlobalCharacterSessionAction(layout, 'char-1', 'reassign')

    expect(getActiveCharacterId(next)).toBe('char-1')
    expect(findCharacterSurface(next, 'char-1')).not.toBeNull()
    expect(findCharacterSurface(next, 'char-2')).not.toBeNull()
  })

  test('unassign leaves the dock layout untouched', () => {
    let layout = ensureCharacterSurface(createEmptyDockLayout(), 'char-1')
    layout = ensureCharacterSurface(layout, 'char-2')

    const next = getLayoutForGlobalCharacterSessionAction(layout, 'char-1', 'unassign')

    expect(next).toBe(layout)
  })
})

describe('getCharacterStatusIndicator', () => {
  test('returns spinner only for running status', () => {
    expect(getCharacterStatusIndicator('running')).toBe('spinner')
    expect(getCharacterStatusIndicator('idle')).toBe('dot')
    expect(getCharacterStatusIndicator('need_input')).toBe('dot')
    expect(getCharacterStatusIndicator('done')).toBe('dot')
    expect(getCharacterStatusIndicator('error')).toBe('dot')
    expect(getCharacterStatusIndicator('no_session')).toBe('dot')
  })
})

describe('getCharacterStatusBadgeState', () => {
  test('uses a slightly brighter tone for the running spinner', () => {
    expect(getCharacterStatusBadgeState('running')).toEqual({
      indicator: 'spinner',
      color: '#959eab',
      pulse: false,
      ring: false,
    })
  })

  test('restores pulse and ring effects for need_input', () => {
    expect(getCharacterStatusBadgeState('need_input')).toEqual({
      indicator: 'dot',
      color: '#51cf66',
      pulse: true,
      ring: true,
    })
  })
})

describe('resolveTerminalDockFooterHeight', () => {
  test('falls back to the default height when no saved value exists', () => {
    expect(resolveTerminalDockFooterHeight(null)).toBe(40)
    expect(resolveTerminalDockFooterHeight(undefined)).toBe(40)
    expect(resolveTerminalDockFooterHeight('')).toBe(40)
    expect(resolveTerminalDockFooterHeight('not-a-number')).toBe(40)
  })

  test('clamps saved values into the supported range', () => {
    expect(resolveTerminalDockFooterHeight('24')).toBe(40)
    expect(resolveTerminalDockFooterHeight('72')).toBe(72)
    expect(resolveTerminalDockFooterHeight('999')).toBe(128)
  })
})

describe('getResizedTerminalDockFooterHeight', () => {
  test('grows when dragging the footer boundary upward', () => {
    expect(getResizedTerminalDockFooterHeight(40, -24)).toBe(64)
  })

  test('shrinks when dragging downward but respects the minimum height', () => {
    expect(getResizedTerminalDockFooterHeight(40, 4)).toBe(40)
    expect(getResizedTerminalDockFooterHeight(40, 20)).toBe(40)
  })
})

describe('getSurfaceDropInsertIndex', () => {
  test('does not move to the next slot while still hovering the dragged tab in the same pane', () => {
    let layout = ensureCharacterSurface(createEmptyDockLayout(), 'char-1')
    layout = ensureCharacterSurface(layout, 'char-2')
    layout = ensureCharacterSurface(layout, 'char-3')

    const dragged = findCharacterSurface(layout, 'char-1')
    expect(dragged).not.toBeNull()

    expect(
      getSurfaceDropInsertIndex({
        layout,
        draggedSurfaceId: dragged!.surface.id,
        targetPaneId: dragged!.paneId,
        targetIndex: 0,
        clientX: 90,
        left: 0,
        width: 100,
      })
    ).toBe(0)
  })

  test('keeps the current slot while hovering the left side of the adjacent right tab', () => {
    let layout = ensureCharacterSurface(createEmptyDockLayout(), 'char-1')
    layout = ensureCharacterSurface(layout, 'char-2')
    layout = ensureCharacterSurface(layout, 'char-3')

    const dragged = findCharacterSurface(layout, 'char-1')
    expect(dragged).not.toBeNull()

    expect(
      getSurfaceDropInsertIndex({
        layout,
        draggedSurfaceId: dragged!.surface.id,
        targetPaneId: dragged!.paneId,
        targetIndex: 1,
        clientX: 60,
        left: 0,
        width: 100,
      })
    ).toBe(0)

    expect(
      getSurfaceDropInsertIndex({
        layout,
        draggedSurfaceId: dragged!.surface.id,
        targetPaneId: dragged!.paneId,
        targetIndex: 1,
        clientX: 90,
        left: 0,
        width: 100,
      })
    ).toBe(2)
  })

  test('keeps midpoint behavior when moving left in the same pane', () => {
    let layout = ensureCharacterSurface(createEmptyDockLayout(), 'char-1')
    layout = ensureCharacterSurface(layout, 'char-2')
    layout = ensureCharacterSurface(layout, 'char-3')

    const dragged = findCharacterSurface(layout, 'char-3')
    expect(dragged).not.toBeNull()

    expect(
      getSurfaceDropInsertIndex({
        layout,
        draggedSurfaceId: dragged!.surface.id,
        targetPaneId: dragged!.paneId,
        targetIndex: 1,
        clientX: 40,
        left: 0,
        width: 100,
      })
    ).toBe(1)

    expect(
      getSurfaceDropInsertIndex({
        layout,
        draggedSurfaceId: dragged!.surface.id,
        targetPaneId: dragged!.paneId,
        targetIndex: 1,
        clientX: 60,
        left: 0,
        width: 100,
      })
    ).toBe(2)
  })
})

describe('getSurfaceReorderIndexFromDropTarget', () => {
  test('maps a rightward same-pane boundary to the slot after the adjacent tab', () => {
    let layout = ensureCharacterSurface(createEmptyDockLayout(), 'char-1')
    layout = ensureCharacterSurface(layout, 'char-2')
    layout = ensureCharacterSurface(layout, 'char-3')

    const dragged = findCharacterSurface(layout, 'char-1')
    expect(dragged).not.toBeNull()

    expect(
      getSurfaceReorderIndexFromDropTarget({
        layout,
        draggedSurfaceId: dragged!.surface.id,
        targetPaneId: dragged!.paneId,
        dropTargetIndex: 2,
      })
    ).toBe(1)
  })
})
