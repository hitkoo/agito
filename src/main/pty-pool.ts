import type * as pty from 'node-pty'

const OUTPUT_BUFFER_MAX = 100_000 // ~100KB per character

interface PtyProcess {
  process: pty.IPty
  characterId: string
  outputBuffer: string
}

export class PtyPool {
  private processes = new Map<string, PtyProcess>()
  // Preserve output buffer after PTY exits (for error log display)
  private deadBuffers = new Map<string, string>()

  spawn(
    characterId: string,
    command: string,
    args: string[],
    cwd: string
  ): pty.IPty {
    this.kill(characterId)
    this.deadBuffers.delete(characterId)

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodePty = require('node-pty') as typeof pty

    const proc = nodePty.spawn(command, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: process.env as Record<string, string>,
    })

    const entry: PtyProcess = { process: proc, characterId, outputBuffer: '' }
    this.processes.set(characterId, entry)

    proc.onData((data) => {
      entry.outputBuffer += data
      if (entry.outputBuffer.length > OUTPUT_BUFFER_MAX) {
        entry.outputBuffer = entry.outputBuffer.slice(-OUTPUT_BUFFER_MAX)
      }
    })

    proc.onExit(() => {
      // Preserve buffer for error log before removing
      this.deadBuffers.set(characterId, entry.outputBuffer)
      this.processes.delete(characterId)
    })

    return proc
  }

  getOutputBuffer(characterId: string): string {
    // Check live processes first, then dead buffers
    return this.processes.get(characterId)?.outputBuffer
      ?? this.deadBuffers.get(characterId)
      ?? ''
  }

  write(characterId: string, data: string): void {
    this.processes.get(characterId)?.process.write(data)
  }

  resize(characterId: string, cols: number, rows: number): void {
    this.processes.get(characterId)?.process.resize(cols, rows)
  }

  kill(characterId: string): void {
    const entry = this.processes.get(characterId)
    if (entry) {
      entry.process.kill()
      this.processes.delete(characterId)
    }
  }

  killAll(): void {
    for (const [id] of this.processes) {
      this.kill(id)
    }
  }

  isAlive(characterId: string): boolean {
    return this.processes.has(characterId)
  }

  clearDeadBuffer(characterId: string): void {
    this.deadBuffers.delete(characterId)
  }
}
