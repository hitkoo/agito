export type TerminalDockRenderMode =
  | 'hidden'
  | 'attached-dock'
  | 'attached-dock-hidden-warm'
  | 'attached-minimized-bar'
  | 'detached-dock'
  | 'detached-minimized-bar'

export type TerminalDockOwnerWindow = 'attached' | 'detached'

export interface TerminalDockRenderInput {
  detachedMode: boolean
  detached: boolean
  visible: boolean
  minimized: boolean
  ownerWindow: TerminalDockOwnerWindow
  detachedReady: boolean
}

export interface PtyResizeGuardInput {
  isActiveOwner: boolean
  width: number
  height: number
  cols: number
  rows: number
}

export interface TerminalReplayChunk {
  data: string
  seq: number
}

export interface TerminalSessionSnapshot {
  serialized: string
  seq: number
  cols: number
  rows: number
  isAlive: boolean
  bootstrapping: boolean
}

export interface TerminalViewportMeasureInput {
  width: number
  height: number
}

export function getTerminalDockRenderMode(input: TerminalDockRenderInput): TerminalDockRenderMode {
  if (!input.visible) return 'hidden'

  if (input.detachedMode) {
    if (!input.detached) return 'hidden'
    return input.minimized ? 'detached-minimized-bar' : 'detached-dock'
  }

  if (input.detached) {
    if (input.ownerWindow === 'attached' || !input.detachedReady) {
      return 'attached-dock'
    }
    return 'attached-dock-hidden-warm'
  }
  return input.minimized ? 'attached-minimized-bar' : 'attached-dock'
}

export function isTerminalDockOwner(input: {
  detachedMode: boolean
  ownerWindow: TerminalDockOwnerWindow
}): boolean {
  return input.detachedMode ? input.ownerWindow === 'detached' : input.ownerWindow === 'attached'
}

export function buildInitialTerminalReplay(
  snapshot: TerminalSessionSnapshot,
  queuedChunks: TerminalReplayChunk[]
): { data: string; seq: number } {
  let seq = snapshot.seq
  const parts = [snapshot.serialized]

  for (const chunk of queuedChunks) {
    if (chunk.seq <= seq) continue
    parts.push(chunk.data)
    seq = chunk.seq
  }

  return {
    data: parts.join(''),
    seq,
  }
}

export function canHydrateTerminalViewport(input: TerminalViewportMeasureInput): boolean {
  return input.width > 0 && input.height > 0
}

export function shouldRenderAssignedTerminal(input: {
  activeCharacterId: string | null
  hasAssignedSession: boolean
}): boolean {
  return Boolean(input.activeCharacterId && input.hasAssignedSession)
}

export function shouldKeepTerminalLoading(input: {
  snapshot: TerminalSessionSnapshot
  replayData: string
}): boolean {
  return input.snapshot.bootstrapping && input.replayData.length === 0
}

export function shouldScheduleTrailingTerminalResize(engine: 'claude-code' | 'codex'): boolean {
  return engine === 'codex'
}

export function shouldSendPtyResize(input: PtyResizeGuardInput): boolean {
  if (!input.isActiveOwner) return false
  if (input.width <= 0 || input.height <= 0) return false
  if (input.cols <= 0 || input.rows <= 0) return false
  return true
}
