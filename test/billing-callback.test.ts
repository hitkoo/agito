import { describe, expect, test } from 'bun:test'
import {
  DeepLinkBillingCheckoutCoordinator,
  buildBillingCheckoutRedirectTargets,
} from '../src/main/billing-callback'

describe('buildBillingCheckoutRedirectTargets', () => {
  test('uses app deep links when packaged', () => {
    expect(
      buildBillingCheckoutRedirectTargets({
        isPackaged: true,
        protocolScheme: 'agito',
      })
    ).toEqual({
      successUrl: 'agito://billing/checkout-complete',
      cancelUrl: 'agito://billing/checkout-cancelled',
    })
  })

  test('omits redirect targets during development', () => {
    expect(
      buildBillingCheckoutRedirectTargets({
        isPackaged: false,
        protocolScheme: 'agito',
      })
    ).toEqual({
      successUrl: null,
      cancelUrl: null,
    })
  })
})

describe('DeepLinkBillingCheckoutCoordinator', () => {
  test('resolves purchase completion deep links', async () => {
    const coordinator = new DeepLinkBillingCheckoutCoordinator('agito')
    const pending = coordinator.waitForCheckout()

    expect(
      coordinator.handleOpenUrl('agito://billing/checkout-complete?checkout_id=chk_123')
    ).toBe(true)

    await expect(pending).resolves.toEqual({
      status: 'completed',
      query: {
        checkout_id: 'chk_123',
      },
    })
  })

  test('resolves purchase cancellation deep links', async () => {
    const coordinator = new DeepLinkBillingCheckoutCoordinator('agito')
    const pending = coordinator.waitForCheckout()

    expect(
      coordinator.handleOpenUrl('agito://billing/checkout-cancelled?checkout_id=chk_123')
    ).toBe(true)

    await expect(pending).resolves.toEqual({
      status: 'cancelled',
      query: {
        checkout_id: 'chk_123',
      },
    })
  })
})
