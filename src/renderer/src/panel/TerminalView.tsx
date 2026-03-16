import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { IPC_EVENTS, IPC_COMMANDS } from '../../../shared/ipc-channels'
import { shouldSendPtyResize } from '../../../shared/terminal-dock-state'

interface TerminalViewProps {
  characterId: string
  isActiveOwner: boolean
}

interface TerminalBufferSnapshot {
  buffer: string
  version: number
}

export function TerminalView({ characterId, isActiveOwner }: TerminalViewProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!containerRef.current) return

    // Read theme from CSS variables for dark/light consistency
    const style = getComputedStyle(document.documentElement)
    const hsl = (v: string, fallback: string): string => {
      const val = style.getPropertyValue(v).trim()
      return val ? `hsl(${val})` : fallback
    }

    const terminal = new Terminal({
      theme: {
        background: hsl('--background', '#1a1b26'),
        foreground: hsl('--foreground', '#c8c8c8'),
        cursor: hsl('--primary', '#7c7cfa'),
        selectionBackground: hsl('--muted', '#3a3a5a'),
      },
      fontFamily: 'monospace',
      fontSize: 13,
      cursorBlink: true,
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(containerRef.current)
    if (terminal.element) {
      terminal.element.style.boxSizing = 'border-box'
      terminal.element.style.paddingLeft = '16px'
      terminal.element.style.paddingRight = '10px'
      terminal.element.style.paddingTop = '4px'
      terminal.element.style.paddingBottom = '4px'
    }

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    let disposed = false
    let hydrated = false
    let snapshotVersion = 0
    const queuedChunks: Array<{ data: string; version: number }> = []

    const fitAndResize = (): boolean => {
      const container = containerRef.current
      const activeTerminal = terminalRef.current
      const activeFitAddon = fitAddonRef.current
      if (!container || !activeTerminal || !activeFitAddon) return false

      const rect = container.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return false

      activeFitAddon.fit()
      const { cols, rows } = activeTerminal
      if (!shouldSendPtyResize({
        isActiveOwner,
        width: rect.width,
        height: rect.height,
        cols,
        rows,
      })) {
        return false
      }

      window.api.invoke(IPC_COMMANDS.PTY_RESIZE, { characterId, cols, rows })
      return true
    }

    const hydrateFromBuffer = async (): Promise<void> => {
      if (disposed || hydrated) return
      if (!fitAndResize()) return

      hydrated = true
      const snapshot = await window.api.invoke<TerminalBufferSnapshot>(IPC_COMMANDS.PTY_GET_BUFFER, characterId)
      if (disposed || !terminalRef.current) return
      snapshotVersion = snapshot.version
      if (snapshot.buffer) {
        terminalRef.current.write(snapshot.buffer)
        terminalRef.current.scrollToBottom()
      }
      for (const chunk of queuedChunks) {
        if (chunk.version > snapshotVersion) {
          terminalRef.current.write(chunk.data)
          snapshotVersion = chunk.version
        }
      }
      queuedChunks.length = 0
      if (isActiveOwner) {
        terminalRef.current.focus()
      }
      if (!disposed) {
        setLoading(false)
      }
    }

    requestAnimationFrame(() => {
      void hydrateFromBuffer()
    })

    // Forward user input to PTY
    const dataDisposable = terminal.onData((data) => {
      window.api.invoke(IPC_COMMANDS.PTY_WRITE, { characterId, data })
    })

    // Subscribe to PTY output, filter by characterId
    const unsubscribe = window.api.on(IPC_EVENTS.PTY_DATA, (...args: unknown[]) => {
      const payload = args[0] as { characterId: string; data: string; version: number }
      if (payload.characterId !== characterId) return

      if (!hydrated) {
        queuedChunks.push({ data: payload.data, version: payload.version })
        return
      }

      if (payload.version <= snapshotVersion) return
      if (terminalRef.current) {
        terminalRef.current.write(payload.data)
        snapshotVersion = payload.version
      }
    })

    // ResizeObserver to fit terminal when container resizes
    const resizeObserver = new ResizeObserver(() => {
      if (!hydrated) {
        void hydrateFromBuffer()
        return
      }
      fitAndResize()
    })

    resizeObserver.observe(containerRef.current)

    return () => {
      disposed = true
      dataDisposable.dispose()
      unsubscribe()
      resizeObserver.disconnect()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [characterId, isActiveOwner])

  useEffect(() => {
    if (isActiveOwner && fitAddonRef.current && terminalRef.current && containerRef.current) {
      requestAnimationFrame(() => {
        const t = terminalRef.current
        const rect = containerRef.current?.getBoundingClientRect()
        if (!t || !rect) return
        fitAddonRef.current?.fit()
        t.focus()
        if (shouldSendPtyResize({
          isActiveOwner,
          width: rect.width,
          height: rect.height,
          cols: t.cols,
          rows: t.rows,
        })) {
          window.api.invoke(IPC_COMMANDS.PTY_RESIZE, { characterId, cols: t.cols, rows: t.rows })
        }
      })
    }
  }, [characterId, isActiveOwner])

  return (
    <div className="h-full w-full min-h-0 overflow-hidden relative bg-background">
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ visibility: loading ? 'hidden' : 'visible' }}
      />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="w-4 h-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
            Loading session...
          </div>
        </div>
      )}
    </div>
  )
}
