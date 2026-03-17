import { describe, expect, test } from 'bun:test'
import {
  MainAuthService,
  type AuthProviderAdapter,
  type AuthProviderResult,
  type CredentialStore,
} from '../src/main/auth/auth-service'
import type { AuthProvider, AuthUserProfile } from '../src/shared/auth'

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
}

describe('MainAuthService', () => {
  test('restores a persisted session and derives pending_verification from the profile', async () => {
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

    expect(service.getState()).toMatchObject({
      status: 'pending_verification',
      profile: {
        email: 'pending@example.com',
        emailVerified: false,
      },
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

  test('supports sign up without a persisted session and exposes pending_verification', async () => {
    const credentials = new InMemoryCredentialStore()
    const provider = new FakeAuthProvider()

    const service = new MainAuthService({
      credentialStore: credentials,
      provider,
    })

    await service.signUpWithEmail('pending@example.com', 'secret')

    expect(credentials.session).toBeNull()
    expect(service.getState()).toMatchObject({
      status: 'pending_verification',
      profile: {
        email: 'pending@example.com',
        emailVerified: false,
      },
    })
  })
})
