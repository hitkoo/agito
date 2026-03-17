import { useEffect } from 'react'
import { IPC_EVENTS } from '../../../shared/ipc-channels'
import { useCharacterStore } from '../stores/character-store'
import type { CharacterRuntimeState } from '../../../shared/character-runtime-state'
import { useRuntimeStore } from '../stores/runtime-store'

export function useIPCSync(): void {
  const updateRuntimeState = useRuntimeStore((s) => s.updateState)

  useEffect(() => {
    const unsubRuntime = window.api.on(
      IPC_EVENTS.CHARACTER_RUNTIME,
      (payload: unknown) => {
        updateRuntimeState(payload as CharacterRuntimeState)
      }
    )

    const unsubStore = window.api.on(
      IPC_EVENTS.STORE_UPDATED,
      () => {
        useCharacterStore.getState().loadFromMain()
        useRuntimeStore.getState().loadFromMain()
      }
    )

    return () => {
      unsubRuntime()
      unsubStore()
    }
  }, [updateRuntimeState])
}
