import { create } from 'zustand'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import type {
  BillingCheckoutStatus,
  BillingCheckoutSessionRequest,
  BillingCheckoutSessionResponse,
  BillingPendingCheckout,
  BillingPack,
  BillingState,
} from '../../../shared/billing'

interface BillingStore {
  provider: 'polar' | null
  balanceCredits: number
  packs: BillingPack[]
  pendingCheckouts: BillingPendingCheckout[]
  loading: boolean
  checkoutPending: boolean
  lastSyncedAt: number | null
  loadFromMain: () => Promise<BillingState | null>
  getCheckoutStatus: (checkoutId: string) => Promise<BillingCheckoutStatus>
  setPendingCheckouts: (pendingCheckouts: BillingPendingCheckout[]) => void
  clear: () => void
  setBalanceCredits: (balanceCredits: number | ((current: number) => number)) => void
  createCheckout: (args: BillingCheckoutSessionRequest) => Promise<BillingCheckoutSessionResponse>
}

const EMPTY_STATE = {
  provider: null,
  balanceCredits: 0,
  packs: [] as BillingPack[],
  pendingCheckouts: [] as BillingPendingCheckout[],
  loading: false,
  checkoutPending: false,
  lastSyncedAt: null as number | null,
}

let inFlightBillingLoad: Promise<BillingState | null> | null = null

export const useBillingStore = create<BillingStore>((set) => ({
  ...EMPTY_STATE,

  loadFromMain: async () => {
    if (inFlightBillingLoad) {
      return await inFlightBillingLoad
    }
    set({ loading: true })
    inFlightBillingLoad = (async () => {
      const state = await window.api.invoke<BillingState>(IPC_COMMANDS.BILLING_GET_STATE)
      set({
        provider: state.provider,
        balanceCredits: state.balanceCredits,
        packs: state.packs,
        pendingCheckouts: state.pendingCheckouts,
        loading: false,
        lastSyncedAt: Date.now(),
      })
      return state
    })()
    try {
      return await inFlightBillingLoad
    } catch (error) {
      set({ loading: false })
      throw error
    } finally {
      inFlightBillingLoad = null
    }
  },

  clear: () => set({ ...EMPTY_STATE }),

  setPendingCheckouts: (pendingCheckouts) => set({ pendingCheckouts }),

  setBalanceCredits: (balanceCredits) => set((state) => ({
    balanceCredits: typeof balanceCredits === 'function'
      ? balanceCredits(state.balanceCredits)
      : balanceCredits,
  })),

  getCheckoutStatus: async (checkoutId) => {
    return await window.api.invoke<BillingCheckoutStatus>(
      IPC_COMMANDS.BILLING_GET_CHECKOUT_STATUS,
      checkoutId
    )
  },

  createCheckout: async (args) => {
    set({ checkoutPending: true })
    try {
      return await window.api.invoke<BillingCheckoutSessionResponse>(IPC_COMMANDS.BILLING_CREATE_CHECKOUT, args)
    } finally {
      set({ checkoutPending: false })
    }
  },
}))
