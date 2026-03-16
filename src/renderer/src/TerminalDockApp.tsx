import { useEffect } from 'react'
import { useIPCSync } from './hooks/useIPC'
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
  const setDockDetached = useUIStore((s) => s.setDockDetached)
  const openTerminalDock = useUIStore((s) => s.openTerminalDock)

  useIPCSync()

  // Load data and mark as detached mode
  useEffect(() => {
    loadCharacters()
    setDockDetached(true)

    // Listen for sync events from main process
    const unsub = window.api.on(IPC_DOCK_EVENTS.TERMINAL_DOCK_SYNC, (payload: unknown) => {
      const data = payload as { detached?: boolean; activeCharacterId?: string }
      if (data.activeCharacterId) {
        openTerminalDock(data.activeCharacterId)
      }
    })

    return () => {
      unsub()
    }
  }, [loadCharacters, setDockDetached, openTerminalDock])

  // Force dock visible in detached mode
  useEffect(() => {
    const dock = useUIStore.getState().terminalDock
    if (!dock.visible) {
      // Restore last active character or first assigned
      const chars = useCharacterStore.getState().characters
      const assigned = chars.find((c) => c.currentSessionId !== null)
      if (assigned) {
        openTerminalDock(assigned.id)
      }
    }
  }, [openTerminalDock])

  return (
    <div className="flex flex-col h-full w-full bg-background text-foreground">
      <Toaster position="top-center" richColors theme="dark" />
      {/* Custom title bar for frameless window */}
      <div
        className="h-1 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
      <div className="flex-1 relative overflow-hidden">
        <TerminalDock detachedMode />
      </div>
    </div>
  )
}
