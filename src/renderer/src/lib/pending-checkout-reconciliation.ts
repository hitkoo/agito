import type { BillingCheckoutStatus, BillingPendingCheckout } from '../../../shared/billing'

export interface PendingCheckoutNotification {
  checkoutId: string
  kind: 'success' | 'failure'
  credits: number
}

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'expired', 'timed_out'])
const FAILURE_STATUSES = new Set(['failed', 'expired', 'timed_out'])

export function getPendingCheckoutPollTargets(
  currentPending: BillingPendingCheckout[],
  inFlightCheckoutIds: Set<string>
): BillingPendingCheckout[] {
  return currentPending.filter((pending) => !inFlightCheckoutIds.has(pending.checkoutId))
}

export function reconcilePendingCheckoutStatuses(args: {
  currentPending: BillingPendingCheckout[]
  statuses: BillingCheckoutStatus[]
  notifiedTerminalCheckoutIds: Set<string>
}): {
  nextPending: BillingPendingCheckout[]
  notifications: PendingCheckoutNotification[]
  shouldRefreshBilling: boolean
  resolvedCheckoutIds: string[]
} {
  const statusByCheckoutId = new Map(args.statuses.map((status) => [status.checkoutId, status]))
  const nextPending: BillingPendingCheckout[] = []
  const notifications: PendingCheckoutNotification[] = []
  const resolvedCheckoutIds: string[] = []
  let shouldRefreshBilling = false

  for (const pending of args.currentPending) {
    const status = statusByCheckoutId.get(pending.checkoutId)
    if (!status) {
      nextPending.push(pending)
      continue
    }

    if (TERMINAL_STATUSES.has(status.status)) {
      shouldRefreshBilling = true
      resolvedCheckoutIds.push(status.checkoutId)
      if (!args.notifiedTerminalCheckoutIds.has(status.checkoutId)) {
        notifications.push({
          checkoutId: status.checkoutId,
          kind: FAILURE_STATUSES.has(status.status) ? 'failure' : 'success',
          credits: status.credits,
        })
      }
      continue
    }

    nextPending.push({
      checkoutId: status.checkoutId,
      packId: status.packId,
      credits: status.credits,
      status: status.status,
    })
  }

  return {
    nextPending,
    notifications,
    shouldRefreshBilling,
    resolvedCheckoutIds,
  }
}
