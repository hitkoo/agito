import { RefreshCcw } from 'lucide-react'
import { toast } from 'sonner'
import { buildBillingPackPresentation } from '../../../shared/billing'
import { Button } from './ui/button'
import { GitoTokenIcon } from './GitoTokenIcon'
import { useBillingStore } from '../stores/billing-store'
import { useUIStore } from '../stores/ui-store'

function formatPrice(priceUsd: string): string {
  const value = Number(priceUsd)
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`
}

export function BuyCreditsPanel(): JSX.Element {
  const balanceCredits = useBillingStore((s) => s.balanceCredits)
  const packs = useBillingStore((s) => s.packs)
  const loading = useBillingStore((s) => s.loading)
  const checkoutPending = useBillingStore((s) => s.checkoutPending)
  const loadBilling = useBillingStore((s) => s.loadFromMain)
  const createCheckout = useBillingStore((s) => s.createCheckout)
  const openGenerateHome = useUIStore((s) => s.openGenerateHome)

  const handleRefresh = async (): Promise<void> => {
    try {
      await loadBilling()
      toast.success('Balance refreshed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to refresh credits')
    }
  }

  const handleCheckout = async (packId: string): Promise<void> => {
    try {
      await createCheckout({ packId })
      toast.success('Checkout opened in your browser')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to start checkout')
    }
  }

  return (
    <div className="absolute inset-0 z-10 flex bg-background">
      <div className="w-full overflow-y-auto styled-scroll">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-8 py-8">
          <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-border bg-muted/20 p-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/80 px-3 py-1 text-xs text-muted-foreground">
                <GitoTokenIcon size={14} className="h-3.5 w-3.5" />
                <span>Buy Credits</span>
              </div>
              <div>
                <h2 className="text-2xl font-semibold">Buy Credits</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Use credits for image generation in Agito.
                </p>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>One-time purchase. Credits never expire.</p>
                <p>Taxes may apply at checkout depending on your location.</p>
              </div>
            </div>

            <div className="min-w-[220px] rounded-xl border border-border bg-background/80 p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                <GitoTokenIcon size={14} className="h-3.5 w-3.5" />
                <span>Current Balance</span>
              </div>
              <div className="mt-3 text-3xl font-semibold">{balanceCredits.toLocaleString()}</div>
              <div className="mt-1 text-sm text-muted-foreground">credits available</div>
              <div className="mt-4 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => openGenerateHome()}>
                  Back to Generate
                </Button>
                <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={loading}>
                  <RefreshCcw className="mr-2 h-3.5 w-3.5" />
                  Refresh
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {packs.map((pack) => {
              const presentation = buildBillingPackPresentation(pack)
              return (
                <div
                  key={pack.id}
                  className="flex min-h-[320px] flex-col rounded-2xl border border-border bg-background/70 p-5 shadow-sm"
                >
                  <div className="min-h-[28px]">
                    {pack.badge ? (
                      <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                        {pack.badge}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/40">
                        <GitoTokenIcon size={28} className="h-7 w-7" />
                      </div>
                      <h3 className="text-xl font-semibold">{pack.name}</h3>
                    </div>
                    <p className="text-3xl font-semibold">{formatPrice(pack.priceUsd)}</p>
                  </div>

                  <div className="mt-5 space-y-2 text-sm text-muted-foreground">
                    <p>{presentation.standardGenerations} standard generations</p>
                    {presentation.bonusCredits > 0 ? (
                      <p>Includes {presentation.bonusCredits.toLocaleString()} bonus credits</p>
                    ) : null}
                  </div>

                  <Button
                    className="mt-auto w-full"
                    onClick={() => void handleCheckout(pack.id)}
                    disabled={checkoutPending}
                  >
                    {pack.buttonLabel}
                  </Button>
                </div>
              )
            })}
          </div>

          {packs.length === 0 && (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
              Billing packs are not configured yet.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
