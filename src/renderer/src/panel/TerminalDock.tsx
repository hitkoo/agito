import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useCharacterStore } from '../stores/character-store'
import { useUIStore } from '../stores/ui-store'
import { IPC_COMMANDS, IPC_EVENTS } from '../../../shared/ipc-channels'
import type { Character, ScannedSession } from '../../../shared/types'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// xterm instance manager — persists across panel open/close
// ---------------------------------------------------------------------------

interface TerminalEntry {
  terminal: Terminal
  fitAddon: FitAddon
  dataDisposable: { dispose(): void }
  ipcUnsubscribe: () => void
}

const terminalInstances = new Map<string, TerminalEntry>()

function getOrCreateTerminal(characterId: string): TerminalEntry {
  const existing = terminalInstances.get(characterId)
  if (existing) return existing

  const terminal = new Terminal({
    theme: getXtermTheme(),
    fontFamily: 'monospace',
    fontSize: 13,
    cursorBlink: true,
    allowTransparency: false,
  })

  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)

  // Forward user input to PTY
  const dataDisposable = terminal.onData((data) => {
    window.api.invoke(IPC_COMMANDS.PTY_WRITE, { characterId, data })
  })

  // Subscribe to PTY output
  const ipcUnsubscribe = window.api.on(IPC_EVENTS.PTY_DATA, (...args: unknown[]) => {
    const payload = args[0] as { characterId: string; data: string }
    if (payload.characterId === characterId) {
      terminal.write(payload.data)
    }
  })

  // Replay buffered output
  window.api.invoke<string>(IPC_COMMANDS.PTY_GET_BUFFER, characterId).then((buffer) => {
    if (buffer) terminal.write(buffer)
  })

  const entry: TerminalEntry = { terminal, fitAddon, dataDisposable, ipcUnsubscribe }
  terminalInstances.set(characterId, entry)
  return entry
}

function disposeTerminal(characterId: string): void {
  const entry = terminalInstances.get(characterId)
  if (!entry) return
  entry.dataDisposable.dispose()
  entry.ipcUnsubscribe()
  entry.terminal.dispose()
  terminalInstances.delete(characterId)
}

function getXtermTheme(): Record<string, string> {
  try {
    const style = getComputedStyle(document.documentElement)
    const bg = style.getPropertyValue('--background').trim()
    const fg = style.getPropertyValue('--foreground').trim()
    const primary = style.getPropertyValue('--primary').trim()
    const muted = style.getPropertyValue('--muted').trim()
    return {
      background: bg ? `hsl(${bg})` : '#1a1b26',
      foreground: fg ? `hsl(${fg})` : '#c8c8c8',
      cursor: primary ? `hsl(${primary})` : '#7c7cfa',
      selectionBackground: muted ? `hsl(${muted})` : '#3a3a5a',
    }
  } catch {
    return { background: '#1a1b26', foreground: '#c8c8c8', cursor: '#7c7cfa' }
  }
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_DOT_COLORS: Record<string, string> = {
  idle: '#6c757d',
  working: '#4ecdc4',
  error: '#ff6b6b',
  done: '#51cf66',
  waiting: '#ffd93d',
}

const STATUS_LABELS: Record<string, string> = {
  idle: 'idle',
  working: 'working',
  error: 'error',
  done: 'done',
  waiting: 'waiting',
}

// ---------------------------------------------------------------------------
// TerminalDock component
// ---------------------------------------------------------------------------

export function TerminalDock(): ReactElement | null {
  const dock = useUIStore((s) => s.terminalDock)
  const closeTerminalDock = useUIStore((s) => s.closeTerminalDock)
  const minimizeTerminalDock = useUIStore((s) => s.minimizeTerminalDock)
  const restoreTerminalDock = useUIStore((s) => s.restoreTerminalDock)
  const setDockActiveCharacter = useUIStore((s) => s.setDockActiveCharacter)
  const setDockPosition = useUIStore((s) => s.setDockPosition)
  const setDockSize = useUIStore((s) => s.setDockSize)
  const characters = useCharacterStore((s) => s.characters)
  const theme = useUIStore((s) => s.theme)

  const containerRef = useRef<HTMLDivElement>(null)
  const termContainerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null)

  // Characters with active sessions
  const activeChars = characters.filter((c) => c.currentSessionId !== null)

  // Auto-center on first open
  const [initialized, setInitialized] = useState(false)
  useEffect(() => {
    if (dock.visible && !initialized) {
      if (dock.position.x === -1) {
        const x = Math.max(0, (window.innerWidth - dock.size.width) / 2)
        const y = Math.max(0, window.innerHeight - dock.size.height - 60)
        setDockPosition({ x, y })
      }
      setInitialized(true)
    }
  }, [dock.visible, initialized, dock.position.x, dock.size.width, dock.size.height, setDockPosition])

  // Whether the active character currently has a session (drives terminal vs assign view)
  const activeCharHasSession = activeChars.some((c) => c.id === dock.activeCharacterId)

  // Attach/detach xterm to DOM when active character or visibility changes
  useEffect(() => {
    const el = termContainerRef.current
    if (!el || !dock.activeCharacterId || !dock.visible || dock.minimized || !activeCharHasSession) return

    const entry = getOrCreateTerminal(dock.activeCharacterId)

    // If already opened elsewhere, just reattach
    if (!entry.terminal.element || entry.terminal.element.parentElement !== el) {
      // Clear container
      el.innerHTML = ''
      entry.terminal.open(el)
    }

    // Fit after a frame (DOM needs to settle)
    requestAnimationFrame(() => {
      entry.fitAddon.fit()
      entry.terminal.focus()
      // Sync resize with PTY
      const { cols, rows } = entry.terminal
      window.api.invoke(IPC_COMMANDS.PTY_RESIZE, {
        characterId: dock.activeCharacterId,
        cols,
        rows,
      })
    })

    // Resize observer
    const ro = new ResizeObserver(() => {
      entry.fitAddon.fit()
      const { cols, rows } = entry.terminal
      window.api.invoke(IPC_COMMANDS.PTY_RESIZE, {
        characterId: dock.activeCharacterId!,
        cols,
        rows,
      })
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
    }
  }, [dock.activeCharacterId, dock.visible, dock.minimized, activeCharHasSession])

  // Update xterm theme when app theme changes
  useEffect(() => {
    const xtermTheme = getXtermTheme()
    for (const [, entry] of terminalInstances) {
      entry.terminal.options.theme = xtermTheme
    }
  }, [theme])

  // Clean up terminals when session is stopped
  useEffect(() => {
    const knownIds = new Set(activeChars.map((c) => c.id))
    for (const id of terminalInstances.keys()) {
      if (!knownIds.has(id)) {
        disposeTerminal(id)
      }
    }
  }, [activeChars])

  // ESC to close
  useEffect(() => {
    if (!dock.visible) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeTerminalDock()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dock.visible, closeTerminalDock])

  // --- Drag ---
  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('[data-no-drag]')) return
      e.preventDefault()
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: dock.position.x,
        origY: dock.position.y,
      }
      const onMove = (ev: MouseEvent): void => {
        if (!dragRef.current) return
        const dx = ev.clientX - dragRef.current.startX
        const dy = ev.clientY - dragRef.current.startY
        setDockPosition({
          x: Math.max(0, dragRef.current.origX + dx),
          y: Math.max(0, dragRef.current.origY + dy),
        })
      }
      const onUp = (): void => {
        dragRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [dock.position, setDockPosition]
  )

  // --- Resize ---
  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      resizeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origW: dock.size.width,
        origH: dock.size.height,
      }
      const onMove = (ev: MouseEvent): void => {
        if (!resizeRef.current) return
        const dw = ev.clientX - resizeRef.current.startX
        const dh = ev.clientY - resizeRef.current.startY
        setDockSize({
          width: Math.max(400, resizeRef.current.origW + dw),
          height: Math.max(200, resizeRef.current.origH + dh),
        })
      }
      const onUp = (): void => {
        resizeRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [dock.size, setDockSize]
  )

  if (!dock.visible) return null

  // Minimized: show small tab bar at bottom
  if (dock.minimized) {
    return (
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border bg-background shadow-lg"
        onClick={restoreTerminalDock}
        style={{ cursor: 'pointer' }}
      >
        {activeChars.map((c) => (
          <div key={c.id} className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-muted-foreground">
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ backgroundColor: STATUS_DOT_COLORS[c.status] || STATUS_DOT_COLORS.idle }}
            />
            <span>{c.name}</span>
          </div>
        ))}
        <span className="text-xs text-muted-foreground ml-2">Terminal</span>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="absolute z-[200] flex flex-col rounded-lg border border-border bg-background shadow-lg overflow-hidden"
      style={{
        left: dock.position.x,
        top: dock.position.y,
        width: dock.size.width,
        height: dock.size.height,
      }}
    >
      {/* Tab bar — draggable */}
      <div
        className="flex items-center bg-muted/50 border-b border-border shrink-0 select-none"
        onMouseDown={onDragStart}
        style={{ cursor: 'grab' }}
      >
        <div className="flex-1 flex items-center gap-0.5 px-1 overflow-x-auto styled-scroll">
          {activeChars.map((c) => (
            <TabButton
              key={c.id}
              character={c}
              isActive={c.id === dock.activeCharacterId}
              onClick={() => setDockActiveCharacter(c.id)}
            />
          ))}
          {/* Show current character tab even if no active session */}
          {dock.activeCharacterId && !activeChars.some((c) => c.id === dock.activeCharacterId) && (() => {
            const char = characters.find((c) => c.id === dock.activeCharacterId)
            return char ? (
              <TabButton
                key={char.id}
                character={char}
                isActive={true}
                onClick={() => {}}
              />
            ) : (
              <span className="text-xs text-muted-foreground px-3 py-2">No active sessions</span>
            )
          })()}
        </div>
        <div className="flex items-center gap-0.5 px-1.5 shrink-0" data-no-drag>
          <button
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-xs"
            onClick={minimizeTerminalDock}
            title="Minimize"
          >
            ─
          </button>
          <button
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors text-xs"
            onClick={closeTerminalDock}
            title="Close"
          >
            ×
          </button>
        </div>
      </div>

      {/* Terminal container or session assignment */}
      {dock.activeCharacterId && activeCharHasSession ? (
        <div className="flex-1 flex flex-col overflow-hidden relative" style={{ minHeight: 0 }}>
          {/* no overlay needed — errors are shown in terminal */}
          <div
            ref={termContainerRef}
            className="flex-1 overflow-hidden px-2 pb-1"
            style={{ minHeight: 0 }}
          />
        </div>
      ) : dock.activeCharacterId ? (
        <SessionAssignView
          character={characters.find((c) => c.id === dock.activeCharacterId)!}
          onSessionStarted={() => {}}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          Select a character to start
        </div>
      )}

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
        onMouseDown={onResizeStart}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" className="text-muted-foreground/40">
          <path d="M14 14L14 8M14 14L8 14" stroke="currentColor" strokeWidth="1.5" fill="none" />
          <path d="M14 14L14 11M14 14L11 14" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab button
// ---------------------------------------------------------------------------

function TabButton({
  character,
  isActive,
  onClick,
}: {
  character: Character
  isActive: boolean
  onClick: () => void
}): ReactElement {
  const [skinPreview, setSkinPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!character.skin) return
    const relPath = character.skin.startsWith('assets/') ? character.skin.slice(7) : character.skin
    window.api.invoke<string | null>(IPC_COMMANDS.ASSET_READ_BASE64, relPath).then(setSkinPreview)
  }, [character.skin])

  const dotColor = STATUS_DOT_COLORS[character.status] || STATUS_DOT_COLORS.idle

  return (
    <button
      className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-t transition-colors whitespace-nowrap ${
        isActive
          ? 'bg-background text-foreground border-b-2 border-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
      }`}
      onClick={onClick}
      data-no-drag
    >
      {skinPreview ? (
        <img
          src={skinPreview}
          alt=""
          className="w-5 h-5 rounded-sm object-contain"
          style={{ imageRendering: 'pixelated' }}
        />
      ) : (
        <span className="w-5 h-5 rounded-sm bg-muted flex items-center justify-center text-[10px]">
          {character.name[0]}
        </span>
      )}
      <span>{character.name}</span>
      <span
        className="w-2 h-2 rounded-full inline-block"
        style={{ backgroundColor: dotColor }}
      />
      <span className="text-[10px] text-muted-foreground">{STATUS_LABELS[character.status]}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// SessionAssignView — shown when no active sessions in the dock
// ---------------------------------------------------------------------------

function SessionAssignView({
  character,
  onSessionStarted,
}: {
  character: Character
  onSessionStarted: () => void
}): ReactElement {
  const loadCharacters = useCharacterStore((s) => s.loadFromMain)
  const [scannedSessions, setScannedSessions] = useState<ScannedSession[]>([])
  const [scanning, setScanning] = useState(false)
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set())
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set()) // dirs showing more than 5

  // Scan sessions filtered by engine on mount
  useEffect(() => {
    setScanning(true)
    window.api.invoke<ScannedSession[]>(IPC_COMMANDS.SESSION_SCAN).then((sessions) => {
      setScannedSessions((sessions ?? []).filter((s) => s.engineType === character.engine))
      setScanning(false)
    })
  }, [character.engine])

  const handleNewSessionInDir = useCallback(
    async (dir: string) => {
      try {
        await window.api.invoke(IPC_COMMANDS.SESSION_START, { characterId: character.id, workingDirectory: dir })
        await loadCharacters()
        onSessionStarted()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    },
    [character.id, loadCharacters, onSessionStarted]
  )

  const handleNewWorkDir = useCallback(async () => {
    const dir = await window.api.invoke<string | null>(IPC_COMMANDS.DIALOG_OPEN_FOLDER)
    if (!dir) return
    await window.api.invoke(IPC_COMMANDS.SESSION_START, { characterId: character.id, workingDirectory: dir })
    await loadCharacters()
    onSessionStarted()
  }, [character.id, loadCharacters, onSessionStarted])

  const handleAssignSession = useCallback(
    async (sessionId: string, workingDirectory: string) => {
      try {
        await window.api.invoke(IPC_COMMANDS.SESSION_RESUME, {
          characterId: character.id,
          sessionId,
          workingDirectory,
        })
        await loadCharacters()
        onSessionStarted()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    },
    [character.id, loadCharacters, onSessionStarted]
  )

  const toggleDir = useCallback((dir: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })
  }, [])

  // Group by workingDirectory
  const sessionsByDir = scannedSessions.reduce<Map<string, ScannedSession[]>>((map, s) => {
    const key = s.workingDirectory || 'Unknown'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(s)
    return map
  }, new Map())

  const shortDir = (dir: string): string => dir.replace(/^\/Users\/[^/]+/, '~')

  return (
    <div className="flex-1 overflow-y-auto styled-scroll p-4 space-y-3" style={{ minHeight: 0 }}>
      {/* Header with new working dir button */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {scanning ? 'Scanning sessions...' : `${scannedSessions.length} sessions found`}
        </p>
        <button
          className="text-[11px] px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          onClick={handleNewWorkDir}
        >
          + New Directory
        </button>
      </div>

      {/* Errors shown via toast */}

      {/* Session history */}
      {!scanning && scannedSessions.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground mb-2">No {character.engine} sessions found</p>
          <button
            className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            onClick={handleNewWorkDir}
          >
            Start New Session
          </button>
        </div>
      )}

      {/* Working directory groups */}
      {[...sessionsByDir.entries()].map(([dir, sessions]) => {
        const isCollapsed = collapsedDirs.has(dir)
        const isShowingMore = expandedDirs.has(dir)
        const visibleSessions = isShowingMore ? sessions : sessions.slice(0, 5)
        const hasMore = sessions.length > 5

        return (
          <div key={dir} className="rounded-md border border-border bg-muted/10">
            {/* Directory header */}
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <button
                className="text-muted-foreground hover:text-foreground transition-colors w-4 h-4 flex items-center justify-center shrink-0"
                onClick={() => toggleDir(dir)}
              >
                <span className={`text-[10px] transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>&#9654;</span>
              </button>
              <span className="text-[11px] font-mono text-muted-foreground truncate flex-1" title={dir}>
                {shortDir(dir)}
              </span>
              <button
                className="text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
                onClick={() => handleNewSessionInDir(dir)}
              >
                New Session
              </button>
            </div>

            {/* Sessions */}
            {!isCollapsed && (
              <div className="border-t border-border">
                {visibleSessions.map((s) => (
                  <div
                    key={s.sessionId}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/30 transition-colors group"
                  >
                    <span className="text-[11px] font-mono text-foreground truncate flex-1">
                      {s.label || s.sessionId.slice(0, 12)}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60 shrink-0">
                      {s.lastActiveAt ? new Date(s.lastActiveAt).toLocaleDateString() : ''}
                    </span>
                    <button
                      className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                      onClick={() => handleAssignSession(s.sessionId, dir)}
                    >
                      Assign
                    </button>
                  </div>
                ))}
                {hasMore && !isShowingMore && (
                  <button
                    className="w-full text-[10px] text-muted-foreground hover:text-foreground py-1.5 text-center hover:bg-muted/20 transition-colors"
                    onClick={() => setExpandedDirs((prev) => new Set(prev).add(dir))}
                  >
                    ...{sessions.length - 5} more
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
