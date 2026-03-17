import type { AuthSessionState, AuthSignUpResult, AuthUserProfile } from '../../shared/auth'
import { deriveAuthStatus } from '../../shared/auth'

export interface CredentialStore<TSession> {
  getSession(): Promise<TSession | null>
  setSession(session: TSession): Promise<void>
  clearSession(): Promise<void>
}

export interface AuthProviderAdapter<TSession> {
  restoreSession(session: TSession): Promise<TSession | null>
  signInWithEmail(email: string, password: string): Promise<AuthProviderResult<TSession>>
  signUpWithEmail(email: string, password: string): Promise<AuthProviderResult<TSession>>
  signInWithGoogle(): Promise<AuthProviderResult<TSession>>
  signOut(): Promise<void>
  sendPasswordReset(email: string): Promise<void>
  resendSignUpVerification(email: string): Promise<void>
}

export interface AuthProviderResult<TSession> {
  session: TSession | null
  profile: AuthUserProfile
}

interface MainAuthServiceOptions<TSession> {
  credentialStore: CredentialStore<TSession>
  provider: AuthProviderAdapter<TSession>
  getProfile?: (session: TSession) => AuthUserProfile
  syncProfile?: (session: TSession) => Promise<AuthUserProfile>
}

const SIGNED_OUT_STATE: AuthSessionState = {
  status: 'signed_out',
  profile: null,
}

export class MainAuthService<TSession extends { profile: AuthUserProfile }> {
  private readonly credentialStore: CredentialStore<TSession>
  private readonly provider: AuthProviderAdapter<TSession>
  private readonly getProfile: (session: TSession) => AuthUserProfile
  private readonly syncProfile?: (session: TSession) => Promise<AuthUserProfile>
  private state: AuthSessionState = SIGNED_OUT_STATE
  private readonly listeners = new Set<(state: AuthSessionState) => void>()

  constructor(options: MainAuthServiceOptions<TSession>) {
    this.credentialStore = options.credentialStore
    this.provider = options.provider
    this.getProfile = options.getProfile ?? ((session) => session.profile)
    this.syncProfile = options.syncProfile
  }

  getState(): AuthSessionState {
    return this.state
  }

  onUpdate(listener: (state: AuthSessionState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async initialize(): Promise<AuthSessionState> {
    const storedSession = await this.credentialStore.getSession()
    if (!storedSession) {
      this.state = SIGNED_OUT_STATE
      this.emit()
      return this.state
    }

    const restoredSession = await this.provider.restoreSession(storedSession)
    if (!restoredSession) {
      await this.credentialStore.clearSession()
      this.state = SIGNED_OUT_STATE
      this.emit()
      return this.state
    }

    const syncedSession = await this.syncProfileIfAvailable(restoredSession)
    return this.adoptSessionResult({
      session: syncedSession,
      profile: this.getProfile(syncedSession),
    })
  }

  async signInWithEmail(email: string, password: string): Promise<AuthSessionState> {
    const result = await this.provider.signInWithEmail(email, password)
    if (result.session) {
      const syncedSession = await this.syncProfileIfAvailable(result.session)
      result.session = syncedSession
      result.profile = this.getProfile(syncedSession)
    }

    const state = await this.adoptSessionResult(result)
    if (!state.profile && !result.profile.emailVerified) {
      throw new Error('Verify your email before signing in.')
    }
    return state
  }

  async signUpWithEmail(email: string, password: string): Promise<AuthSignUpResult> {
    await this.provider.signUpWithEmail(email, password)
    await this.provider.signOut().catch(() => undefined)
    await this.credentialStore.clearSession()
    this.state = SIGNED_OUT_STATE
    this.emit()
    return {
      status: 'verification_sent',
      email,
    }
  }

  async signInWithGoogle(): Promise<AuthSessionState> {
    const result = await this.provider.signInWithGoogle()
    if (result.session) {
      const syncedSession = await this.syncProfileIfAvailable(result.session)
      result.session = syncedSession
      result.profile = this.getProfile(syncedSession)
    }
    return this.adoptSessionResult(result)
  }

  async signOut(): Promise<AuthSessionState> {
    await this.provider.signOut()
    await this.credentialStore.clearSession()
    this.state = SIGNED_OUT_STATE
    this.emit()
    return this.state
  }

  async sendPasswordReset(email: string): Promise<void> {
    await this.provider.sendPasswordReset(email)
  }

  async resendSignUpVerification(email: string): Promise<void> {
    await this.provider.resendSignUpVerification(email)
  }

  private buildState(profile: AuthUserProfile, hasSession: boolean): AuthSessionState {
    return {
      status: deriveAuthStatus({
        hasIdentity: true,
        hasSession,
        emailVerified: profile.emailVerified,
      }),
      profile,
    }
  }

  private async adoptSessionResult(result: AuthProviderResult<TSession>): Promise<AuthSessionState> {
    if (!result.session || !result.profile.emailVerified) {
      await this.provider.signOut().catch(() => undefined)
      await this.credentialStore.clearSession()
      this.state = SIGNED_OUT_STATE
      this.emit()
      return this.state
    }

    await this.credentialStore.setSession(result.session)
    this.state = this.buildState(result.profile, true)
    this.emit()
    return this.state
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state)
    }
  }

  private async syncProfileIfAvailable(session: TSession): Promise<TSession> {
    if (!this.syncProfile) return session
    try {
      const profile = await this.syncProfile(session)
      return {
        ...session,
        profile,
      }
    } catch {
      return session
    }
  }
}
