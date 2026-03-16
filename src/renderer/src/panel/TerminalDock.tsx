import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react'
import { useCharacterStore } from '../stores/character-store'
import { useUIStore } from '../stores/ui-store'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import type { Character, ScannedSession } from '../../../shared/types'
import {
  getTerminalDockRenderMode,
  isTerminalDockOwner,
  shouldAutoResumeTerminal,
} from '../../../shared/terminal-dock-state'
import { TerminalView } from './TerminalView'
import { toast } from 'sonner'

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

export function TerminalDock({ detachedMode = false }: { detachedMode?: boolean } = {}): ReactElement | null {
  const dock = useUIStore((s) => s.terminalDock)
  const minimizeTerminalDock = useUIStore((s) => s.minimizeTerminalDock)
  const restoreTerminalDock = useUIStore((s) => s.restoreTerminalDock)
  const setDockActiveCharacter = useUIStore((s) => s.setDockActiveCharacter)
  const setDockPosition = useUIStore((s) => s.setDockPosition)
  const setDockSize = useUIStore((s) => s.setDockSize)
  const characters = useCharacterStore((s) => s.characters)

  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null)

  // Characters with assigned sessions (PTY may or may not be running)
  const assignedChars = characters.filter((c) => c.currentSessionId !== null)

  // Track which PTYs are actually alive
  const [alivePtys, setAlivePtys] = useState<Set<string>>(new Set())
  const [checkedPtys, setCheckedPtys] = useState<Set<string>>(new Set())
  useEffect(() => {
    let cancelled = false
    async function check(): Promise<void> {
      const ids = Array.from(
        new Set(
          [...assignedChars.map((c) => c.id), dock.activeCharacterId].filter((id): id is string => Boolean(id))
        )
      )
      const aliveIds = await window.api.invoke<string[]>(IPC_COMMANDS.PTY_GET_ALIVE_IDS, ids)
      const alive = new Set(aliveIds)
      if (!cancelled) {
        setAlivePtys(alive)
        setCheckedPtys(new Set(ids))
      }
    }
    void check()
    // Re-check when characters change (session started/stopped)
    return () => { cancelled = true }
  }, [assignedChars.map((c) => `${c.id}:${c.currentSessionId}:${c.status}`).join(), dock.activeCharacterId])

  const activeCharHasSession = assignedChars.some((c) => c.id === dock.activeCharacterId)
  const activeCharAliveKnown = checkedPtys.has(dock.activeCharacterId ?? '')
  const activeCharPtyAlive = alivePtys.has(dock.activeCharacterId ?? '')
  const loadCharacters = useCharacterStore((s) => s.loadFromMain)
  const renderMode = getTerminalDockRenderMode({
    detachedMode,
    detached: dock.detached,
    visible: dock.visible,
    minimized: dock.minimized,
    ownerWindow: dock.ownerWindow,
    detachedReady: dock.detachedReady,
  })
  const isActiveOwner = isTerminalDockOwner({
    detachedMode,
    ownerWindow: dock.ownerWindow,
  })

  // Only show tabs for characters with alive PTYs + the currently active character
  const visibleChars = assignedChars.filter((c) => alivePtys.has(c.id) || c.id === dock.activeCharacterId)

  // Auto-resume: when active character has session but PTY is dead, resume automatically
  const [resumingChars, setResumingChars] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!shouldAutoResumeTerminal({
      renderMode,
      activeCharacterId: dock.activeCharacterId,
      hasAssignedSession: activeCharHasSession,
      ptyAlive: !activeCharAliveKnown ? true : activeCharPtyAlive,
      isResuming: resumingChars.has(dock.activeCharacterId ?? ''),
    })) return

    const char = characters.find((c) => c.id === dock.activeCharacterId)
    if (!char?.currentSessionId) return

    const charId = dock.activeCharacterId
    if (!charId) return
    setResumingChars((prev) => new Set(prev).add(charId))

    ;(async () => {
      try {
        // SESSION_RESUME looks up workingDirectory from sessions.json if not provided
        await window.api.invoke(IPC_COMMANDS.SESSION_RESUME, {
          characterId: charId,
          sessionId: char.currentSessionId,
        })
        await loadCharacters()
        setAlivePtys((prev) => new Set(prev).add(charId))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
        // Clear invalid session so user gets assign view
        await window.api.invoke(IPC_COMMANDS.SESSION_STOP, { characterId: charId })
        await loadCharacters()
      } finally {
        setResumingChars((prev) => { const next = new Set(prev); next.delete(charId); return next })
      }
    })()
  }, [renderMode, dock.activeCharacterId, activeCharHasSession, activeCharPtyAlive, characters, loadCharacters, resumingChars])

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

  // ESC to minimize
  useEffect(() => {
    if (renderMode === 'hidden' || renderMode === 'attached-dock-hidden-warm') return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (detachedMode) {
        void window.api.invoke(IPC_COMMANDS.TERMINAL_DOCK_MINIMIZE)
        return
      }
      minimizeTerminalDock()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detachedMode, minimizeTerminalDock, renderMode])

  const handleTabSelect = useCallback((characterId: string) => {
    setDockActiveCharacter(characterId)
    void window.api.invoke(IPC_COMMANDS.TERMINAL_DOCK_SET_ACTIVE_CHARACTER, characterId)
  }, [setDockActiveCharacter])

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

  const activeCharacter = dock.activeCharacterId
    ? characters.find((c) => c.id === dock.activeCharacterId) ?? null
    : null

  return (
    <>
    {renderMode === 'attached-minimized-bar' && (
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border bg-background shadow-lg"
        onClick={restoreTerminalDock}
        style={{ cursor: 'pointer' }}
      >
        {visibleChars.map((c) => (
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
    )}

    {renderMode === 'detached-minimized-bar' && (
      <div
        className="flex items-center justify-between h-full w-full px-3 border-b border-border bg-background/95 select-none"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <button
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={() => window.api.invoke(IPC_COMMANDS.TERMINAL_DOCK_RESTORE)}
        >
          {activeCharacter ? `${activeCharacter.name} terminal` : 'Terminal'}
        </button>
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-[10px]"
            onClick={() => window.api.invoke(IPC_COMMANDS.TERMINAL_DOCK_ATTACH)}
            title="Attach to main window"
          >
            ⤓
          </button>
          <button
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-xs"
            onClick={() => window.api.invoke(IPC_COMMANDS.TERMINAL_DOCK_RESTORE)}
            title="Restore"
          >
            □
          </button>
        </div>
      </div>
    )}

    {/* Main dock */}
    {renderMode !== 'hidden' && renderMode !== 'attached-minimized-bar' && renderMode !== 'detached-minimized-bar' && (
    <div
      ref={containerRef}
      className={detachedMode
        ? 'flex flex-col h-full w-full bg-background overflow-hidden'
        : 'absolute z-[200] flex flex-col rounded-lg border border-border bg-background shadow-lg overflow-hidden'
      }
      style={{
        ...(detachedMode ? {} : {
          left: dock.position.x,
          top: dock.position.y,
          width: dock.size.width,
          height: dock.size.height,
          display: 'flex',
        }),
        ...(renderMode === 'attached-dock-hidden-warm'
          ? { opacity: 0, pointerEvents: 'none' as const }
          : {}),
      }}
    >
      {/* Tab bar — JS drag in attach mode, native window drag in detach mode */}
      <div
        className="flex items-center bg-muted/50 border-b border-border shrink-0 select-none"
        onMouseDown={detachedMode ? undefined : onDragStart}
        style={{
          cursor: detachedMode ? 'grab' : 'grab',
          ...(detachedMode ? { WebkitAppRegion: 'drag' } as React.CSSProperties : {}),
        }}
      >
        {detachedMode && (
          <div className="px-3 text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80 shrink-0">
            Dock
          </div>
        )}
        <div
          className="flex-1 flex items-center gap-0.5 px-1 overflow-x-auto styled-scroll"
        >
          {visibleChars.map((c) => (
            <TabButton
              key={c.id}
              character={c}
              isActive={c.id === dock.activeCharacterId}
              detachedMode={detachedMode}
              onClick={() => handleTabSelect(c.id)}
            />
          ))}
          {/* Show current character tab even if no active session */}
          {dock.activeCharacterId && !visibleChars.some((c) => c.id === dock.activeCharacterId) && (() => {
            const char = characters.find((c) => c.id === dock.activeCharacterId)
            return char ? (
              <TabButton
                key={char.id}
                character={char}
                isActive={true}
                detachedMode={detachedMode}
                onClick={() => {}}
              />
            ) : (
              <span className="text-xs text-muted-foreground px-3 py-2">No active sessions</span>
            )
          })()}
        </div>
        <div
          className="flex items-center gap-0.5 px-1.5 shrink-0"
          data-no-drag
          style={detachedMode ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
        >
          {detachedMode ? (
            <button
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-[10px]"
              onClick={() => window.api.invoke(IPC_COMMANDS.TERMINAL_DOCK_ATTACH)}
              title="Attach to main window"
            >
              ⤓
            </button>
          ) : (
            <button
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-[10px]"
              onClick={() => window.api.invoke(IPC_COMMANDS.TERMINAL_DOCK_DETACH, {
                width: dock.size.width,
                height: dock.size.height,
                activeCharacterId: dock.activeCharacterId,
              })}
              title="Detach to separate window"
            >
              ⤴
            </button>
          )}
          <button
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-xs"
            onClick={detachedMode
              ? () => window.api.invoke(IPC_COMMANDS.TERMINAL_DOCK_MINIMIZE)
              : minimizeTerminalDock
            }
            title="Minimize"
          >
            ─
          </button>
        </div>
      </div>

      {dock.activeCharacterId && activeCharHasSession && activeCharPtyAlive && (
        <div className="flex-1 overflow-hidden min-h-0">
          <TerminalView characterId={dock.activeCharacterId} isActiveOwner={isActiveOwner} />
        </div>
      )}

      {/* Resuming indicator when session assigned but PTY not yet alive */}
      {dock.activeCharacterId && activeCharHasSession && !activeCharPtyAlive && (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          Resuming session...
        </div>
      )}

      {dock.activeCharacterId && !activeCharacter && !activeCharPtyAlive && (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          Loading terminal...
        </div>
      )}

      {/* Session assign view when no session assigned */}
      {activeCharacter && !activeCharHasSession && (
        <SessionAssignView
          character={activeCharacter}
          onSessionStarted={() => {}}
        />
      )}

      {/* No character selected */}
      {!dock.activeCharacterId && (
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
    )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Tab button
// ---------------------------------------------------------------------------

function TabButton({
  character,
  isActive,
  detachedMode,
  onClick,
}: {
  character: Character
  isActive: boolean
  detachedMode: boolean
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
      style={detachedMode ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
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
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())

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
    try {
      await window.api.invoke(IPC_COMMANDS.SESSION_START, { characterId: character.id, workingDirectory: dir })
      await loadCharacters()
      onSessionStarted()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
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

  const sessionsByDir = scannedSessions.reduce<Map<string, ScannedSession[]>>((map, s) => {
    const key = s.workingDirectory || 'Unknown'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(s)
    return map
  }, new Map())

  const shortDir = (dir: string): string => dir.replace(/^\/Users\/[^/]+/, '~')

  return (
    <div className="flex-1 overflow-y-auto styled-scroll p-4 space-y-3" style={{ minHeight: 0 }}>
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

      {[...sessionsByDir.entries()].map(([dir, sessions]) => {
        const isCollapsed = collapsedDirs.has(dir)
        const isShowingMore = expandedDirs.has(dir)
        const visibleSessions = isShowingMore ? sessions : sessions.slice(0, 5)
        const hasMore = sessions.length > 5

        return (
          <div key={dir} className="rounded-md border border-border bg-muted/10">
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

            {!isCollapsed && (
              <div className="border-t border-border">
                {visibleSessions.map((s) => (
                  <div
                    key={s.sessionId}
                    className="flex items-center gap-2 pl-7 pr-3 py-1.5 hover:bg-muted/30 transition-colors group"
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
