import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { useBillingStore } from '../src/renderer/src/stores/billing-store'
import { IPC_COMMANDS } from '../src/shared/ipc-channels'
import type { BillingState } from '../src/shared/billing'

const BILLING_STATE: BillingState = {
  provider: 'polar',
  balanceCredits: 500,
  packs: [],
  pendingCheckouts: [],
}

describe('billing store', () => {
  const invoke = mock(async <T>(command: string): Promise<T> => {
    if (command !== IPC_COMMANDS.BILLING_GET_STATE) {
      throw new Error(`Unexpected command: ${command}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
    return BILLING_STATE as T
  })

  beforeEach(() => {
    ;(globalThis as typeof globalThis & {
      window: { api: { invoke: typeof invoke } }
    }).window = { api: { invoke } }
    invoke.mockClear()
    useBillingStore.setState({
      provider: null,
      balanceCredits: 0,
      packs: [],
      pendingCheckouts: [],
      loading: false,
      checkoutPending: false,
      lastSyncedAt: null,
    })
  })

  afterEach(() => {
    invoke.mockClear()
  })

  test('deduplicates concurrent billing state loads', async () => {
    const [first, second] = await Promise.all([
      useBillingStore.getState().loadFromMain(),
      useBillingStore.getState().loadFromMain(),
    ])

    expect(first).toEqual(BILLING_STATE)
    expect(second).toEqual(BILLING_STATE)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(useBillingStore.getState().balanceCredits).toBe(500)
  })
})
