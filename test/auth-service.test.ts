import { describe, expect, test } from 'bun:test'
import {
  MainAuthService,
  type AuthProviderAdapter,
  type AuthProviderResult,
  type CredentialStore,
} from '../src/main/auth/auth-service'
import type { AuthProvider, AuthSignUpResult, AuthUserProfile } from '../src/shared/auth'

interface FakeStoredSession {
  accessToken: string
  refreshToken: string
  provider: AuthProvider
  profile: AuthUserProfile
}

class InMemoryCredentialStore implements CredentialStore<FakeStoredSession> {
  session: FakeStoredSession | null = null

  async getSession(): Promise<FakeStoredSession | null> {
    return this.session
  }

  async setSession(session: FakeStoredSession): Promise<void> {
    this.session = session
  }

  async clearSession(): Promise<void> {
    this.session = null
  }
}

class FakeAuthProvider implements AuthProviderAdapter<FakeStoredSession> {
  restoreResult: FakeStoredSession | null = null
  signInResult: FakeStoredSession | null = null
  signUpResult: AuthProviderResult<FakeStoredSession> | null = null
  signInWithGoogleResult: AuthProviderResult<FakeStoredSession> | null = null
  passwordResetEmail: string | null = null
  resendVerificationEmail: string | null = null
  signOutCount = 0

  async restoreSession(session: FakeStoredSession): Promise<FakeStoredSession | null> {
    return this.restoreResult ?? session
  }

  async signInWithEmail(email: string, _password: string): Promise<AuthProviderResult<FakeStoredSession>> {
    if (!this.signInResult) {
      throw new Error('missing fake sign-in result')
    }

    return {
      session: {
        ...this.signInResult,
        profile: {
          ...this.signInResult.profile,
          email,
        },
      },
      profile: {
        ...this.signInResult.profile,
        email,
      },
    }
  }

  async signUpWithEmail(email: string, _password: string): Promise<AuthProviderResult<FakeStoredSession>> {
    return this.signUpResult ?? {
      session: null,
      profile: {
        id: 'user-signup',
        email,
        displayName: null,
        avatarUrl: null,
        provider: 'email',
        emailVerified: false,
      },
    }
  }

  async signInWithGoogle(): Promise<AuthProviderResult<FakeStoredSession>> {
    if (!this.signInWithGoogleResult) {
      throw new Error('missing fake google sign-in result')
    }

    return this.signInWithGoogleResult
  }

  async signOut(): Promise<void> {
    this.signOutCount += 1
  }

  async sendPasswordReset(email: string): Promise<void> {
    this.passwordResetEmail = email
  }

  async resendSignUpVerification(email: string): Promise<void> {
    this.resendVerificationEmail = email
  }
}

async function syncProfile(session: FakeStoredSession): Promise<AuthUserProfile> {
  return {
    ...session.profile,
    displayName: `${session.profile.displayName ?? 'Synced'} (server)`,
  }
}

describe('MainAuthService', () => {
  test('clears an unverified persisted session during restore and stays signed_out', async () => {
    const credentials = new InMemoryCredentialStore()
    const provider = new FakeAuthProvider()

    credentials.session = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      provider: 'email',
      profile: {
        id: 'user-1',
        email: 'pending@example.com',
        displayName: null,
        avatarUrl: null,
        provider: 'email',
        emailVerified: false,
      },
    }

    const service = new MainAuthService({
      credentialStore: credentials,
      provider,
    })

    await service.initialize()

    expect(provider.signOutCount).toBe(1)
    expect(credentials.session).toBeNull()
    expect(service.getState()).toEqual({
      status: 'signed_out',
      profile: null,
    })
  })

  test('persists the session returned by email sign-in and exposes a signed_in state', async () => {
    const credentials = new InMemoryCredentialStore()
    const provider = new FakeAuthProvider()
    provider.signInResult = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      provider: 'email',
      profile: {
        id: 'user-2',
        email: 'signed-in@example.com',
        displayName: 'Signed In',
        avatarUrl: null,
        provider: 'email',
        emailVerified: true,
      },
    }

    const service = new MainAuthService({
      credentialStore: credentials,
      provider,
    })

    await service.signInWithEmail('signed-in@example.com', 'secret')

    expect(credentials.session).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    })
    expect(service.getState()).toMatchObject({
      status: 'signed_in',
      profile: {
        email: 'signed-in@example.com',
        displayName: 'Signed In',
      },
    })
  })

  test('rejects unverified email sign-in and clears the local session state', async () => {
    const credentials = new InMemoryCredentialStore()
    const provider = new FakeAuthProvider()
    provider.signInResult = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      provider: 'email',
      profile: {
        id: 'user-unverified',
        email: 'pending@example.com',
        displayName: null,
        avatarUrl: null,
        provider: 'email',
        emailVerified: false,
      },
    }

    const service = new MainAuthService({
      credentialStore: credentials,
      provider,
    })

    await expect(service.signInWithEmail('pending@example.com', 'secret')).rejects.toThrow(
      'Verify your email before signing in.'
    )
    expect(provider.signOutCount).toBe(1)
    expect(credentials.session).toBeNull()
    expect(service.getState()).toEqual({
      status: 'signed_out',
      profile: null,
    })
  })

  test('clears the persisted session on sign out', async () => {
    const credentials = new InMemoryCredentialStore()
    const provider = new FakeAuthProvider()
    credentials.session = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      provider: 'email',
      profile: {
        id: 'user-3',
        email: 'signed-in@example.com',
        displayName: 'Signed In',
        avatarUrl: null,
        provider: 'email',
        emailVerified: true,
      },
    }

    const service = new MainAuthService({
      credentialStore: credentials,
      provider,
    })

    await service.initialize()
    await service.signOut()

    expect(provider.signOutCount).toBe(1)
    expect(credentials.session).toBeNull()
    expect(service.getState()).toEqual({
      status: 'signed_out',
      profile: null,
    })
  })

  test('returns a verification_sent result and keeps auth state signed_out after sign up', async () => {
    const credentials = new InMemoryCredentialStore()
    const provider = new FakeAuthProvider()

    const service = new MainAuthService({
      credentialStore: credentials,
      provider,
    })

    const result = await service.signUpWithEmail('pending@example.com', 'secret')

    expect(result).toEqual<AuthSignUpResult>({
      status: 'verification_sent',
      email: 'pending@example.com',
    })
    expect(credentials.session).toBeNull()
    expect(provider.signOutCount).toBe(1)
    expect(service.getState()).toEqual({
      status: 'signed_out',
      profile: null,
    })
  })

  test('resends signup verification emails through the provider', async () => {
    const credentials = new InMemoryCredentialStore()
    const provider = new FakeAuthProvider()

    const service = new MainAuthService({
      credentialStore: credentials,
      provider,
    })

    await service.resendSignUpVerification('pending@example.com')

    expect(provider.resendVerificationEmail).toBe('pending@example.com')
  })

  test('syncs the authenticated profile through the server when a session exists', async () => {
    const credentials = new InMemoryCredentialStore()
    const provider = new FakeAuthProvider()
    provider.signInResult = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      provider: 'email',
      profile: {
        id: 'user-4',
        email: 'synced@example.com',
        displayName: 'Local Name',
        avatarUrl: null,
        provider: 'email',
        emailVerified: true,
      },
    }

    const service = new MainAuthService({
      credentialStore: credentials,
      provider,
      syncProfile,
    })

    await service.signInWithEmail('synced@example.com', 'secret')

    expect(credentials.session?.profile.displayName).toBe('Local Name (server)')
    expect(service.getState()).toMatchObject({
      status: 'signed_in',
      profile: {
        displayName: 'Local Name (server)',
      },
    })
  })
})
