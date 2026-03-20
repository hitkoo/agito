export const TERMINAL_DOCK_BAR_HEIGHT_STORAGE_KEY = 'agito:terminal-dock-footer-height'
export const TERMINAL_DOCK_BAR_DEFAULT_HEIGHT = 40
export const TERMINAL_DOCK_BAR_MIN_HEIGHT = 40
export const TERMINAL_DOCK_BAR_MAX_HEIGHT = 128
export const TERMINAL_DOCK_BAR_HORIZONTAL_PADDING = 16
export const TERMINAL_DOCK_BAR_ITEM_GAP = 6
export const TERMINAL_DOCK_BAR_CLUSTER_GAP = 6
export const TERMINAL_DOCK_BAR_ICON_SLOT_WIDTH = 28
export const FLOAT_TERMINAL_DOCK_GAP = 12

export interface DockWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export function clampTerminalDockBarHeight(height: number): number {
  return Math.min(
    TERMINAL_DOCK_BAR_MAX_HEIGHT,
    Math.max(TERMINAL_DOCK_BAR_MIN_HEIGHT, Math.round(height))
  )
}

export function resolveTerminalDockBarHeight(
  savedValue: string | null | undefined
): number {
  if (!savedValue?.trim()) {
    return TERMINAL_DOCK_BAR_DEFAULT_HEIGHT
  }

  const parsed = Number(savedValue)
  if (!Number.isFinite(parsed)) {
    return TERMINAL_DOCK_BAR_DEFAULT_HEIGHT
  }

  return clampTerminalDockBarHeight(parsed)
}

export function getResizedTerminalDockBarHeight(
  startHeight: number,
  dragDeltaY: number
): number {
  return clampTerminalDockBarHeight(startHeight - dragDeltaY)
}

export function getTerminalDockBarItemSize(height: number): number {
  return Math.max(24, clampTerminalDockBarHeight(height) - 8)
}

export function getFloatBarCharacterCount(args: {
  openCharacterCount: number
  totalCharacterCount: number
}): number {
  return Math.max(0, Math.round(args.totalCharacterCount))
}

export function getFittedMinimizedDockWidth(args: {
  characterCount: number
  height: number
  maxWidth: number
}): number {
  const { characterCount, height, maxWidth } = args
  const safeCount = Math.max(0, characterCount)
  const itemSize = getTerminalDockBarItemSize(height)
  const characterGapWidth = safeCount > 1 ? (safeCount - 1) * TERMINAL_DOCK_BAR_ITEM_GAP : 0
  const clusterGapWidth = TERMINAL_DOCK_BAR_CLUSTER_GAP * 2
  const fittedWidth =
    TERMINAL_DOCK_BAR_HORIZONTAL_PADDING +
    TERMINAL_DOCK_BAR_ICON_SLOT_WIDTH * 2 +
    clusterGapWidth +
    itemSize * safeCount +
    characterGapWidth

  return Math.max(96, Math.min(maxWidth, fittedWidth))
}

export function getAnchoredDockBounds(args: {
  anchorBounds: DockWindowBounds
  nextWidth: number
  nextHeight: number
  workArea: DockWindowBounds
}): DockWindowBounds {
  const { anchorBounds, nextWidth, nextHeight, workArea } = args
  const anchorCenterX = anchorBounds.x + anchorBounds.width / 2
  const anchorBottomY = anchorBounds.y + anchorBounds.height
  const unclampedX = Math.round(anchorCenterX - nextWidth / 2)
  const unclampedY = Math.round(anchorBottomY - nextHeight)
  const maxX = workArea.x + workArea.width - nextWidth
  const maxY = workArea.y + workArea.height - nextHeight

  return {
    x: Math.max(workArea.x, Math.min(unclampedX, maxX)),
    y: Math.max(workArea.y, Math.min(unclampedY, maxY)),
    width: nextWidth,
    height: nextHeight,
  }
}

export function getFloatBarBoundsFromTerminalBounds(args: {
  terminalBounds: DockWindowBounds
  barHeight: number
  characterCount: number
  workArea: DockWindowBounds
}): DockWindowBounds {
  const { terminalBounds, barHeight, characterCount, workArea } = args
  const nextHeight = clampTerminalDockBarHeight(barHeight)
  const nextWidth = getFittedMinimizedDockWidth({
    characterCount,
    height: nextHeight,
    maxWidth: Math.max(96, workArea.width - 32),
  })
  const anchorCenterX = terminalBounds.x + terminalBounds.width / 2
  const unclampedX = Math.round(anchorCenterX - nextWidth / 2)
  const unclampedY = Math.round(terminalBounds.y + terminalBounds.height + FLOAT_TERMINAL_DOCK_GAP)
  const maxX = workArea.x + workArea.width - nextWidth
  const maxY = workArea.y + workArea.height - nextHeight

  return {
    x: Math.max(workArea.x, Math.min(unclampedX, maxX)),
    y: Math.max(workArea.y, Math.min(unclampedY, maxY)),
    width: nextWidth,
    height: nextHeight,
  }
}

export function getFloatTerminalBoundsFromBarBounds(args: {
  barBounds: DockWindowBounds
  terminalWidth: number
  terminalHeight: number
  workArea: DockWindowBounds
}): DockWindowBounds {
  const { barBounds, terminalWidth, terminalHeight, workArea } = args
  const anchorCenterX = barBounds.x + barBounds.width / 2
  const unclampedX = Math.round(anchorCenterX - terminalWidth / 2)
  const unclampedY = Math.round(barBounds.y - FLOAT_TERMINAL_DOCK_GAP - terminalHeight)
  const maxX = workArea.x + workArea.width - terminalWidth
  const maxY = workArea.y + workArea.height - terminalHeight

  return {
    x: Math.max(workArea.x, Math.min(unclampedX, maxX)),
    y: Math.max(workArea.y, Math.min(unclampedY, maxY)),
    width: terminalWidth,
    height: terminalHeight,
  }
}
