export const TERMINAL_DOCK_BAR_HEIGHT_STORAGE_KEY = 'agito:terminal-dock-footer-height'
export const TERMINAL_DOCK_BAR_DEFAULT_HEIGHT = 40
export const TERMINAL_DOCK_BAR_MIN_HEIGHT = 40
export const TERMINAL_DOCK_BAR_MAX_HEIGHT = 128
export const TERMINAL_DOCK_BAR_HORIZONTAL_PADDING = 16
export const TERMINAL_DOCK_BAR_ITEM_GAP = 6

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

export function getTerminalDockBarSideSlotWidth(height: number): number {
  return Math.max(16, Math.round(getTerminalDockBarItemSize(height) * 0.5))
}

export function getFittedMinimizedDockWidth(args: {
  characterCount: number
  height: number
  maxWidth: number
}): number {
  const { characterCount, height, maxWidth } = args
  const safeCount = Math.max(0, characterCount)
  const itemSize = getTerminalDockBarItemSize(height)
  const sideSlotWidth = getTerminalDockBarSideSlotWidth(height)
  const gapWidth = safeCount > 1 ? (safeCount - 1) * TERMINAL_DOCK_BAR_ITEM_GAP : 0
  const fittedWidth =
    TERMINAL_DOCK_BAR_HORIZONTAL_PADDING +
    sideSlotWidth * 2 +
    itemSize * safeCount +
    gapWidth

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
