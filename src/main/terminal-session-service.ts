import type * as pty from 'node-pty'
import { SerializeAddon } from '@xterm/addon-serialize'

interface HeadlessTerminalLike {
  cols: number
  rows: number
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
}

interface SpawnHooks {
  onData?: (data: string, seq: number) => void
  onExit?: (event: { exitCode: number; signal?: number }) => void
}

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
  }
}

export class TerminalSessionService {
  private sessions = new Map<string, TerminalSession>()

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

    proc.onData((data) => {
      if (this.sessions.get(characterId) !== session) return
      const seq = session.seq + 1
      session.seq = seq
      this.queueTerminalWrite(session, data, seq)
      hooks.onData?.(data, seq)
    })

    proc.onExit((event) => {
      if (this.sessions.get(characterId) !== session) return
      session.pty = null
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
    }
  }

  write(characterId: string, data: string): void {
    this.sessions.get(characterId)?.pty?.write(data)
  }

  resize(characterId: string, cols: number, rows: number): void {
    const session = this.sessions.get(characterId)
    if (!session) return

    session.pty?.resize(cols, rows)
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

  isAlive(characterId: string): boolean {
    return this.sessions.get(characterId)?.pty !== null
  }

  getAliveIds(characterIds: string[]): string[] {
    return characterIds.filter((characterId) => this.isAlive(characterId))
  }
}
