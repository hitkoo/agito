export interface BillingPack {
  id: string
  name: string
  priceUsd: string
  credits: number
  buttonLabel: string
  badge: string | null
  description: string
}

export interface BillingState {
  provider: 'polar'
  balanceCredits: number
  packs: BillingPack[]
  pendingCheckouts: BillingPendingCheckout[]
}

export interface BillingCheckoutSessionRequest {
  packId: string
  successUrl?: string | null
  cancelUrl?: string | null
}

export interface BillingCheckoutSessionResponse {
  provider: 'polar'
  checkoutId: string
  checkoutUrl: string
}

export interface BillingPendingCheckout {
  checkoutId: string
  packId: string
  credits: number
  status: 'open' | 'confirmed' | 'succeeded' | 'failed' | 'expired' | 'timed_out' | string
}

export interface BillingCheckoutStatus {
  checkoutId: string
  status: 'open' | 'confirmed' | 'succeeded' | 'failed' | 'expired' | 'timed_out' | string
  packId: string
  credits: number
  granted: boolean
  balanceCredits: number
}

export interface GenerateBillingMeta {
  creditsCharged: number
  creditsRemaining?: number
  billingErrorCode?: string
}

export function getGenerateCreditCost(): number {
  return 50
}

export function canAffordGenerate(args: { balanceCredits: number }): boolean {
  return args.balanceCredits >= getGenerateCreditCost()
}

export function buildBillingPackPresentation(pack: BillingPack): {
  bonusCredits: number
  standardGenerations: number
} {
  const baselineCredits = Math.round(Number(pack.priceUsd) * 100)
  return {
    bonusCredits: Math.max(0, pack.credits - baselineCredits),
    standardGenerations: Math.floor(pack.credits / 50),
  }
}
