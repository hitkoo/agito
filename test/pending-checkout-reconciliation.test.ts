import { describe, expect, test } from 'bun:test'
import type { BillingCheckoutStatus, BillingPendingCheckout } from '../src/shared/billing'
import {
  getPendingCheckoutPollTargets,
  reconcilePendingCheckoutStatuses,
} from '../src/renderer/src/lib/pending-checkout-reconciliation'

const PENDING: BillingPendingCheckout[] = [
  { checkoutId: 'chk_1', packId: 'standard', credits: 1000, status: 'open' },
  { checkoutId: 'chk_2', packId: 'power', credits: 6000, status: 'confirmed' },
  { checkoutId: 'chk_3', packId: 'starter', credits: 450, status: 'processing' },
]

describe('getPendingCheckoutPollTargets', () => {
  test('skips checkouts already being polled', () => {
    expect(
      getPendingCheckoutPollTargets(PENDING, new Set(['chk_2']))
    ).toEqual([
      PENDING[0],
      PENDING[2],
    ])
  })
})

describe('reconcilePendingCheckoutStatuses', () => {
  test('removes terminal checkouts, keeps active ones, and emits one-shot notifications', () => {
    const statuses: BillingCheckoutStatus[] = [
      {
        checkoutId: 'chk_1',
        packId: 'standard',
        credits: 1000,
        status: 'succeeded',
        granted: true,
        balanceCredits: 1000,
      },
      {
        checkoutId: 'chk_2',
        packId: 'power',
        credits: 6000,
        status: 'failed',
        granted: false,
        balanceCredits: 0,
      },
      {
        checkoutId: 'chk_3',
        packId: 'starter',
        credits: 450,
        status: 'processing',
        granted: false,
        balanceCredits: 0,
      },
    ]

    expect(
      reconcilePendingCheckoutStatuses({
        currentPending: PENDING,
        statuses,
        notifiedTerminalCheckoutIds: new Set(),
      })
    ).toEqual({
      nextPending: [{ checkoutId: 'chk_3', packId: 'starter', credits: 450, status: 'processing' }],
      notifications: [
        { checkoutId: 'chk_1', kind: 'success', credits: 1000 },
        { checkoutId: 'chk_2', kind: 'failure', credits: 6000 },
      ],
      shouldRefreshBilling: true,
      resolvedCheckoutIds: ['chk_1', 'chk_2'],
    })
  })

  test('does not re-emit notifications for terminal checkouts that were already handled', () => {
    const statuses: BillingCheckoutStatus[] = [
      {
        checkoutId: 'chk_1',
        packId: 'standard',
        credits: 1000,
        status: 'succeeded',
        granted: true,
        balanceCredits: 1000,
      },
    ]

    expect(
      reconcilePendingCheckoutStatuses({
        currentPending: [PENDING[0]],
        statuses,
        notifiedTerminalCheckoutIds: new Set(['chk_1']),
      })
    ).toEqual({
      nextPending: [],
      notifications: [],
      shouldRefreshBilling: true,
      resolvedCheckoutIds: ['chk_1'],
    })
  })
})
