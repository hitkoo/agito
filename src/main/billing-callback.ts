export interface BillingCheckoutCallbackPayload {
  status: 'completed' | 'cancelled'
  query: Record<string, string>
}

export function buildBillingCheckoutRedirectTargets(args: {
  isPackaged: boolean
  protocolScheme: string
}): {
  successUrl: string | null
  cancelUrl: string | null
} {
  if (!args.isPackaged) {
    return {
      successUrl: null,
      cancelUrl: null,
    }
  }

  return {
    successUrl: `${args.protocolScheme}://billing/checkout-complete`,
    cancelUrl: `${args.protocolScheme}://billing/checkout-cancelled`,
  }
}

export class DeepLinkBillingCheckoutCoordinator {
  private pendingResolver: ((payload: BillingCheckoutCallbackPayload) => void) | null = null
  private pendingRejecter: ((error: Error) => void) | null = null

  constructor(private readonly protocolScheme: string) {}

  waitForCheckout(): Promise<BillingCheckoutCallbackPayload> {
    if (this.pendingResolver) {
      throw new Error('Billing checkout callback is already pending')
    }

    return new Promise((resolve, reject) => {
      this.pendingResolver = resolve
      this.pendingRejecter = reject
    })
  }

  handleOpenUrl(rawUrl: string): boolean {
    const parsed = new URL(rawUrl)
    const normalizedProtocol = parsed.protocol.replace(/:$/, '')
    const normalizedPath = parsed.pathname.replace(/\/+$/, '')
    if (normalizedProtocol != this.protocolScheme) return false
    if (parsed.host !== 'billing') return false

    let status: BillingCheckoutCallbackPayload['status'] | null = null
    if (normalizedPath === '/checkout-complete') {
      status = 'completed'
    } else if (normalizedPath === '/checkout-cancelled') {
      status = 'cancelled'
    }
    if (!status) return false

    const query: Record<string, string> = {}
    parsed.searchParams.forEach((value, key) => {
      query[key] = value
    })

    this.pendingResolver?.({ status, query })
    this.pendingResolver = null
    this.pendingRejecter = null
    return true
  }

  rejectPending(error: Error): void {
    this.pendingRejecter?.(error)
    this.pendingResolver = null
    this.pendingRejecter = null
  }
}
