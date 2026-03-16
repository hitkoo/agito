import { useEffect } from 'react'
import { IPC_COMMANDS, IPC_DOCK_EVENTS } from '../../../shared/ipc-channels'
import type { TerminalDockSyncState } from '../../../shared/types'
import { useUIStore } from '../stores/ui-store'

export function useTerminalDockSync(): void {
  const syncTerminalDock = useUIStore((s) => s.syncTerminalDock)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const initialState = await readTerminalDockSyncState()
      if (!cancelled) {
        syncTerminalDock(initialState)
      }
    })()

    const unsub = window.api.on(IPC_DOCK_EVENTS.TERMINAL_DOCK_SYNC, (payload: unknown) => {
      syncTerminalDock(payload as TerminalDockSyncState)
    })

    return () => {
      cancelled = true
      unsub()
    }
  }, [syncTerminalDock])
}

export async function readTerminalDockSyncState(): Promise<TerminalDockSyncState> {
  return window.api.invoke<TerminalDockSyncState>(IPC_COMMANDS.TERMINAL_DOCK_GET_STATE)
}
