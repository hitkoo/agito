import { useEffect, useRef } from 'react'
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

  useEffect(() => {
    if (!containerRef.current) return

    const terminal = new Terminal({
      theme: {
        background: '#16213e',
        foreground: '#c8c8c8',
        cursor: '#c8c8c8',
        selectionBackground: '#0f3460',
      },
      fontFamily: 'monospace',
      fontSize: 13,
      cursorBlink: true,
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(containerRef.current)
    fitAddon.fit()

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // Replay buffered output from PTY (for panel reopen)
    window.api.invoke<string>(IPC_COMMANDS.PTY_GET_BUFFER, characterId).then((buffer) => {
      if (buffer && terminalRef.current) {
        terminalRef.current.write(buffer)
      }
    })

    // Forward user input to PTY
    const dataDisposable = terminal.onData((data) => {
      window.api.invoke(IPC_COMMANDS.PTY_WRITE, { characterId, data })
    })

    // Subscribe to PTY output, filter by characterId
    const unsubscribe = window.api.on(IPC_EVENTS.PTY_DATA, (...args: unknown[]) => {
      const payload = args[0] as { characterId: string; data: string }
      if (payload.characterId === characterId) {
        terminal.write(payload.data)
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

  // Fit terminal when isActive changes (panel becomes visible)
  useEffect(() => {
    if (isActive && fitAddonRef.current) {
      fitAddonRef.current.fit()
    }
  }, [isActive])

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        overflow: 'hidden',
        padding: '4px',
        backgroundColor: '#16213e',
      }}
    />
  )
}
