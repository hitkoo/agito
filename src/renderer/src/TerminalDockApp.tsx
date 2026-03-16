import { useEffect } from 'react'
import { useIPCSync } from './hooks/useIPC'
import { readTerminalDockSyncState, useTerminalDockSync } from './hooks/useTerminalDockSync'
import { useTheme, getPersistedTheme } from './hooks/useTheme'
import { useCharacterStore } from './stores/character-store'
import { useUIStore } from './stores/ui-store'
import { TerminalDock } from './panel/TerminalDock'
import { Toaster } from 'sonner'
import { IPC_COMMANDS } from '../../shared/ipc-channels'

/**
 * Detached terminal dock window — renders only the TerminalDock component
 * in a frameless, standalone BrowserWindow.
 */
export function TerminalDockApp(): JSX.Element {
  const loadCharacters = useCharacterStore((s) => s.loadFromMain)
  const openTerminalDock = useUIStore((s) => s.openTerminalDock)
  const syncTerminalDock = useUIStore((s) => s.syncTerminalDock)
  const setTheme = useUIStore((s) => s.setTheme)
  const dockDetached = useUIStore((s) => s.terminalDock.detached)

  useIPCSync()
  useTerminalDockSync()
  useTheme()

  useEffect(() => {
    let cancelled = false

    void (async () => {
      setTheme(getPersistedTheme())
      const state = await readTerminalDockSyncState()
      if (cancelled) return
      syncTerminalDock(state)
      if (state.detached && state.activeCharacterId) {
        openTerminalDock(state.activeCharacterId)
      }
      await window.api.invoke(IPC_COMMANDS.TERMINAL_DOCK_READY)
      await loadCharacters()
    })()

    return () => {
      cancelled = true
    }
  }, [loadCharacters, openTerminalDock, setTheme, syncTerminalDock])

  return (
    <div className="flex flex-col h-full w-full bg-background text-foreground">
      <Toaster position="top-center" richColors theme="dark" />
      <div className="flex-1 relative overflow-hidden">
        {dockDetached && <TerminalDock detachedMode />}
      </div>
    </div>
  )
}
