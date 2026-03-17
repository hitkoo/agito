export type AuthStatus = 'signed_out' | 'signed_in'

export type AuthProvider = 'email' | 'google'

export interface AuthUserProfile {
  id: string
  email: string
  displayName: string | null
  avatarUrl: string | null
  provider: AuthProvider
  emailVerified: boolean
}

export interface AuthSessionState {
  status: AuthStatus
  profile: AuthUserProfile | null
}

export interface AuthSignUpResult {
  status: 'verification_sent'
  email: string
}

export function deriveAuthStatus(args: {
  hasIdentity: boolean
  hasSession: boolean
  emailVerified: boolean
}): AuthStatus {
  if (!args.hasIdentity || !args.hasSession || !args.emailVerified) return 'signed_out'
  return 'signed_in'
}

export function canAccessGenerate(status: AuthStatus): boolean {
  return status === 'signed_in'
}

export function getAccountDisplayName(args: {
  displayName: string | null
  email: string
}): string {
  const trimmed = args.displayName?.trim()
  if (trimmed) return trimmed
  return args.email.split('@')[0] ?? args.email
}
