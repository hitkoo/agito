import { useEffect, useRef, useState } from 'react'
import { UserCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import { getAccountDisplayName } from '../../../shared/auth'
import { useAuthStore } from '../stores/auth-store'
import { useBillingStore } from '../stores/billing-store'
import { useUIStore } from '../stores/ui-store'
import { cn } from '../lib/utils'
import { AccountPopover } from './AccountPopover'

interface SidebarAccountEntryProps {
  expanded: boolean
}

export function SidebarAccountEntry(props: SidebarAccountEntryProps): JSX.Element {
  const { expanded } = props
  const session = useAuthStore((s) => s.session)
  const openDialog = useAuthStore((s) => s.openDialog)
  const balanceCredits = useBillingStore((s) => s.balanceCredits)
  const billingLoading = useBillingStore((s) => s.loading)
  const loadBilling = useBillingStore((s) => s.loadFromMain)
  const openBuyCredits = useUIStore((s) => s.openBuyCredits)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const profile = session.profile
  const displayName = profile
    ? getAccountDisplayName({
        displayName: profile.displayName,
        email: profile.email,
      })
    : 'Sign in'
  const secondaryText = profile
    ? profile.email
    : 'Generate requires account'

  const handleSignOut = async (): Promise<void> => {
    try {
      await window.api.invoke(IPC_COMMANDS.AUTH_SIGN_OUT)
      setOpen(false)
      toast.success('Signed out')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to sign out')
    }
  }

  const handleRefreshCredits = async (): Promise<void> => {
    try {
      await loadBilling()
      toast.success('Balance refreshed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to refresh balance')
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent',
          !expanded && 'justify-center px-0'
        )}
        title={profile ? profile.email : 'Sign in'}
        onClick={() => setOpen((current) => !current)}
      >
        {profile?.avatarUrl ? (
          <img
            src={profile.avatarUrl}
            alt={displayName}
            className="h-8 w-8 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <UserCircle2 className="h-4 w-4" />
          </div>
        )}

        {expanded && (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{displayName}</p>
            <p className="truncate text-[11px] text-muted-foreground">{secondaryText}</p>
          </div>
        )}
      </button>

      {open && (
        <div className="absolute bottom-0 left-full z-30 ml-2">
          <AccountPopover
            session={session}
            onSignIn={() => {
              setOpen(false)
              openDialog('sign_in')
            }}
            onSignUp={() => {
              setOpen(false)
              openDialog('sign_up')
            }}
            balanceCredits={balanceCredits}
            onBuyCredits={() => {
              setOpen(false)
              openBuyCredits()
            }}
            onRefreshCredits={() => {
              void handleRefreshCredits()
            }}
            onSignOut={handleSignOut}
            refreshingCredits={billingLoading}
          />
        </div>
      )}
    </div>
  )
}
