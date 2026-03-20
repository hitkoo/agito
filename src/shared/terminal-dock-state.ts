export type TerminalDockRenderMode =
  | 'hidden'
  | 'dock'
  | 'minimized-bar'

export interface TerminalDockRenderInput {
  visible: boolean
  minimized: boolean
}

export interface PtyResizeGuardInput {
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

export function resolveSessionResumeEngine(input: {
  scannedEngineType: 'claude-code' | 'codex' | null
  selectedEngine: 'claude-code' | 'codex' | null
  characterEngine: 'claude-code' | 'codex' | null
}): 'claude-code' | 'codex' | null {
  return input.scannedEngineType ?? input.selectedEngine ?? input.characterEngine
}

export function getTerminalDockRenderMode(input: TerminalDockRenderInput): TerminalDockRenderMode {
  if (!input.visible) return 'hidden'
  return input.minimized ? 'minimized-bar' : 'dock'
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
  hasLiveRuntime: boolean
}): boolean {
  return Boolean(
    input.activeCharacterId && (input.hasAssignedSession || input.hasLiveRuntime)
  )
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
  if (input.width <= 0 || input.height <= 0) return false
  if (input.cols <= 0 || input.rows <= 0) return false
  return true
}
