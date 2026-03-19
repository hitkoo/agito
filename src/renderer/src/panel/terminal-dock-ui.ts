import type { Character } from '../../../shared/types'
import {
  TERMINAL_DOCK_BAR_DEFAULT_HEIGHT,
  TERMINAL_DOCK_BAR_HEIGHT_STORAGE_KEY,
  TERMINAL_DOCK_BAR_MAX_HEIGHT,
  TERMINAL_DOCK_BAR_MIN_HEIGHT,
  clampTerminalDockBarHeight,
  getResizedTerminalDockBarHeight,
  resolveTerminalDockBarHeight,
} from '../../../shared/terminal-dock-bar'
import {
  ensureCharacterSurface,
  findCharacterSurface,
  getActiveCharacterId,
  listOpenCharacterIds,
  type DockLayout,
} from '../../../shared/terminal-dock-layout'

export type CharacterDockPresence = 'focused-active' | 'open' | 'closed'
export type GlobalCharacterSessionAction = 'assign' | 'reassign' | 'unassign'
export type CharacterStatusIndicator = 'spinner' | 'dot'
export const TERMINAL_DOCK_FOOTER_HEIGHT_STORAGE_KEY = TERMINAL_DOCK_BAR_HEIGHT_STORAGE_KEY
export const TERMINAL_DOCK_FOOTER_DEFAULT_HEIGHT = TERMINAL_DOCK_BAR_DEFAULT_HEIGHT
export const TERMINAL_DOCK_FOOTER_MIN_HEIGHT = TERMINAL_DOCK_BAR_MIN_HEIGHT
export const TERMINAL_DOCK_FOOTER_MAX_HEIGHT = TERMINAL_DOCK_BAR_MAX_HEIGHT

export const CHARACTER_STATUS_COLORS: Record<string, string> = {
  no_session: '#6c757d',
  idle: '#7c8591',
  running: '#959eab',
  unknown: '#ffd43b',
  need_input: '#51cf66',
  done: '#4dabf7',
  error: '#ff6b6b',
}

export interface CharacterStatusBadgeState {
  indicator: CharacterStatusIndicator
  color: string
  pulse: boolean
  ring: boolean
}

export function getClosedCharacters(characters: Character[], layout: DockLayout): Character[] {
  const openIds = new Set(listOpenCharacterIds(layout))
  return characters.filter((character) => !openIds.has(character.id))
}

export function getOpenCharactersInGlobalOrder(
  characters: Character[],
  layout: DockLayout
): Character[] {
  const openIds = new Set(listOpenCharacterIds(layout))
  return characters.filter((character) => openIds.has(character.id))
}

export function getMinimizedCharacters(
  characters: Character[],
  layout: DockLayout
): Character[] {
  const openCharacters = getOpenCharactersInGlobalOrder(characters, layout)
  return openCharacters.length > 0 ? openCharacters : characters
}

export function getCharacterDockPresence(
  layout: DockLayout,
  characterId: string
): CharacterDockPresence {
  if (getActiveCharacterId(layout) === characterId) {
    return 'focused-active'
  }

  return findCharacterSurface(layout, characterId) ? 'open' : 'closed'
}

export function getLayoutForGlobalCharacterSessionAction(
  layout: DockLayout,
  characterId: string,
  action: GlobalCharacterSessionAction
): DockLayout {
  if (action === 'unassign') {
    return layout
  }

  return ensureCharacterSurface(layout, characterId)
}

export function getCharacterSessionMenuActions(
  currentSessionId: string | null,
  hasLiveRuntime = false
): GlobalCharacterSessionAction[] {
  if (hasLiveRuntime && currentSessionId === null) {
    return ['unassign']
  }
  return currentSessionId === null
    ? ['assign']
    : ['reassign', 'unassign']
}

export function getCharacterStatusIndicator(status: string): CharacterStatusIndicator {
  return status === 'running' ? 'spinner' : 'dot'
}

export function getCharacterStatusBadgeState(status: string): CharacterStatusBadgeState {
  return {
    indicator: getCharacterStatusIndicator(status),
    color: CHARACTER_STATUS_COLORS[status] ?? CHARACTER_STATUS_COLORS.idle,
    pulse: status === 'need_input',
    ring: status === 'need_input',
  }
}

export function clampTerminalDockFooterHeight(height: number): number {
  return clampTerminalDockBarHeight(height)
}

export function resolveTerminalDockFooterHeight(
  savedValue: string | null | undefined
): number {
  return resolveTerminalDockBarHeight(savedValue)
}

export function getResizedTerminalDockFooterHeight(
  startHeight: number,
  dragDeltaY: number
): number {
  return getResizedTerminalDockBarHeight(startHeight, dragDeltaY)
}

export function getSurfaceDropInsertIndex(args: {
  layout: DockLayout
  draggedSurfaceId: string
  targetPaneId: string
  targetIndex: number
  clientX: number
  left: number
  width: number
}): number {
  const { layout, draggedSurfaceId, targetPaneId, targetIndex, clientX, left, width } = args
  const source = findCharacterSurface(layout, draggedSurfaceId)
  if (source !== null && source.paneId === targetPaneId && source.index === targetIndex) {
    return targetIndex
  }

  if (source !== null && source.paneId === targetPaneId && source.index + 1 === targetIndex) {
    const crossedAdjacentTab = clientX >= left + width * 0.75
    return crossedAdjacentTab ? targetIndex + 1 : source.index
  }

  const isMovingRightInSamePane =
    source !== null && source.paneId === targetPaneId && source.index < targetIndex

  const thresholdRatio = isMovingRightInSamePane ? 0.75 : 0.5
  const before = clientX < left + width * thresholdRatio
  return before ? targetIndex : targetIndex + 1
}

export function getSurfaceReorderIndexFromDropTarget(args: {
  layout: DockLayout
  draggedSurfaceId: string
  targetPaneId: string
  dropTargetIndex: number
}): number {
  const { layout, draggedSurfaceId, targetPaneId, dropTargetIndex } = args
  const source = findCharacterSurface(layout, draggedSurfaceId)

  if (source !== null && source.paneId === targetPaneId && source.index < dropTargetIndex) {
    return Math.max(source.index, dropTargetIndex - 1)
  }

  return dropTargetIndex
}
