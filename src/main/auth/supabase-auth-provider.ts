import { shell } from 'electron'
import {
  createClient,
  type Session,
  type SupportedStorage,
  type User,
} from '@supabase/supabase-js'
import type { AuthProvider, AuthUserProfile } from '../../shared/auth'
import type { AuthProviderAdapter, AuthProviderResult } from './auth-service'
import { createCallbackServer } from './callback-server'
import type { StoredAuthSession } from './credential-store'

interface SupabaseAuthProviderOptions {
  supabaseUrl: string
  supabaseAnonKey: string
  resetPasswordRedirectUrl?: string
}

function createEphemeralStorage(): SupportedStorage {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
  }
}

function resolveProvider(user: User): AuthProvider {
  const rawProvider = user.app_metadata?.provider ?? user.identities?.[0]?.provider
  return rawProvider === 'google' ? 'google' : 'email'
}

function toProfile(user: User): AuthUserProfile {
  const provider = resolveProvider(user)
  const metadata = user.user_metadata ?? {}
  return {
    id: user.id,
    email: user.email ?? '',
    displayName:
      typeof metadata.display_name === 'string'
        ? metadata.display_name
        : typeof metadata.full_name === 'string'
          ? metadata.full_name
          : typeof metadata.name === 'string'
            ? metadata.name
            : null,
    avatarUrl:
      typeof metadata.avatar_url === 'string'
        ? metadata.avatar_url
        : typeof metadata.picture === 'string'
          ? metadata.picture
          : null,
    provider,
    emailVerified: Boolean(user.email_confirmed_at ?? user.confirmed_at),
  }
}

function toStoredSession(session: Session): StoredAuthSession {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ? session.expires_at * 1000 : null,
    profile: toProfile(session.user),
  }
}

function toResult(session: Session | null, user: User | null): AuthProviderResult<StoredAuthSession> {
  const profile = user
    ? toProfile(user)
    : session
      ? toProfile(session.user)
      : {
          id: '',
          email: '',
          displayName: null,
          avatarUrl: null,
          provider: 'email' as const,
          emailVerified: false,
        }

  return {
    session: session ? toStoredSession(session) : null,
    profile,
  }
}

export class SupabaseAuthProvider implements AuthProviderAdapter<StoredAuthSession> {
  private readonly client
  private readonly resetPasswordRedirectUrl?: string

  constructor(options: SupabaseAuthProviderOptions) {
    this.client = createClient(options.supabaseUrl, options.supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        flowType: 'pkce',
        storage: createEphemeralStorage(),
      },
    })
    this.resetPasswordRedirectUrl = options.resetPasswordRedirectUrl
  }

  async restoreSession(session: StoredAuthSession): Promise<StoredAuthSession | null> {
    const { data, error } = await this.client.auth.setSession({
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
    })
    if (error || !data.session) return null
    return toStoredSession(data.session)
  }

  async signInWithEmail(email: string, password: string): Promise<AuthProviderResult<StoredAuthSession>> {
    const { data, error } = await this.client.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw error
    return toResult(data.session, data.user)
  }

  async signUpWithEmail(email: string, password: string): Promise<AuthProviderResult<StoredAuthSession>> {
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
    })
    if (error) throw error
    return toResult(data.session, data.user)
  }

  async signInWithGoogle(): Promise<AuthProviderResult<StoredAuthSession>> {
    const callbackServer = await createCallbackServer()

    try {
      const { data, error } = await this.client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${callbackServer.url}/callback`,
          skipBrowserRedirect: true,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      })

      if (error) throw error
      if (!data.url) throw new Error('Google OAuth URL was not returned by Supabase')

      await shell.openExternal(data.url)
      const payload = await callbackServer.promise

      if (payload.query.error) {
        throw new Error(payload.query.error_description ?? payload.query.error)
      }
      if (!payload.query.code) {
        throw new Error('Missing Google OAuth code')
      }

      const { data: exchangeData, error: exchangeError } = await this.client.auth.exchangeCodeForSession(
        payload.query.code
      )
      if (exchangeError) throw exchangeError

      return toResult(exchangeData.session, exchangeData.user)
    } finally {
      callbackServer.close()
    }
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut()
    if (error) throw error
  }

  async sendPasswordReset(email: string): Promise<void> {
    const { error } = await this.client.auth.resetPasswordForEmail(email, this.resetPasswordRedirectUrl
      ? { redirectTo: this.resetPasswordRedirectUrl }
      : undefined)
    if (error) throw error
  }
}
