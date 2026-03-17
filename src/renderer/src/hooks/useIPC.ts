import { useEffect, useRef } from 'react'
import { IPC_EVENTS } from '../../../shared/ipc-channels'
import { useCharacterStore } from '../stores/character-store'
import type { CharacterStatus } from '../../../shared/types'
import type { CharacterRuntimeState } from '../../../shared/character-runtime-state'
import { useRuntimeStore } from '../stores/runtime-store'
import { useAuthStore } from '../stores/auth-store'
import type { AuthSessionState } from '../../../shared/auth'

export function useIPCSync(): void {
  const updateStatus = useCharacterStore((s) => s.updateStatus)
  const updateRuntimeState = useRuntimeStore((s) => s.updateState)
  const setAuthSession = useAuthStore((s) => s.setSession)
  const lastStatusRef = useRef<Map<string, { status: CharacterStatus; time: number }>>(new Map())

  useEffect(() => {
    const THROTTLE_MS = 200

    const unsubStatus = window.api.on(
      IPC_EVENTS.CHARACTER_STATUS,
      (payload: unknown) => {
        const { characterId, status } = payload as {
          characterId: string
          status: CharacterStatus
        }
        const last = lastStatusRef.current.get(characterId)
        const now = Date.now()
        if (last && last.status === status && now - last.time < THROTTLE_MS) {
          return // skip duplicate within throttle window
        }
        lastStatusRef.current.set(characterId, { status, time: now })
        updateStatus(characterId, status)
      }
    )

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
      unsubStatus()
      unsubRuntime()
      unsubStore()
      unsubAuth()
    }
  }, [setAuthSession, updateRuntimeState, updateStatus])
}
