export type TerminalDockRenderMode =
  | 'hidden'
  | 'attached-dock'
  | 'attached-minimized-bar'
  | 'detached-dock'
  | 'detached-minimized-bar'

export interface TerminalDockRenderInput {
  detachedMode: boolean
  detached: boolean
  visible: boolean
  minimized: boolean
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

export function getTerminalDockRenderMode(input: TerminalDockRenderInput): TerminalDockRenderMode {
  if (!input.visible) return 'hidden'

  if (input.detachedMode) {
    if (!input.detached) return 'hidden'
    return input.minimized ? 'detached-minimized-bar' : 'detached-dock'
  }

  if (input.detached) return 'hidden'
  return input.minimized ? 'attached-minimized-bar' : 'attached-dock'
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
