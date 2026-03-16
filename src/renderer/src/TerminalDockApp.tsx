import { useEffect } from 'react'
import { useIPCSync } from './hooks/useIPC'
import { useTheme, getPersistedTheme } from './hooks/useTheme'
import { useCharacterStore } from './stores/character-store'
import { useUIStore } from './stores/ui-store'
import { TerminalDock } from './panel/TerminalDock'
import { Toaster } from 'sonner'
import { IPC_DOCK_EVENTS } from '../../shared/ipc-channels'

/**
 * Detached terminal dock window — renders only the TerminalDock component
 * in a frameless, standalone BrowserWindow.
 */
export function TerminalDockApp(): JSX.Element {
  const loadCharacters = useCharacterStore((s) => s.loadFromMain)
  const characters = useCharacterStore((s) => s.characters)
  const setDockDetached = useUIStore((s) => s.setDockDetached)
  const openTerminalDock = useUIStore((s) => s.openTerminalDock)
  const setTheme = useUIStore((s) => s.setTheme)

  useIPCSync()
  useTheme()

  // Load data, apply theme, mark as detached mode
  useEffect(() => {
    setTheme(getPersistedTheme())
    setDockDetached(true)
    loadCharacters()

    const unsub = window.api.on(IPC_DOCK_EVENTS.TERMINAL_DOCK_SYNC, (payload: unknown) => {
      const data = payload as { detached?: boolean; activeCharacterId?: string }
      if (data.activeCharacterId) {
        openTerminalDock(data.activeCharacterId)
      }
    })
    return () => { unsub() }
  }, [loadCharacters, setDockDetached, openTerminalDock, setTheme])

  // Open dock for first assigned character once characters are loaded
  useEffect(() => {
    const dock = useUIStore.getState().terminalDock
    if (!dock.activeCharacterId || !dock.visible) {
      const assigned = characters.find((c) => c.currentSessionId !== null)
      if (assigned) openTerminalDock(assigned.id)
    }
  }, [characters, openTerminalDock])

  return (
    <div className="flex flex-col h-full w-full bg-background text-foreground">
      <Toaster position="top-center" richColors theme="dark" />
      <div className="flex-1 relative overflow-hidden">
        <TerminalDock detachedMode />
      </div>
    </div>
  )
}
