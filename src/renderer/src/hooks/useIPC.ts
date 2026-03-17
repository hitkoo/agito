import { useEffect } from 'react'
import { IPC_EVENTS } from '../../../shared/ipc-channels'
import { useCharacterStore } from '../stores/character-store'
import type { CharacterRuntimeState } from '../../../shared/character-runtime-state'
import { useRuntimeStore } from '../stores/runtime-store'
import { useAuthStore } from '../stores/auth-store'
import type { AuthSessionState } from '../../../shared/auth'

export function useIPCSync(): void {
  const updateRuntimeState = useRuntimeStore((s) => s.updateState)
  const setAuthSession = useAuthStore((s) => s.setSession)

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

    const unsubAuth = window.api.on(
      IPC_EVENTS.AUTH_SESSION_CHANGED,
      (payload: unknown) => {
        setAuthSession(payload as AuthSessionState)
      }
    )

    return () => {
      unsubRuntime()
      unsubStore()
      unsubAuth()
    }
  }, [setAuthSession, updateRuntimeState])
}
