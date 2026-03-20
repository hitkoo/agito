import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { IPC_EVENTS } from '../../../shared/ipc-channels'
import { useCharacterStore } from '../stores/character-store'
import type { CharacterRuntimeState } from '../../../shared/character-runtime-state'
import { useRuntimeStore } from '../stores/runtime-store'
import { useAuthStore } from '../stores/auth-store'
import { useSettingsStore } from '../stores/settings-store'
import type { AuthSessionState } from '../../../shared/auth'
import { useBillingStore } from '../stores/billing-store'
import { useUIStore } from '../stores/ui-store'
import type { BillingCheckoutStatus, BillingPendingCheckout } from '../../../shared/billing'
import {
  getPendingCheckoutPollTargets,
  reconcilePendingCheckoutStatuses,
} from '../lib/pending-checkout-reconciliation'

export function useIPCSync(): void {
  const updateRuntimeState = useRuntimeStore((s) => s.updateState)
  const setAuthSession = useAuthStore((s) => s.setSession)
  const pendingCheckouts = useBillingStore((s) => s.pendingCheckouts)
  const setPendingCheckouts = useBillingStore((s) => s.setPendingCheckouts)
  const getCheckoutStatus = useBillingStore((s) => s.getCheckoutStatus)
  const loadBilling = useBillingStore((s) => s.loadFromMain)
  const inFlightCheckoutIdsRef = useRef<Set<string>>(new Set())
  const notifiedTerminalCheckoutIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const unsubRuntime = window.api.on(
      IPC_EVENTS.CHARACTER_RUNTIME,
      (payload: unknown) => {
        updateRuntimeState(payload as CharacterRuntimeState)
      }
    )

    const unsubStore = window.api.on(
      IPC_EVENTS.STORE_UPDATED,
      (payload: unknown) => {
        const key = (payload as { key?: string } | null)?.key
        if (key === 'settings') {
          void useSettingsStore.getState().loadFromMain()
          return
        }
        useCharacterStore.getState().loadFromMain()
        useRuntimeStore.getState().loadFromMain()
      }
    )

    const unsubAuth = window.api.on(
      IPC_EVENTS.AUTH_SESSION_CHANGED,
      (payload: unknown) => {
        const session = payload as AuthSessionState
        setAuthSession(session)
        if (session.status === 'signed_in') {
          void loadBilling().catch((error) => {
            console.error('[BILLING] Failed to sync billing state', error)
          })
        } else {
          inFlightCheckoutIdsRef.current.clear()
          notifiedTerminalCheckoutIdsRef.current.clear()
          useBillingStore.getState().clear()
        }
      }
    )

    const unsubBilling = window.api.on(
      IPC_EVENTS.BILLING_CHECKOUT_RETURNED,
      (payload: unknown) => {
        const event = payload as { status?: 'completed' | 'cancelled'; query?: { checkout_id?: string } }
        if (event.status === 'completed') {
          useUIStore.getState().openGenerateHome()
          const currentPending = useBillingStore.getState().pendingCheckouts
          const checkoutId = event.query?.checkout_id
          if (checkoutId && !currentPending.some((item) => item.checkoutId === checkoutId)) {
            setPendingCheckouts([
              ...currentPending,
              {
                checkoutId,
                packId: 'unknown',
                credits: 0,
                status: 'open',
              },
            ])
          }
          void loadBilling().catch((error) => {
            console.error('[BILLING] Failed to refresh after checkout callback', error)
          })
        }
      }
    )

    return () => {
      unsubRuntime()
      unsubStore()
      unsubAuth()
      unsubBilling()
    }
  }, [loadBilling, setAuthSession, setPendingCheckouts, updateRuntimeState])

  useEffect(() => {
    if (pendingCheckouts.length === 0) {
      inFlightCheckoutIdsRef.current.clear()
      return
    }

    let cancelled = false

    const pollPendingCheckouts = async (): Promise<void> => {
      const currentPending = useBillingStore.getState().pendingCheckouts
      if (currentPending.length === 0) {
        return
      }

      const pollTargets = getPendingCheckoutPollTargets(currentPending, inFlightCheckoutIdsRef.current)
      if (pollTargets.length === 0) {
        return
      }

      const statuses: BillingCheckoutStatus[] = []
      await Promise.all(pollTargets.map(async (pending) => {
        inFlightCheckoutIdsRef.current.add(pending.checkoutId)
        try {
          statuses.push(await getCheckoutStatus(pending.checkoutId))
        } catch (error) {
          console.error('[BILLING] Failed to reconcile checkout', error)
        } finally {
          inFlightCheckoutIdsRef.current.delete(pending.checkoutId)
        }
      }))

      if (cancelled) return

      const {
        nextPending,
        notifications,
        shouldRefreshBilling,
        resolvedCheckoutIds,
      } = reconcilePendingCheckoutStatuses({
        currentPending,
        statuses,
        notifiedTerminalCheckoutIds: notifiedTerminalCheckoutIdsRef.current,
      })

      for (const checkoutId of resolvedCheckoutIds) {
        notifiedTerminalCheckoutIdsRef.current.add(checkoutId)
      }
      setPendingCheckouts(nextPending)
      for (const notification of notifications) {
        if (notification.kind === 'success') {
          toast.success(`${notification.credits} Gito added`)
        } else {
          toast.error('Checkout did not complete')
        }
      }
      if (shouldRefreshBilling) {
        try {
          await loadBilling()
        } catch (error) {
          console.error('[BILLING] Failed to refresh billing after checkout reconciliation', error)
        }
      }
    }

    void pollPendingCheckouts()
    const interval = window.setInterval(() => {
      void pollPendingCheckouts()
    }, 2000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [getCheckoutStatus, loadBilling, pendingCheckouts.length, setPendingCheckouts])
}
