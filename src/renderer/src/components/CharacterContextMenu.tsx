import { type ReactElement, useEffect, useCallback } from 'react'
import { useUIStore } from '../stores/ui-store'
import { useCharacterStore } from '../stores/character-store'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'

export function CharacterContextMenu(): ReactElement | null {
  const contextMenu = useUIStore((s) => s.contextMenu)
  const closeContextMenu = useUIStore((s) => s.closeContextMenu)
  const openTerminalDock = useUIStore((s) => s.openTerminalDock)
  const characters = useCharacterStore((s) => s.characters)
  const loadCharacters = useCharacterStore((s) => s.loadFromMain)

  const character = contextMenu
    ? characters.find((c) => c.id === contextMenu.characterId)
    : null

  // Close on ESC
  useEffect(() => {
    if (!contextMenu) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeContextMenu()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [contextMenu, closeContextMenu])

  // Close on click outside
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = (): void => closeContextMenu()
    // Delay attaching to avoid immediately closing
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', handleClick)
    }, 0)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousedown', handleClick)
    }
  }, [contextMenu, closeContextMenu])

  const handleAssignSession = useCallback(async () => {
    if (!contextMenu) return
    const characterId = contextMenu.characterId
    closeContextMenu()
    // Stop current session if running
    const char = useCharacterStore.getState().characters.find((c) => c.id === characterId)
    if (char?.currentSessionId) {
      await window.api.invoke(IPC_COMMANDS.SESSION_STOP, { characterId })
      await loadCharacters()
    }
    // Open terminal dock — SessionAssignView will show automatically
    openTerminalDock(characterId)
  }, [contextMenu, closeContextMenu, loadCharacters, openTerminalDock])

  const bumpTerminalRefreshKey = useUIStore((s) => s.bumpTerminalRefreshKey)

  const handleRefreshSession = useCallback(async () => {
    if (!contextMenu) return
    const characterId = contextMenu.characterId
    closeContextMenu()
    const char = useCharacterStore.getState().characters.find((c) => c.id === characterId)
    if (!char?.currentSessionId) return
    // Re-resume same session — replaceSession() internally kills old PTY
    await window.api.invoke(IPC_COMMANDS.SESSION_RESUME, {
      characterId,
      sessionId: char.currentSessionId,
    })
    await loadCharacters()
    bumpTerminalRefreshKey(characterId)
  }, [contextMenu, closeContextMenu, loadCharacters, bumpTerminalRefreshKey])

  const handleUnassignSession = useCallback(async () => {
    if (!contextMenu) return
    closeContextMenu()
    await window.api.invoke(IPC_COMMANDS.SESSION_STOP, {
      characterId: contextMenu.characterId,
    })
    await loadCharacters()
  }, [contextMenu, closeContextMenu, loadCharacters])

  // Prevent browser context menu on the canvas
  useEffect(() => {
    const preventDefault = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (target.tagName === 'CANVAS') {
        e.preventDefault()
      }
    }
    window.addEventListener('contextmenu', preventDefault)
    return () => window.removeEventListener('contextmenu', preventDefault)
  }, [])

  if (!contextMenu || !character) return null

  const menuItemClass =
    'relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground'

  return (
    <div
      className="fixed z-[200] min-w-[160px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ left: contextMenu.x, top: contextMenu.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {character.currentSessionId === null ? (
        <button className={menuItemClass} onClick={handleAssignSession}>
          Assign Session
        </button>
      ) : (
        <>
          <button className={menuItemClass} onClick={handleRefreshSession}>
            Refresh Session
          </button>
          <div className="my-1 h-px bg-border" />
          <button className={menuItemClass} onClick={handleAssignSession}>
            Assign Other Session
          </button>
          <button className={menuItemClass} onClick={handleUnassignSession}>
            Unassign Session
          </button>
        </>
      )}
    </div>
  )
}
