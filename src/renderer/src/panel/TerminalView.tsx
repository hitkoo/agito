import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { IPC_EVENTS, IPC_COMMANDS } from '../../../shared/ipc-channels'

interface TerminalViewProps {
  characterId: string
  isActive: boolean
}

export function TerminalView({ characterId, isActive }: TerminalViewProps): ReactElement {
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

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    let gotData = false
    const markLoaded = (): void => {
      if (!gotData) {
        gotData = true
        setLoading(false)
      }
    }

    // Fit first, then replay buffer
    requestAnimationFrame(() => {
      fitAddon.fit()
      const { cols, rows } = terminal
      window.api.invoke(IPC_COMMANDS.PTY_RESIZE, { characterId, cols, rows })

      // Replay buffered output from PTY
      window.api.invoke<string>(IPC_COMMANDS.PTY_GET_BUFFER, characterId).then((buffer) => {
        if (buffer && terminalRef.current) {
          terminalRef.current.write(buffer)
          terminalRef.current.scrollToBottom()
          markLoaded()
        }
      })
    })

    // Focus terminal
    terminal.focus()

    // Forward user input to PTY
    const dataDisposable = terminal.onData((data) => {
      window.api.invoke(IPC_COMMANDS.PTY_WRITE, { characterId, data })
    })

    // Subscribe to PTY output, filter by characterId
    const unsubscribe = window.api.on(IPC_EVENTS.PTY_DATA, (...args: unknown[]) => {
      const payload = args[0] as { characterId: string; data: string }
      if (payload.characterId === characterId) {
        terminal.write(payload.data)
        markLoaded()
      }
    })

    // ResizeObserver to fit terminal when container resizes
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current && terminalRef.current) {
        fitAddonRef.current.fit()
        const { cols, rows } = terminalRef.current
        window.api.invoke(IPC_COMMANDS.PTY_RESIZE, { characterId, cols, rows })
      }
    })

    resizeObserver.observe(containerRef.current)

    return () => {
      dataDisposable.dispose()
      unsubscribe()
      resizeObserver.disconnect()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [characterId])

  // Fit + focus when becoming the active tab
  useEffect(() => {
    if (isActive && fitAddonRef.current && terminalRef.current) {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit()
        terminalRef.current?.focus()
        const t = terminalRef.current
        if (t) {
          window.api.invoke(IPC_COMMANDS.PTY_RESIZE, { characterId, cols: t.cols, rows: t.rows })
        }
      })
    }
  }, [isActive, characterId])

  return (
    <div className="flex-1 overflow-hidden relative bg-background" style={{ padding: '4px 10px 4px 16px' }}>
      <div
        ref={containerRef}
        className="w-full h-full"
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
