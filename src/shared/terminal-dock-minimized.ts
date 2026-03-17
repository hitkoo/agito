import {
  TERMINAL_DOCK_BAR_DEFAULT_HEIGHT,
  TERMINAL_DOCK_BAR_MAX_HEIGHT,
  TERMINAL_DOCK_BAR_MIN_HEIGHT,
  clampTerminalDockBarHeight,
  getFittedMinimizedDockWidth as getSharedFittedMinimizedDockWidth,
  getResizedTerminalDockBarHeight,
  resolveTerminalDockBarHeight,
} from './terminal-dock-bar'

export const TERMINAL_DOCK_MINIMIZED_DEFAULT_HEIGHT = TERMINAL_DOCK_BAR_DEFAULT_HEIGHT
export const TERMINAL_DOCK_MINIMIZED_MIN_HEIGHT = TERMINAL_DOCK_BAR_MIN_HEIGHT
export const TERMINAL_DOCK_MINIMIZED_MAX_HEIGHT = TERMINAL_DOCK_BAR_MAX_HEIGHT

export function clampMinimizedDockHeight(height: number): number {
  return clampTerminalDockBarHeight(height)
}

export function resolveMinimizedDockHeight(
  savedValue: string | null | undefined
): number {
  return resolveTerminalDockBarHeight(savedValue)
}

export function getResizedMinimizedDockHeight(
  startHeight: number,
  dragDeltaY: number
): number {
  return getResizedTerminalDockBarHeight(startHeight, dragDeltaY)
}

export function getFittedMinimizedDockWidth(args: {
  characterCount: number
  height: number
  maxWidth: number
}): number {
  return getSharedFittedMinimizedDockWidth(args)
}
