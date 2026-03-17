import { useState } from 'react'
import { toast } from 'sonner'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import type { AuthSessionState } from '../../../shared/auth'
import { useAuthStore } from '../stores/auth-store'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Label } from './ui/label'
import { Input } from './ui/input'

export function AuthDialog(): JSX.Element {
  const dialogMode = useAuthStore((s) => s.dialogMode)
  const closeDialog = useAuthStore((s) => s.closeDialog)
  const setSession = useAuthStore((s) => s.setSession)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const isOpen = dialogMode !== null
  const isSignUp = dialogMode === 'sign_up'

  const resetFields = (): void => {
    setEmail('')
    setPassword('')
  }

  const handleSubmit = async (): Promise<void> => {
    if (!email.trim() || !password.trim()) {
      toast.error('Enter your email and password.')
      return
    }

    setLoading(true)
    try {
      const session = await window.api.invoke<AuthSessionState>(
        isSignUp ? IPC_COMMANDS.AUTH_SIGN_UP_EMAIL : IPC_COMMANDS.AUTH_SIGN_IN_EMAIL,
        {
          email: email.trim(),
          password,
        }
      )
      setSession(session)
      toast.success(
        isSignUp
          ? 'Account created. Check your email to verify it.'
          : 'Signed in'
      )
      resetFields()
      closeDialog()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = async (): Promise<void> => {
    setLoading(true)
    try {
      const session = await window.api.invoke<AuthSessionState>(IPC_COMMANDS.AUTH_SIGN_IN_GOOGLE)
      setSession(session)
      toast.success('Signed in with Google')
      resetFields()
      closeDialog()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Google sign-in failed')
    } finally {
      setLoading(false)
    }
  }

  const handlePasswordReset = async (): Promise<void> => {
    if (!email.trim()) {
      toast.error('Enter your email first.')
      return
    }

    try {
      await window.api.invoke(IPC_COMMANDS.AUTH_SEND_PASSWORD_RESET, {
        email: email.trim(),
      })
      toast.success('Password reset email sent')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to send reset email')
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetFields()
          closeDialog()
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isSignUp ? 'Create account' : 'Sign in to Agito'}</DialogTitle>
          <DialogDescription>
            {isSignUp
              ? 'Create an account to unlock Generate and upcoming billing features.'
              : 'Sign in to use Generate and manage your account from the sidebar.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="auth-email">Email</Label>
            <Input
              id="auth-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="auth-password">Password</Label>
            <Input
              id="auth-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
            />
          </div>

          <div className="grid gap-2">
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? 'Please wait...' : isSignUp ? 'Create account' : 'Sign in'}
            </Button>
            <Button variant="outline" onClick={handleGoogle} disabled={loading}>
              Continue with Google
            </Button>
          </div>

          {!isSignUp && (
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              onClick={handlePasswordReset}
            >
              Forgot password?
            </button>
          )}
        </div>

        <DialogFooter className="justify-between sm:justify-between">
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => {
              resetFields()
              useAuthStore.getState().openDialog(isSignUp ? 'sign_in' : 'sign_up')
            }}
          >
            {isSignUp ? 'Already have an account? Sign in' : 'Need an account? Create one'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
