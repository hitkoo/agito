import type * as pty from 'node-pty'
import { SerializeAddon } from '@xterm/addon-serialize'

interface HeadlessTerminalLike {
  cols: number
  rows: number
  buffer: {
    active: {
      viewportY: number
      length: number
      getLine(y: number): {
        translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string
      } | undefined
    }
  }
  write(data: string, callback?: () => void): void
  resize(cols: number, rows: number): void
  loadAddon(addon: { activate(terminal: unknown): void; dispose(): void }): void
  dispose(): void
}

type HeadlessTerminalCtor = new (options?: {
  allowProposedApi?: boolean
  cols?: number
  rows?: number
  scrollback?: number
  convertEol?: boolean
}) => HeadlessTerminalLike

// electron-vite cannot resolve the package root reliably, but the Node entrypoint is stable.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Terminal: HeadlessTerminal } = require('@xterm/headless/lib-headless/xterm-headless.js') as {
  Terminal: HeadlessTerminalCtor
}

export interface TerminalSnapshot {
  serialized: string
  seq: number
  cols: number
  rows: number
  isAlive: boolean
  bootstrapping: boolean
}

interface TerminalSession {
  characterId: string
  pty: pty.IPty | null
  terminal: HeadlessTerminalLike
  serializer: SerializeAddon
  seq: number
  parsedSeq: number
  snapshotDirty: boolean
  serializedSnapshot: string
  parseQueue: Promise<void>
  bootstrapping: boolean
}

interface SpawnHooks {
  onData?: (data: string, seq: number) => void
  onExit?: (event: { exitCode: number; signal?: number }) => void
}

type TerminalOutputListener = (data: string) => void

function createHeadlessSession(characterId: string): TerminalSession {
  const terminal = new HeadlessTerminal({
    allowProposedApi: true,
    cols: 80,
    rows: 24,
    scrollback: 5000,
    convertEol: false,
  })
  const serializer = new SerializeAddon()
  terminal.loadAddon(serializer as unknown as { activate(terminal: unknown): void; dispose(): void })

  return {
    characterId,
    pty: null,
    terminal,
    serializer,
    seq: 0,
    parsedSeq: 0,
    snapshotDirty: true,
    serializedSnapshot: '',
    parseQueue: Promise.resolve(),
    bootstrapping: false,
  }
}

export class TerminalSessionService {
  private sessions = new Map<string, TerminalSession>()
  private outputListeners = new Map<string, Set<TerminalOutputListener>>()

  private getOrCreateSession(characterId: string): TerminalSession {
    const existing = this.sessions.get(characterId)
    if (existing) return existing

    const session = createHeadlessSession(characterId)
    this.sessions.set(characterId, session)
    return session
  }

  private replaceSession(characterId: string): TerminalSession {
    const existing = this.sessions.get(characterId)
    if (existing) {
      existing.pty?.kill()
      existing.terminal.dispose()
      this.sessions.delete(characterId)
    }

    const session = createHeadlessSession(characterId)
    this.sessions.set(characterId, session)
    return session
  }

  private queueTerminalWrite(session: TerminalSession, data: string, seq: number): void {
    session.parseQueue = session.parseQueue
      .catch(() => undefined)
      .then(() => new Promise<void>((resolve) => {
        session.terminal.write(data, () => {
          session.parsedSeq = seq
          session.snapshotDirty = true
          resolve()
        })
      }))
  }

  spawn(
    characterId: string,
    command: string,
    args: string[],
    cwd: string,
    hooks: SpawnHooks = {}
  ): pty.IPty {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodePty = require('node-pty') as typeof pty
    const session = this.replaceSession(characterId)

    const proc = nodePty.spawn(command, args, {
      name: 'xterm-256color',
      cols: session.terminal.cols,
      rows: session.terminal.rows,
      cwd,
      env: process.env as Record<string, string>,
    })

    session.pty = proc
    session.bootstrapping = true

    proc.onData((data) => {
      if (this.sessions.get(characterId) !== session) return
      const seq = session.seq + 1
      session.seq = seq
      session.bootstrapping = false
      this.queueTerminalWrite(session, data, seq)
      this.outputListeners.get(characterId)?.forEach((listener) => listener(data))
      hooks.onData?.(data, seq)
    })

    proc.onExit((event) => {
      if (this.sessions.get(characterId) !== session) return
      session.pty = null
      session.bootstrapping = false
      session.parseQueue = session.parseQueue
        .catch(() => undefined)
        .then(() => {
          session.serializedSnapshot = session.serializer.serialize()
          session.snapshotDirty = false
        })
      hooks.onExit?.(event)
    })

    return proc
  }

  async getSnapshot(characterId: string): Promise<TerminalSnapshot> {
    const session = this.sessions.get(characterId)
    if (!session) {
      return {
        serialized: '',
        seq: 0,
        cols: 80,
        rows: 24,
        isAlive: false,
        bootstrapping: false,
      }
    }

    await session.parseQueue.catch(() => undefined)
    if (session.snapshotDirty) {
      session.serializedSnapshot = session.serializer.serialize()
      session.snapshotDirty = false
    }

    return {
      serialized: session.serializedSnapshot,
      seq: session.parsedSeq,
      cols: session.terminal.cols,
      rows: session.terminal.rows,
      isAlive: session.pty !== null,
      bootstrapping: session.bootstrapping,
    }
  }

  async getRenderedText(characterId: string): Promise<string> {
    const session = this.sessions.get(characterId)
    if (!session) return ''

    await session.parseQueue.catch(() => undefined)

    const activeBuffer = session.terminal.buffer.active
    const startLine = activeBuffer.viewportY
    const endLine = Math.min(startLine + session.terminal.rows, activeBuffer.length)
    const lines: string[] = []

    for (let lineIndex = startLine; lineIndex < endLine; lineIndex += 1) {
      const line = activeBuffer.getLine(lineIndex)
      lines.push(line?.translateToString(true) ?? '')
    }

    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop()
    }

    return lines.join('\n')
  }

  hasSession(characterId: string): boolean {
    return this.sessions.has(characterId)
  }

  write(characterId: string, data: string): void {
    this.sessions.get(characterId)?.pty?.write(data)
  }

  resize(characterId: string, cols: number, rows: number): void {
    const session = this.sessions.get(characterId)
    if (!session) return

    try {
      session.pty?.resize(cols, rows)
    } catch {
      // PTY already dead (EBADF) — ignore
    }
    session.terminal.resize(cols, rows)
    session.snapshotDirty = true
  }

  kill(characterId: string): void {
    const session = this.sessions.get(characterId)
    session?.pty?.kill()
  }

  killAll(): void {
    for (const session of this.sessions.values()) {
      session.pty?.kill()
    }
  }

  onOutput(characterId: string, listener: TerminalOutputListener): () => void {
    const listeners = this.outputListeners.get(characterId) ?? new Set<TerminalOutputListener>()
    listeners.add(listener)
    this.outputListeners.set(characterId, listeners)

    return () => {
      const current = this.outputListeners.get(characterId)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) {
        this.outputListeners.delete(characterId)
      }
    }
  }

  isAlive(characterId: string): boolean {
    return this.sessions.get(characterId)?.pty !== null
  }

  getAliveIds(characterIds: string[]): string[] {
    return characterIds.filter((characterId) => this.isAlive(characterId))
  }
}
