import { Mail, LogOut, RefreshCcw } from 'lucide-react'
import { Button } from './ui/button'
import { getAccountDisplayName, type AuthSessionState } from '../../../shared/auth'
import { GitoTokenIcon } from './GitoTokenIcon'

interface AccountPopoverProps {
  session: AuthSessionState
  balanceCredits: number
  onSignIn: () => void
  onSignUp: () => void
  onBuyCredits: () => void
  onRefreshCredits: () => void
  onSignOut: () => void
  refreshingCredits?: boolean
}

function getInitials(name: string): string {
  return name.slice(0, 1).toUpperCase()
}

export function AccountPopover(props: AccountPopoverProps): JSX.Element {
  const { session, balanceCredits, onSignIn, onSignUp, onBuyCredits, onRefreshCredits, onSignOut, refreshingCredits = false } = props
  const profile = session.profile

  if (!profile) {
    return (
      <div className="w-[280px] rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
            A
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Sign in to Agito</p>
            <p className="text-xs text-muted-foreground">Generate requires an account</p>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <Button className="flex-1" onClick={onSignIn}>
            Sign in
          </Button>
          <Button className="flex-1" variant="outline" onClick={onSignUp}>
            Create account
          </Button>
        </div>
      </div>
    )
  }

  const displayName = getAccountDisplayName({
    displayName: profile.displayName,
    email: profile.email,
  })

  return (
    <div className="w-[300px] rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur">
      <div className="flex items-center gap-3">
        {profile.avatarUrl ? (
          <img
            src={profile.avatarUrl}
            alt={displayName}
            className="h-12 w-12 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
            {getInitials(displayName)}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{displayName}</p>
          <p className="truncate text-xs text-muted-foreground">{profile.email}</p>
        </div>
      </div>

      <div className="mt-4 space-y-2 rounded-lg border border-border/80 bg-muted/30 p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Mail className="h-3.5 w-3.5" />
          <span>{profile.provider === 'google' ? 'Signed in with Google' : 'Email login'}</span>
        </div>
        <div className="flex items-center justify-between rounded-md bg-background/70 px-2.5 py-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <GitoTokenIcon size={14} className="h-3.5 w-3.5" />
            <span>Credits</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-sm font-semibold">{balanceCredits.toLocaleString()}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onRefreshCredits}
              disabled={refreshingCredits}
              title="Refresh balance"
            >
              <RefreshCcw className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>

      <Button className="mt-4 w-full" onClick={onBuyCredits}>
        Buy credits
      </Button>
      <Button className="mt-2 w-full" variant="outline" onClick={onSignOut}>
        <LogOut className="mr-2 h-4 w-4" />
        Log out
      </Button>
    </div>
  )
}
