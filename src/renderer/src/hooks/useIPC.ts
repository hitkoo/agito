import { useEffect } from 'react'
import { IPC_EVENTS } from '../../../shared/ipc-channels'
import { useCharacterStore } from '../stores/character-store'
import type { CharacterStatus } from '../../../shared/types'

export function useIPCSync(): void {
  const updateStatus = useCharacterStore((s) => s.updateStatus)

  useEffect(() => {
    const unsubStatus = window.api.on(
      IPC_EVENTS.CHARACTER_STATUS,
      (payload: unknown) => {
        const { characterId, status } = payload as {
          characterId: string
          status: CharacterStatus
        }
        updateStatus(characterId, status)
      }
    )

    const unsubStore = window.api.on(
      IPC_EVENTS.STORE_UPDATED,
      () => {
        useCharacterStore.getState().loadFromMain()
      }
    )

    return () => {
      unsubStatus()
      unsubStore()
    }
  }, [updateStatus])
}
