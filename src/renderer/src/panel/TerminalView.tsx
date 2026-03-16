import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import {
  buildInitialTerminalReplay,
  canHydrateTerminalViewport,
  shouldKeepTerminalLoading,
  shouldScheduleTrailingTerminalResize,
  shouldSendPtyResize,
  type TerminalReplayChunk,
} from '../../../shared/terminal-dock-state'
import type { EngineType } from '../../../shared/types'
import { electronTerminalTransport } from './terminal-transport'

interface TerminalViewProps {
  characterId: string
  isActiveOwner: boolean
  engine: EngineType | null
}

const CODEX_TRAILING_RESIZE_MS = 180

export function TerminalView({ characterId, isActiveOwner, engine }: TerminalViewProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const ownerRef = useRef(isActiveOwner)
  const loadingRef = useRef(true)
  const syncViewportRef = useRef<(focusTerminal: boolean) => void>(() => {})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ownerRef.current = isActiveOwner
  }, [isActiveOwner])

  useEffect(() => {
    setLoading(true)
    loadingRef.current = true
  }, [characterId])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const style = getComputedStyle(document.documentElement)
    const hsl = (variable: string, fallback: string): string => {
      const value = style.getPropertyValue(variable).trim()
      return value ? `hsl(${value})` : fallback
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
      scrollback: 5000,
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    let disposed = false
    let opened = false
    let hydrating = false
    let hydrated = false
    let snapshotSeq = 0
    let revealTimer: number | null = null
    let trailingResizeTimer: number | null = null
    const queuedChunks: TerminalReplayChunk[] = []

    const revealTerminal = (): void => {
      if (disposed || !loadingRef.current) return
      loadingRef.current = false
      setLoading(false)
    }

    const ensureOpened = (): boolean => {
      if (opened || !containerRef.current || !terminalRef.current) return opened
      terminalRef.current.open(containerRef.current)
      if (terminalRef.current.element) {
        terminalRef.current.element.style.boxSizing = 'border-box'
        terminalRef.current.element.style.paddingLeft = '16px'
        terminalRef.current.element.style.paddingRight = '10px'
        terminalRef.current.element.style.paddingTop = '4px'
        terminalRef.current.element.style.paddingBottom = '4px'
      }
      opened = true
      return true
    }

    const fitToContainer = (): { width: number; height: number; cols: number; rows: number } | null => {
      if (!ensureOpened()) return null

      const activeContainer = containerRef.current
      const activeTerminal = terminalRef.current
      const activeFitAddon = fitAddonRef.current
      if (!activeContainer || !activeTerminal || !activeFitAddon) return null

      const rect = activeContainer.getBoundingClientRect()
      if (!canHydrateTerminalViewport({ width: rect.width, height: rect.height })) return null

      activeFitAddon.fit()
      return {
        width: rect.width,
        height: rect.height,
        cols: activeTerminal.cols,
        rows: activeTerminal.rows,
      }
    }

    const sendPtyResizeIfOwner = (measurement: { width: number; height: number; cols: number; rows: number }): void => {
      if (!shouldSendPtyResize({
        isActiveOwner: ownerRef.current,
        width: measurement.width,
        height: measurement.height,
        cols: measurement.cols,
        rows: measurement.rows,
      })) {
        return
      }

      void electronTerminalTransport.resize(characterId, measurement.cols, measurement.rows)

      if (!shouldScheduleTrailingTerminalResize(engine ?? 'claude-code')) return
      if (trailingResizeTimer !== null) {
        window.clearTimeout(trailingResizeTimer)
      }
      trailingResizeTimer = window.setTimeout(() => {
        trailingResizeTimer = null
        if (!ownerRef.current) return
        void electronTerminalTransport.resize(characterId, measurement.cols, measurement.rows)
      }, CODEX_TRAILING_RESIZE_MS)
    }

    const flushQueuedReplay = (onDone: () => void): void => {
      if (!terminalRef.current) {
        onDone()
        return
      }

      const pendingChunks = queuedChunks.filter((chunk) => chunk.seq > snapshotSeq)
      queuedChunks.length = 0
      if (pendingChunks.length === 0) {
        onDone()
        return
      }

      snapshotSeq = pendingChunks[pendingChunks.length - 1]?.seq ?? snapshotSeq
      terminalRef.current.write(pendingChunks.map((chunk) => chunk.data).join(''), () => {
        if (disposed) return
        flushQueuedReplay(onDone)
      })
    }

    const finalizeHydration = (focusTerminal: boolean): void => {
      flushQueuedReplay(() => {
        if (disposed) return

        hydrated = true
        hydrating = false
        const measurement = fitToContainer()
        if (measurement) {
          sendPtyResizeIfOwner(measurement)
        }
        if (focusTerminal && ownerRef.current) {
          terminalRef.current?.focus()
        }
        terminalRef.current?.scrollToBottom()
        revealTerminal()
      })
    }

    const syncViewport = async (focusTerminal: boolean): Promise<void> => {
      if (disposed) return

      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect || !canHydrateTerminalViewport({ width: rect.width, height: rect.height })) return

      if (hydrated) {
        const measurement = fitToContainer()
        if (measurement) {
          sendPtyResizeIfOwner(measurement)
        }
        if (focusTerminal && ownerRef.current) {
          terminalRef.current?.focus()
        }
        return
      }

      if (hydrating) return
      hydrating = true
      ensureOpened()

      const snapshot = await electronTerminalTransport.getSnapshot(characterId)
      if (disposed || !terminalRef.current) return

      if (snapshot.cols > 0 && snapshot.rows > 0) {
        terminalRef.current.resize(snapshot.cols, snapshot.rows)
      }

      const initialReplay = buildInitialTerminalReplay(snapshot, queuedChunks)
      snapshotSeq = initialReplay.seq
      queuedChunks.length = 0

      if (initialReplay.data) {
        terminalRef.current.write(initialReplay.data, () => {
          if (disposed) return
          finalizeHydration(focusTerminal)
        })
        return
      }

      if (shouldKeepTerminalLoading({ snapshot, replayData: initialReplay.data })) {
        hydrating = false
        return
      }

      ensureOpened()
      finalizeHydration(focusTerminal)
      if (!snapshot.isAlive && !snapshot.bootstrapping) {
        revealTimer = window.setTimeout(() => {
          revealTimer = null
          revealTerminal()
        }, 250)
      }
    }

    syncViewportRef.current = (focusTerminal) => {
      void syncViewport(focusTerminal)
    }

    requestAnimationFrame(() => {
      syncViewportRef.current(false)
    })

    const dataDisposable = terminal.onData((data) => {
      if (!ownerRef.current) return
      void electronTerminalTransport.write(characterId, data)
    })

    const unsubscribe = electronTerminalTransport.subscribeOutput((payload) => {
      if (payload.characterId !== characterId) return

      if (!hydrated) {
        queuedChunks.push({ data: payload.data, seq: payload.seq })
        if (!hydrating) {
          syncViewportRef.current(false)
        }
        return
      }

      if (payload.seq <= snapshotSeq || !terminalRef.current) return
      snapshotSeq = payload.seq
      terminalRef.current.write(payload.data, revealTerminal)
    })

    const resizeObserver = new ResizeObserver(() => {
      syncViewportRef.current(false)
    })
    resizeObserver.observe(container)

    return () => {
      disposed = true
      if (revealTimer !== null) {
        window.clearTimeout(revealTimer)
      }
      if (trailingResizeTimer !== null) {
        window.clearTimeout(trailingResizeTimer)
      }
      dataDisposable.dispose()
      unsubscribe()
      resizeObserver.disconnect()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      syncViewportRef.current = () => {}
    }
  }, [characterId])

  useEffect(() => {
    if (!isActiveOwner) return

    requestAnimationFrame(() => {
      syncViewportRef.current(true)
    })
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
