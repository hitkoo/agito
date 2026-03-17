import { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import type { AuthSessionState, AuthSignUpResult } from '../../../shared/auth'
import { useAuthStore } from '../stores/auth-store'
import googleLogo from '../assets/google.svg'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Label } from './ui/label'
import { Input } from './ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group'

export function AuthDialog(): JSX.Element {
  const dialogMode = useAuthStore((s) => s.dialogMode)
  const closeDialog = useAuthStore((s) => s.closeDialog)
  const setSession = useAuthStore((s) => s.setSession)
  const openDialog = useAuthStore((s) => s.openDialog)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [signupEmailSentTo, setSignupEmailSentTo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0)

  const isOpen = dialogMode !== null
  const isSignUp = dialogMode === 'sign_up'
  const isBlockingConfirmation = signupEmailSentTo !== null

  const resetFields = (): void => {
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setShowPassword(false)
    setShowConfirmPassword(false)
  }

  const resetAll = (): void => {
    resetFields()
    setSignupEmailSentTo(null)
    setResendCooldownSeconds(0)
  }

  useEffect(() => {
    if (resendCooldownSeconds <= 0) return
    const timer = window.setTimeout(() => {
      setResendCooldownSeconds((current) => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [resendCooldownSeconds])

  const closeAndReset = (): void => {
    resetAll()
    closeDialog()
  }

  const switchDialogMode = (mode: 'sign_in' | 'sign_up'): void => {
    resetAll()
    openDialog(mode)
  }

  const handleSubmit = async (): Promise<void> => {
    if (!email.trim() || !password.trim()) {
      toast.error('Enter your email and password.')
      return
    }

    if (isSignUp && !confirmPassword.trim()) {
      toast.error('Confirm your password.')
      return
    }

    if (isSignUp && password !== confirmPassword) {
      toast.error('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      if (isSignUp) {
        const result = await window.api.invoke<AuthSignUpResult>(
          IPC_COMMANDS.AUTH_SIGN_UP_EMAIL,
          {
            email: email.trim(),
            password,
          }
        )
        setSignupEmailSentTo(result.email)
        setPassword('')
        setConfirmPassword('')
        setShowPassword(false)
        setShowConfirmPassword(false)
        return
      }

      const session = await window.api.invoke<AuthSessionState>(IPC_COMMANDS.AUTH_SIGN_IN_EMAIL, {
        email: email.trim(),
        password,
      })
      setSession(session)
      toast.success('Signed in')
      closeAndReset()
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
      closeAndReset()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Google sign-in failed')
    } finally {
      setLoading(false)
    }
  }

  const handlePasswordReset = async (): Promise<void> => {
    const targetEmail = email.trim()
    if (!targetEmail) {
      toast.error('Enter your email first.')
      return
    }

    setLoading(true)
    try {
      await window.api.invoke(IPC_COMMANDS.AUTH_SEND_PASSWORD_RESET, {
        email: targetEmail,
      })
      toast.success('If an account exists for that email, we sent a reset link.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to send password reset email')
    } finally {
      setLoading(false)
    }
  }

  const handleResendVerification = async (): Promise<void> => {
    const targetEmail = signupEmailSentTo ?? email.trim()
    if (!targetEmail) {
      toast.error('Enter your email first.')
      return
    }

    setLoading(true)
    try {
      await window.api.invoke(IPC_COMMANDS.AUTH_RESEND_SIGNUP_VERIFICATION, {
        email: targetEmail,
      })
      setResendCooldownSeconds(30)
      toast.success('If an unverified signup exists, we sent another verification email.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to resend verification email')
    } finally {
      setLoading(false)
    }
  }

  const renderPasswordField = (args: {
    id: string
    label: string
    value: string
    onChange: (value: string) => void
    visible: boolean
    onToggleVisible: () => void
    autoComplete: string
  }): JSX.Element => (
    <div className="space-y-2">
      <Label htmlFor={args.id}>{args.label}</Label>
      <InputGroup>
        <InputGroupInput
          id={args.id}
          type={args.visible ? 'text' : 'password'}
          value={args.value}
          onChange={(event) => args.onChange(event.target.value)}
          placeholder="••••••••"
          autoComplete={args.autoComplete}
          className="pr-3"
        />
        <InputGroupAddon>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
            onClick={args.onToggleVisible}
            aria-label={args.visible ? `Hide ${args.label}` : `Show ${args.label}`}
          >
            {args.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeAndReset()
        }
      }}
    >
      <DialogContent
        className="max-w-md"
        onEscapeKeyDown={(event) => {
          if (isBlockingConfirmation) event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          if (isBlockingConfirmation) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (isBlockingConfirmation) event.preventDefault()
        }}
      >
        {isBlockingConfirmation ? (
          <div className="space-y-5">
            <DialogHeader>
              <DialogTitle>Verification email sent. Verify your email, then sign in.</DialogTitle>
              <DialogDescription className="space-y-2">
                <p>We sent a verification link to {signupEmailSentTo}.</p>
                <p>
                  If the email does not arrive, check your spam folder and make sure you have not
                  already signed up with another sign-in method.
                </p>
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-2">
              <Button variant="outline" onClick={handleGoogle} disabled={loading}>
                <img
                  src={googleLogo}
                  alt=""
                  aria-hidden="true"
                  className="mr-2 h-4 w-4 object-contain"
                />
                {loading ? 'Please wait...' : 'Already used Google? Continue with Google'}
              </Button>
              <Button
                variant="outline"
                onClick={handleResendVerification}
                disabled={loading || resendCooldownSeconds > 0}
              >
                {resendCooldownSeconds > 0
                  ? `Resend verification email (${resendCooldownSeconds}s)`
                  : 'Resend verification email'}
              </Button>
            </div>

            <DialogFooter className="justify-between sm:justify-between">
              <Button variant="ghost" onClick={() => switchDialogMode('sign_in')} disabled={loading}>
                Back to sign in
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{isSignUp ? 'Create account' : 'Sign in to Agito'}</DialogTitle>
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

              {renderPasswordField({
                id: 'auth-password',
                label: 'Password',
                value: password,
                onChange: setPassword,
                visible: showPassword,
                onToggleVisible: () => setShowPassword((current) => !current),
                autoComplete: isSignUp ? 'new-password' : 'current-password',
              })}

              {isSignUp && renderPasswordField({
                id: 'auth-confirm-password',
                label: 'Confirm password',
                value: confirmPassword,
                onChange: setConfirmPassword,
                visible: showConfirmPassword,
                onToggleVisible: () => setShowConfirmPassword((current) => !current),
                autoComplete: 'new-password',
              })}

              <div className="grid gap-2">
                <Button onClick={handleSubmit} disabled={loading}>
                  {loading ? 'Please wait...' : isSignUp ? 'Create account' : 'Sign in'}
                </Button>
                <Button variant="outline" onClick={handleGoogle} disabled={loading}>
                  <img
                    src={googleLogo}
                    alt=""
                    aria-hidden="true"
                    className="mr-2 h-4 w-4 object-contain"
                  />
                  Continue with Google
                </Button>
                {!isSignUp && (
                  <button
                    type="button"
                    className="justify-self-end text-xs text-muted-foreground underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={handlePasswordReset}
                    disabled={loading}
                  >
                    Forgot password?
                  </button>
                )}
              </div>
            </div>

            <DialogFooter className="justify-center sm:justify-center">
              <button
                type="button"
                className="text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => {
                  switchDialogMode(isSignUp ? 'sign_in' : 'sign_up')
                }}
              >
                {isSignUp ? 'Already have an account? Sign in' : 'Need an account? Create one'}
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
