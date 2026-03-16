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

export interface TerminalAutoResumeInput {
  renderMode: TerminalDockRenderMode
  activeCharacterId: string | null
  hasAssignedSession: boolean
  ptyAlive: boolean
  isResuming: boolean
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

export function shouldAutoResumeTerminal(input: TerminalAutoResumeInput): boolean {
  if (input.renderMode !== 'attached-dock' && input.renderMode !== 'detached-dock') return false
  if (!input.activeCharacterId) return false
  if (!input.hasAssignedSession) return false
  if (input.ptyAlive) return false
  if (input.isResuming) return false
  return true
}

export function shouldSendPtyResize(input: PtyResizeGuardInput): boolean {
  if (!input.isActiveOwner) return false
  if (input.width <= 0 || input.height <= 0) return false
  if (input.cols <= 0 || input.rows <= 0) return false
  return true
}
