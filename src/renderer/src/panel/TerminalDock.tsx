import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react'
import { useCharacterStore } from '../stores/character-store'
import { useUIStore } from '../stores/ui-store'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import type { AssetListEntry, Character, ScannedSession } from '../../../shared/types'
import type { EngineType } from '../../../shared/types'
import {
  getTerminalDockRenderMode,
  isTerminalDockOwner,
  shouldRenderAssignedTerminal,
} from '../../../shared/terminal-dock-state'
import { TerminalView } from './TerminalView'
import { MoreVertical } from 'lucide-react'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_DOT_COLORS: Record<string, string> = {
  no_session: '#6c757d',
  idle: '#7c8591',
  running: '#4ecdc4',
  need_input: '#ffd93d',
  need_approval: '#ffb347',
  done: '#51cf66',
  error: '#ff6b6b',
}

const ENGINE_DISPLAY: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
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
  const refreshKeys = useUIStore((s) => s.terminalRefreshKey)
  const bumpTerminalRefreshKey = useUIStore((s) => s.bumpTerminalRefreshKey)
  const characters = useCharacterStore((s) => s.characters)

  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null)

  // Characters with assigned sessions (PTY may or may not be running)
  const assignedChars = characters.filter((c) => c.currentSessionId !== null)

  const activeCharHasSession = assignedChars.some((c) => c.id === dock.activeCharacterId)
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

  const attendedCharacterRef = useRef<string | null>(null)
  useEffect(() => {
    const nextAttendedCharacterId =
      renderMode === 'attached-dock' || renderMode === 'detached-dock'
        ? dock.activeCharacterId
        : null
    const previousCharacterId = attendedCharacterRef.current

    if (previousCharacterId && previousCharacterId !== nextAttendedCharacterId) {
      void window.api.invoke(IPC_COMMANDS.CHARACTER_RUNTIME_SET_ATTENTION, {
        characterId: previousCharacterId,
        attentionActive: false,
      })
    }

    if (nextAttendedCharacterId && nextAttendedCharacterId !== previousCharacterId) {
      void window.api.invoke(IPC_COMMANDS.CHARACTER_RUNTIME_SET_ATTENTION, {
        characterId: nextAttendedCharacterId,
        attentionActive: true,
      })
    }

    attendedCharacterRef.current = nextAttendedCharacterId

    return () => {
      if (attendedCharacterRef.current) {
        void window.api.invoke(IPC_COMMANDS.CHARACTER_RUNTIME_SET_ATTENTION, {
          characterId: attendedCharacterRef.current,
          attentionActive: false,
        })
        attendedCharacterRef.current = null
      }
    }
  }, [dock.activeCharacterId, renderMode])

  const visibleChars = assignedChars

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

  // --- Tab context menu ---
  const [tabContextMenu, setTabContextMenu] = useState<{ characterId: string; x: number; y: number } | null>(null)

  const handleTabMoreButton = useCallback((characterId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setTabContextMenu({ characterId, x: rect.left, y: rect.bottom })
  }, [])

  // Close tab context menu on click outside or ESC
  useEffect(() => {
    if (!tabContextMenu) return
    const close = (): void => setTabContextMenu(null)
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close() }
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', close)
      window.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [tabContextMenu])

  const handleTabAssignSession = useCallback(async () => {
    if (!tabContextMenu) return
    const charId = tabContextMenu.characterId
    setTabContextMenu(null)
    const char = characters.find((c) => c.id === charId)
    if (char?.currentSessionId) {
      await window.api.invoke(IPC_COMMANDS.SESSION_STOP, { characterId: charId })
      await loadCharacters()
    }
    handleTabSelect(charId)
  }, [tabContextMenu, characters, loadCharacters, handleTabSelect])

  const handleTabRefreshSession = useCallback(async () => {
    if (!tabContextMenu) return
    const charId = tabContextMenu.characterId
    setTabContextMenu(null)
    const char = characters.find((c) => c.id === charId)
    if (!char?.currentSessionId) return
    await window.api.invoke(IPC_COMMANDS.SESSION_RESUME, {
      characterId: charId,
      sessionId: char.currentSessionId,
    })
    await loadCharacters()
    bumpTerminalRefreshKey(charId)
  }, [tabContextMenu, characters, loadCharacters, bumpTerminalRefreshKey])

  const handleTabUnassignSession = useCallback(async () => {
    if (!tabContextMenu) return
    const charId = tabContextMenu.characterId
    setTabContextMenu(null)
    await window.api.invoke(IPC_COMMANDS.SESSION_STOP, { characterId: charId })
    await loadCharacters()
  }, [tabContextMenu, loadCharacters])

  // --- Add character (+) dropdown ---
  const [addDropdown, setAddDropdown] = useState<{ x: number; y: number } | null>(null)

  const handleAddButtonClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setAddDropdown({ x: rect.left, y: rect.bottom })
  }, [])

  // Close add dropdown on click outside or ESC
  useEffect(() => {
    if (!addDropdown) return
    const close = (): void => setAddDropdown(null)
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close() }
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', close)
      window.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [addDropdown])

  // Unassigned characters not currently in the tab bar
  const tabCharacterIds = new Set([
    ...visibleChars.map((c) => c.id),
    ...(dock.activeCharacterId && !visibleChars.some((c) => c.id === dock.activeCharacterId)
      ? [dock.activeCharacterId]
      : []),
  ])
  const unassignedChars = characters.filter(
    (c) => c.currentSessionId === null && !tabCharacterIds.has(c.id)
  )

  const handleAddUnassigned = useCallback((characterId: string) => {
    setAddDropdown(null)
    setDockActiveCharacter(characterId)
    void window.api.invoke(IPC_COMMANDS.TERMINAL_DOCK_SET_ACTIVE_CHARACTER, characterId)
  }, [setDockActiveCharacter])

  const handleCreateCharacter = useCallback(async () => {
    setAddDropdown(null)
    try {
      // Generate next available name
      const existingNames = new Set(characters.map((c) => c.name))
      let idx = 1
      let name = ''
      while (true) {
        name = `new_${String(idx).padStart(2, '0')}`
        if (!existingNames.has(name)) break
        idx++
      }

      // Pick a random skin
      const assets = await window.api.invoke<AssetListEntry[]>(IPC_COMMANDS.ASSET_LIST)
      const skins = (assets ?? []).filter((a) => a.category === 'skin')
      const randomSkin = skins.length > 0 ? skins[Math.floor(Math.random() * skins.length)] : null

      await window.api.invoke(IPC_COMMANDS.CHARACTER_CREATE, {
        name,
        ...(randomSkin ? { skin: randomSkin.relativePath } : {}),
      })
      await loadCharacters()

      // Find the newly created character and set it active
      const updated = useCharacterStore.getState().characters
      const newChar = updated.find((c) => c.name === name)
      if (newChar) {
        setDockActiveCharacter(newChar.id)
        void window.api.invoke(IPC_COMMANDS.TERMINAL_DOCK_SET_ACTIVE_CHARACTER, newChar.id)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create character.')
    }
  }, [characters, loadCharacters, setDockActiveCharacter])

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
  const shouldRenderTerminal = shouldRenderAssignedTerminal({
    activeCharacterId: dock.activeCharacterId,
    hasAssignedSession: activeCharHasSession,
  })
  const activeTerminalCharacterId = shouldRenderTerminal ? dock.activeCharacterId : null

  const menuItemClass = 'relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground'

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
              onMoreClick={(e) => handleTabMoreButton(c.id, e)}
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
                onMoreClick={(e) => handleTabMoreButton(char.id, e)}
              />
            ) : (
              <span className="text-xs text-muted-foreground px-3 py-2">No active sessions</span>
            )
          })()}

          {/* + Add character button */}
          <button
            className="flex items-center justify-center w-6 h-6 ml-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors text-sm font-medium shrink-0"
            onClick={handleAddButtonClick}
            data-no-drag
            style={detachedMode ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
            title="Add character"
          >
            +
          </button>
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

      {activeTerminalCharacterId && (
        <div className="flex-1 overflow-hidden min-h-0">
          <TerminalView
            key={`${activeTerminalCharacterId}-${refreshKeys[activeTerminalCharacterId] ?? 0}`}
            characterId={activeTerminalCharacterId}
            isActiveOwner={isActiveOwner}
            engine={activeCharacter?.engine ?? 'claude-code'}
          />
        </div>
      )}

      {dock.activeCharacterId && !activeCharacter && (
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

    {/* Tab context menu (triggered by ⋯ button) */}
    {tabContextMenu && (() => {
      const char = characters.find((c) => c.id === tabContextMenu.characterId)
      if (!char) return null
      return (
        <div
          className="fixed z-[200] min-w-[160px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {char.currentSessionId === null ? (
            <button className={menuItemClass} onClick={handleTabAssignSession}>
              Assign Session
            </button>
          ) : (
            <>
              <button className={menuItemClass} onClick={handleTabRefreshSession}>
                Refresh Session
              </button>
              <div className="my-1 h-px bg-border" />
              <button className={menuItemClass} onClick={handleTabAssignSession}>
                Assign Other Session
              </button>
              <button className={menuItemClass} onClick={handleTabUnassignSession}>
                Unassign Session
              </button>
            </>
          )}
        </div>
      )
    })()}

    {/* Add character dropdown */}
    {addDropdown && (
      <div
        className="fixed z-[200] min-w-[180px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        style={{ left: addDropdown.x, top: addDropdown.y }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {unassignedChars.map((c) => (
          <AddCharacterItem
            key={c.id}
            character={c}
            onClick={() => handleAddUnassigned(c.id)}
          />
        ))}
        {unassignedChars.length > 0 && (
          <div className="my-1 h-px bg-border" />
        )}
        <button
          className={menuItemClass}
          onClick={handleCreateCharacter}
        >
          Create Character
        </button>
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
  onMoreClick,
}: {
  character: Character
  isActive: boolean
  detachedMode: boolean
  onClick: () => void
  onMoreClick: (e: React.MouseEvent) => void
}): ReactElement {
  const [skinPreview, setSkinPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!character.skin) return
    const relPath = character.skin.startsWith('assets/') ? character.skin.slice(7) : character.skin
    window.api.invoke<string | null>(IPC_COMMANDS.ASSET_READ_BASE64, relPath).then(setSkinPreview)
  }, [character.skin])

  const dotColor = STATUS_DOT_COLORS[character.status] || STATUS_DOT_COLORS.idle

  return (
    <div
      className={`flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-t transition-colors whitespace-nowrap ${
        isActive
          ? 'bg-background text-foreground border-b-2 border-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
      }`}
      data-no-drag
      style={detachedMode ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
    >
      {/* Status dot — leftmost */}
      <span
        className="w-2 h-2 rounded-full inline-block shrink-0"
        style={{ backgroundColor: dotColor }}
      />
      {/* Avatar */}
      <button onClick={onClick} className="flex items-center gap-1 min-w-0">
        {skinPreview ? (
          <img
            src={skinPreview}
            alt=""
            className="w-5 h-5 rounded-sm object-contain shrink-0"
            style={{ imageRendering: 'pixelated' }}
          />
        ) : (
          <span className="w-5 h-5 rounded-sm bg-muted flex items-center justify-center text-[10px] shrink-0">
            {character.name[0]}
          </span>
        )}
        <span className="truncate">{character.name}</span>
      </button>
      {/* More button — rightmost */}
      <button
        className="flex items-center justify-center w-5 h-5 rounded hover:bg-muted/70 text-muted-foreground hover:text-foreground transition-colors shrink-0"
        onClick={onMoreClick}
        title="More options"
      >
        <MoreVertical size={12} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add character dropdown item (shows skin avatar + name)
// ---------------------------------------------------------------------------

function AddCharacterItem({
  character,
  onClick,
}: {
  character: Character
  onClick: () => void
}): ReactElement {
  const [skinPreview, setSkinPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!character.skin) return
    const relPath = character.skin.startsWith('assets/') ? character.skin.slice(7) : character.skin
    window.api.invoke<string | null>(IPC_COMMANDS.ASSET_READ_BASE64, relPath).then(setSkinPreview)
  }, [character.skin])

  return (
    <button
      className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
      onClick={onClick}
    >
      {skinPreview ? (
        <img
          src={skinPreview}
          alt=""
          className="w-5 h-5 rounded-sm object-contain shrink-0"
          style={{ imageRendering: 'pixelated' }}
        />
      ) : (
        <span className="w-5 h-5 rounded-sm bg-muted flex items-center justify-center text-[10px] shrink-0">
          {character.name[0]}
        </span>
      )}
      <span className="truncate">{character.name}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// SessionAssignView — shown when no active sessions in the dock
// ---------------------------------------------------------------------------

interface EngineDetectResult {
  found: boolean
  path?: string
  version?: string
}

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

  // Engine tab detection
  const [detectedEngines, setDetectedEngines] = useState<EngineType[]>([])
  const [selectedEngine, setSelectedEngine] = useState<EngineType | null>(null)

  useEffect(() => {
    const engineKeys: EngineType[] = ['claude-code', 'codex']
    Promise.all(
      engineKeys.map(async (key) => {
        try {
          const result = await window.api.invoke<EngineDetectResult>(IPC_COMMANDS.ENGINE_DETECT_CLI, key)
          return result?.found ? key : null
        } catch {
          return null
        }
      })
    ).then((results) => {
      const found = results.filter((r): r is EngineType => r !== null)
      setDetectedEngines(found)
      if (found.length > 0) {
        setSelectedEngine(found[0])
      }
    })
  }, [])

  useEffect(() => {
    const engine = selectedEngine ?? character.engine
    setScanning(true)
    window.api.invoke<ScannedSession[]>(IPC_COMMANDS.SESSION_SCAN).then((sessions) => {
      setScannedSessions((sessions ?? []).filter((s) => s.engineType === engine))
      setScanning(false)
    })
  }, [character.engine, selectedEngine])

  const handleNewSessionInDir = useCallback(
    async (dir: string) => {
      try {
        const engine = selectedEngine ?? character.engine
        await window.api.invoke(IPC_COMMANDS.SESSION_START, {
          characterId: character.id,
          workingDirectory: dir,
          engine,
        })
        await loadCharacters()
        onSessionStarted()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    },
    [character.id, character.engine, selectedEngine, loadCharacters, onSessionStarted]
  )

  const handleNewWorkDir = useCallback(async () => {
    const dir = await window.api.invoke<string | null>(IPC_COMMANDS.DIALOG_OPEN_FOLDER)
    if (!dir) return
    try {
      const engine = selectedEngine ?? character.engine
      await window.api.invoke(IPC_COMMANDS.SESSION_START, {
        characterId: character.id,
        workingDirectory: dir,
        engine,
      })
      await loadCharacters()
      onSessionStarted()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [character.id, character.engine, selectedEngine, loadCharacters, onSessionStarted])

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
      {/* Engine tabs */}
      {detectedEngines.length > 1 && (
        <div className="flex items-center gap-1 border-b border-border pb-2">
          {detectedEngines.map((engine) => (
            <button
              key={engine}
              className={`text-[11px] px-2.5 py-1 rounded-t transition-colors ${
                selectedEngine === engine
                  ? 'bg-background text-foreground border border-border border-b-background'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
              onClick={() => setSelectedEngine(engine)}
            >
              {ENGINE_DISPLAY[engine] ?? engine}
            </button>
          ))}
        </div>
      )}

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
          <p className="text-sm text-muted-foreground mb-2">No {selectedEngine ?? character.engine} sessions found</p>
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
