import { ipcMain, BrowserWindow, dialog, app, shell } from 'electron'
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, copyFileSync, statSync } from 'fs'
import initSqlJs from 'sql.js'
import { join, basename, extname } from 'path'
import { homedir } from 'os'
import { IPC_COMMANDS, IPC_EVENTS } from '../shared/ipc-channels'
import type {
  Character,
  EngineType,
  RoomLayout,
  SessionMapping,
  AgitoSettings,
  AssetGenerateRequest,
  AssetCategory,
  GenerateJob,
  GenerateJobPreviewUrls,
  GenerateJobResultItem,
  SaveGeneratedResultResponse,
  ScannedSession,
} from '../shared/types'
import { upsertSessionMappingOnResume } from '../shared/session-resume'
import { canAccessGenerate, type AuthSessionState } from '../shared/auth'
import type { BillingCheckoutSessionRequest, BillingCheckoutSessionResponse, BillingState } from '../shared/billing'
import { hasSupabasePublicConfig, publicConfig } from '../shared/public-config'
import type { AgitoStore } from './store'
import { TerminalSessionService } from './terminal-session-service'
import { GRID_COLS, GRID_ROWS, FOOTPRINTS, MAX_SESSION_HISTORY, ASSETS_DIR } from '../shared/constants'
import type { EngineAdapter } from './engine/types'
import { claudeCodeAdapter } from './engine/claude-code'
import { codexAdapter } from './engine/codex'
import { getEnginePermissionSkipArgs } from './engine/permission-flags'
import { CharacterRuntimeService } from './character-runtime-service'
import { MainAuthService, type AuthProviderAdapter, type AuthProviderResult } from './auth/auth-service'
import { createCredentialStore, type StoredAuthSession } from './auth/credential-store'
import { SupabaseAuthProvider } from './auth/supabase-auth-provider'
import type { DeepLinkOAuthCallbackCoordinator } from './auth/oauth-callback'
import { buildBillingCheckoutRedirectTargets, type DeepLinkBillingCheckoutCoordinator } from './billing-callback'
import {
  buildGeneratedJobPreviewUrlsRequest,
} from './generated-preview'
import { mapGeneratedJob, type GeneratedJobApiPayload } from './generated-job'
import { createGeneratedJobListLoader } from './generated-job-list'
import { buildGeneratedResultDownloadRequest } from './generated-result-save'
import { ApiRequestError, normalizeApiError } from './http-error'
import {
  type CodexSessionIndexEntry,
  extractClaudeSessionLabelsFromHistory,
  extractClaudeSessionMetadata,
  extractCodexSessionIndexEntries,
  getPreferredClaudeSessionLabel,
  mergeCodexScannedSessions,
  scanCodexSessionFiles,
} from './session-scan'
import {
  createUuidV7,
  findClaudeSessionArtifactPath,
  findCodexSessionArtifactPath,
  parseLastSessionIdFromStatusOutput,
} from './session-sync'

// 16ms PTY output batching (~60fps) to prevent xterm.js write() flooding
const PTY_BATCH_MS = 16
const pendingPtyData = new Map<string, { chunks: string[]; seq: number }>()
const ptyFlushTimers = new Map<string, ReturnType<typeof setTimeout>>()

function batchPtyData(
  characterId: string,
  data: string,
  seq: number,
  broadcast: (event: string, payload: unknown) => void
): void {
  if (!pendingPtyData.has(characterId)) {
    pendingPtyData.set(characterId, { chunks: [], seq })
  }
  const pending = pendingPtyData.get(characterId)!
  pending.chunks.push(data)
  pending.seq = seq

  if (!ptyFlushTimers.has(characterId)) {
    ptyFlushTimers.set(characterId, setTimeout(() => {
      const pendingEntry = pendingPtyData.get(characterId)
      const merged = pendingEntry?.chunks.join('') ?? ''
      broadcast(IPC_EVENTS.PTY_DATA, {
        characterId,
        data: merged,
        seq: pendingEntry?.seq ?? seq,
      })
      pendingPtyData.delete(characterId)
      ptyFlushTimers.delete(characterId)
    }, PTY_BATCH_MS))
  }
}

function flushPtyData(characterId: string, broadcast: (event: string, payload: unknown) => void): void {
  const timer = ptyFlushTimers.get(characterId)
  if (timer) clearTimeout(timer)
  ptyFlushTimers.delete(characterId)

  const pendingEntry = pendingPtyData.get(characterId)
  if (pendingEntry && pendingEntry.chunks.length > 0) {
    broadcast(IPC_EVENTS.PTY_DATA, {
      characterId,
      data: pendingEntry.chunks.join(''),
      seq: pendingEntry.seq,
    })
  }
  pendingPtyData.delete(characterId)
}

export function registerIPCHandlers(
  store: AgitoStore,
  options?: {
    authProtocolScheme?: string
    authDeepLinkCoordinator?: DeepLinkOAuthCallbackCoordinator
    billingProtocolScheme?: string
    billingDeepLinkCoordinator?: DeepLinkBillingCheckoutCoordinator
  }
): void {
  const terminalSessions = new TerminalSessionService()
  const runtimeService = new CharacterRuntimeService()
  const credentialStore = createCredentialStore(store.getBasePath())
  const syncAuthProfile = async (session: StoredAuthSession): Promise<StoredAuthSession['profile']> => {
    const res = await fetch(`${publicConfig.apiUrl}/api/me`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      throw new Error(`Failed to sync auth profile: ${res.status}`)
    }
    const profile = await res.json() as {
      id: string
      email: string
      display_name: string | null
      avatar_url: string | null
      provider: 'email' | 'google'
      email_verified: boolean
    }
    return {
      id: profile.id,
      email: profile.email,
      displayName: profile.display_name,
      avatarUrl: profile.avatar_url,
      provider: profile.provider,
      emailVerified: profile.email_verified,
    }
  }
  const authProvider: AuthProviderAdapter<StoredAuthSession> = (
    hasSupabasePublicConfig(publicConfig)
  )
    ? new SupabaseAuthProvider({
        supabaseUrl: publicConfig.supabaseUrl,
        supabasePublishableKey: publicConfig.supabasePublishableKey,
        isPackaged: app.isPackaged,
        protocolScheme: options?.authProtocolScheme ?? 'agito',
        waitForDeepLinkCallback: options?.authDeepLinkCoordinator
          ? () => options.authDeepLinkCoordinator!.waitForCallback()
          : undefined,
        resetPasswordRedirectUrl: publicConfig.authResetRedirectUrl ?? undefined,
      })
    : {
        restoreSession: async () => null,
        signInWithEmail: async () => {
          throw new Error('Auth is not configured. Set AGITO_PUBLIC_SUPABASE_URL and AGITO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.')
        },
        signUpWithEmail: async () => {
          throw new Error('Auth is not configured. Set AGITO_PUBLIC_SUPABASE_URL and AGITO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.')
        },
        signInWithGoogle: async () => {
          throw new Error('Auth is not configured. Set AGITO_PUBLIC_SUPABASE_URL and AGITO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.')
        },
        signOut: async () => {},
        resendSignUpVerification: async () => {
          throw new Error('Auth is not configured. Set AGITO_PUBLIC_SUPABASE_URL and AGITO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.')
        },
        sendPasswordReset: async () => {
          throw new Error('Auth is not configured. Set AGITO_PUBLIC_SUPABASE_URL and AGITO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.')
        },
      }
  const authService = new MainAuthService({
    credentialStore,
    provider: authProvider,
    syncProfile: syncAuthProfile,
  })
  const authReady = authService.initialize().catch((error) => {
    console.error('[AUTH] Failed to initialize session', error)
    return authService.getState()
  })

  const parseJsonSafely = async <T>(response: Response): Promise<T | null> => {
    try {
      return await response.json() as T
    } catch {
      return null
    }
  }

  const getAccessToken = async (): Promise<string> => {
    await authReady
    const authState = authService.getState()
    if (!canAccessGenerate(authState.status)) {
      throw new Error('Sign in to continue.')
    }

    const authSession = await credentialStore.getSession()
    if (!authSession?.accessToken) {
      throw new Error('Missing auth session. Sign in again to continue.')
    }
    return authSession.accessToken
  }

  const fetchAuthenticatedJson = async <T>(
    path: string,
    init?: {
      method?: string
      body?: string
    }
  ): Promise<T> => {
    const accessToken = await getAccessToken()
    const response = await fetch(`${publicConfig.apiUrl}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init?.body,
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      const error = await normalizeApiError(response)
      if (error.status === 401 || error.status === 403) {
        try {
          await authService.signOut()
        } catch (signOutError) {
          console.error('[AUTH] Failed to clear invalid session after API auth error', signOutError)
        }
      }
      throw error
    }

    const data = await parseJsonSafely<T>(response)
    if (data === null) {
      throw new Error('Server returned an empty response.')
    }
    return data
  }

  const loadGeneratedJobs = createGeneratedJobListLoader(async () => {
    const response = await fetchAuthenticatedJson<{
      jobs: GeneratedJobApiPayload[]
    }>('/api/generate/jobs')
    return response.jobs.map((job) => mapGeneratedJob(job))
  })

  const bufferToDataUrl = (buffer: Buffer, contentType: string | null): string => {
    const normalized = contentType?.split(';')[0]?.trim() || 'image/png'
    return `data:${normalized};base64,${buffer.toString('base64')}`
  }

  app.once('before-quit', () => {
    terminalSessions.killAll()
  })

  runtimeService.syncCharacters(store.getCharacters(), store.getSessions())
  runtimeService.onUpdate((state) => {
    broadcastToAll(IPC_EVENTS.CHARACTER_RUNTIME, state)
  })
  const liveRuntimeMetadata = new Map<string, {
    engine: EngineType
    workingDirectory: string
    claudeStartSessionId: string | null
  }>()
  authService.onUpdate((state) => {
    broadcastToAll(IPC_EVENTS.AUTH_SESSION_CHANGED, state)
  })

  const buildStoreSnapshot = () => {
    const characters = store.getCharacters()
    runtimeService.syncCharacters(characters, store.getSessions())
    return {
      characters,
      roomLayout: store.getRoomLayout(),
      sessions: store.getSessions(),
      settings: store.getSettings(),
      runtimeStates: runtimeService.getAllStates(),
    }
  }

  const persistVerifiedSessionId = (args: {
    characterId: string
    sessionId: string
    engineType: EngineType
    workingDirectory: string
  }): void => {
    const now = new Date().toISOString()
    const sessions = store.getSessions()
    store.saveSessions(
      upsertSessionMappingOnResume({
        sessions,
        characterId: args.characterId,
        sessionId: args.sessionId,
        workingDirectory: args.workingDirectory,
        engineType: args.engineType,
        now,
        overwriteExistingMetadata: true,
      })
    )

    const characters = store.getCharacters()
    const updatedCharacters = characters.map((character) =>
      character.id === args.characterId
        ? {
            ...character,
            currentSessionId: args.sessionId,
            engine: args.engineType,
            sessionHistory: [
              args.sessionId,
              ...character.sessionHistory.filter((id) => id !== args.sessionId),
            ].slice(0, MAX_SESSION_HISTORY),
          }
        : character
    )
    store.saveCharacters(updatedCharacters)
    runtimeService.syncCharacters(store.getCharacters(), store.getSessions())
    broadcastToAll(IPC_EVENTS.STORE_UPDATED, { key: 'characters' })
  }

  const waitForCodexStatusSessionId = async (
    characterId: string,
    timeoutMs = 5000
  ): Promise<string | null> => {
    if (!terminalSessions.isAlive(characterId)) return null
    const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))

    for (const char of '/status') {
      terminalSessions.write(characterId, char)
      await delay(12)
    }
    await delay(12)
    terminalSessions.write(characterId, '\r')

    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await delay(80)
      const renderedText = await terminalSessions.getRenderedText(characterId)
      const sessionId = parseLastSessionIdFromStatusOutput(renderedText)
      if (sessionId) {
        return sessionId
      }
    }

    return null
  }

  const spawnManagedSession = (
    characterId: string,
    command: string,
    args: string[],
    cwd: string
  ): void => {
    terminalSessions.spawn(characterId, command, args, cwd, {
      onData: (data, seq) => {
        batchPtyData(characterId, data, seq, broadcastToAll)
      },
      onExit: () => {
        flushPtyData(characterId, broadcastToAll)
        runtimeService.setLiveRuntime(characterId, false)
        liveRuntimeMetadata.delete(characterId)
      },
    })
  }

  const readCharacterSoul = (character: Character): string | undefined => {
    if (!character.soul) return undefined
    try {
      return readFileSync(join(store.getBasePath(), character.soul), 'utf-8')
    } catch {
      return undefined
    }
  }

  const getManagedEngineAdditionalArgs = (engine: EngineType): string[] => {
    const settings = store.getSettings()
    return getEnginePermissionSkipArgs(engine, settings.skipPermissionPrompts)
  }

  const ensureTerminalSession = (characterId: string): void => {
    if (terminalSessions.hasSession(characterId)) return

    const characters = store.getCharacters()
    const character = characters.find((candidate) => candidate.id === characterId)
    if (!character?.currentSessionId) return

    const sessionMapping = store.getSessions().find((session) => session.sessionId === character.currentSessionId)
    if (!sessionMapping) return
    if (!existsSync(sessionMapping.workingDirectory)) return

    const adapter = getEngineAdapter(character.engine)
    const soulContent = readCharacterSoul(character)
    const spawnArgs = adapter.buildSpawnArgs({
      sessionId: character.currentSessionId,
      soulPath: soulContent,
      workingDirectory: sessionMapping.workingDirectory,
      additionalArgs: getManagedEngineAdditionalArgs(sessionMapping.engineType),
    })

    spawnManagedSession(characterId, adapter.cliCommand, spawnArgs, sessionMapping.workingDirectory)
    liveRuntimeMetadata.set(characterId, {
      engine: sessionMapping.engineType,
      workingDirectory: sessionMapping.workingDirectory,
      claudeStartSessionId: null,
    })
    runtimeService.startSession({
      characterId,
      engine: sessionMapping.engineType,
      sessionId: character.currentSessionId,
      workingDirectory: sessionMapping.workingDirectory,
    })
  }

  // --- Store operations ---

  ipcMain.handle(IPC_COMMANDS.STORE_READ, () => {
    return buildStoreSnapshot()
  })

  ipcMain.handle(IPC_COMMANDS.STORE_WRITE, (_, key: string, data: unknown) => {
    switch (key) {
      case 'characters':
        store.saveCharacters(data as Character[])
        break
      case 'roomLayout':
        store.saveRoomLayout(data as RoomLayout)
        break
      default:
        throw new Error(`Unknown store key: ${key}`)
    }
    runtimeService.syncCharacters(store.getCharacters(), store.getSessions())
    broadcastToAll(IPC_EVENTS.STORE_UPDATED, { key })
  })

  // --- PTY operations ---

  ipcMain.handle(
    IPC_COMMANDS.PTY_SPAWN,
    (_, characterId: string, args: { command: string; args: string[]; cwd: string }) => {
      spawnManagedSession(characterId, args.command, args.args, args.cwd)
      return { success: true }
    }
  )

  ipcMain.handle(IPC_COMMANDS.PTY_WRITE, (_, args: { characterId: string; data: string }) => {
    terminalSessions.write(args.characterId, args.data)
  })

  ipcMain.handle(IPC_COMMANDS.PTY_RESIZE, (_, args: { characterId: string; cols: number; rows: number }) => {
    terminalSessions.resize(args.characterId, args.cols, args.rows)
  })

  ipcMain.handle(IPC_COMMANDS.PTY_KILL, (_, characterId: string) => {
    terminalSessions.kill(characterId)
  })

  ipcMain.handle(IPC_COMMANDS.PTY_IS_ALIVE, (_, characterId: string) => {
    return terminalSessions.isAlive(characterId)
  })

  ipcMain.handle(IPC_COMMANDS.PTY_GET_ALIVE_IDS, (_, characterIds: string[]) => {
    return terminalSessions.getAliveIds(characterIds)
  })

  ipcMain.handle(IPC_COMMANDS.TERMINAL_GET_SNAPSHOT, async (_, characterId: string) => {
    ensureTerminalSession(characterId)
    return terminalSessions.getSnapshot(characterId)
  })

  ipcMain.handle(IPC_COMMANDS.CHARACTER_RUNTIME_SNAPSHOT, () => {
    return runtimeService.getAllStates()
  })

  // --- Auth ---

  ipcMain.handle(IPC_COMMANDS.AUTH_GET_SESSION, async () => {
    await authReady
    return authService.getState()
  })

  ipcMain.handle(
    IPC_COMMANDS.AUTH_SIGN_IN_EMAIL,
    async (_, args: { email: string; password: string }) => {
      await authReady
      return authService.signInWithEmail(args.email, args.password)
    }
  )

  ipcMain.handle(
    IPC_COMMANDS.AUTH_SIGN_UP_EMAIL,
    async (_, args: { email: string; password: string }) => {
      await authReady
      return authService.signUpWithEmail(args.email, args.password)
    }
  )

  ipcMain.handle(IPC_COMMANDS.AUTH_SIGN_IN_GOOGLE, async () => {
    await authReady
    return authService.signInWithGoogle()
  })

  ipcMain.handle(IPC_COMMANDS.AUTH_SIGN_OUT, async () => {
    await authReady
    return authService.signOut()
  })

  ipcMain.handle(
    IPC_COMMANDS.AUTH_RESEND_SIGNUP_VERIFICATION,
    async (_, args: { email: string }) => {
      await authReady
      await authService.resendSignUpVerification(args.email)
      return { success: true }
    }
  )

  ipcMain.handle(
    IPC_COMMANDS.AUTH_SEND_PASSWORD_RESET,
    async (_, args: { email: string }) => {
      await authReady
      await authService.sendPasswordReset(args.email)
      return { success: true }
    }
  )

  ipcMain.handle(IPC_COMMANDS.AUTH_REFRESH_SESSION, async () => {
    return authService.initialize()
  })

  ipcMain.handle(IPC_COMMANDS.BILLING_GET_STATE, async () => {
    const response = await fetchAuthenticatedJson<{
      provider: 'polar'
      balance_credits: number
      pending_checkouts: Array<{
        checkout_id: string
        pack_id: string
        credits: number
        status: string
      }>
      packs: Array<{
        id: string
        name: string
        price_usd: string
        credits: number
        button_label: string
        badge?: string | null
        description: string
      }>
    }>('/api/billing/state')

    return {
      provider: response.provider,
      balanceCredits: response.balance_credits,
      pendingCheckouts: response.pending_checkouts.map((checkout) => ({
        checkoutId: checkout.checkout_id,
        packId: checkout.pack_id,
        credits: checkout.credits,
        status: checkout.status,
      })),
      packs: response.packs.map((pack) => ({
        id: pack.id,
        name: pack.name,
        priceUsd: pack.price_usd,
        credits: pack.credits,
        buttonLabel: pack.button_label,
        badge: pack.badge ?? null,
        description: pack.description,
      })),
    } satisfies BillingState
  })

  ipcMain.handle(IPC_COMMANDS.BILLING_GET_CHECKOUT_STATUS, async (_, checkoutId: string) => {
    const response = await fetchAuthenticatedJson<{
      checkout_id: string
      status: string
      pack_id: string
      credits: number
      granted: boolean
      balance_credits: number
    }>(`/api/billing/checkouts/${checkoutId}`)

    return {
      checkoutId: response.checkout_id,
      status: response.status,
      packId: response.pack_id,
      credits: response.credits,
      granted: response.granted,
      balanceCredits: response.balance_credits,
    }
  })

  ipcMain.handle(
    IPC_COMMANDS.BILLING_CREATE_CHECKOUT,
    async (_, args: BillingCheckoutSessionRequest) => {
      const redirectTargets = buildBillingCheckoutRedirectTargets({
        isPackaged: app.isPackaged,
        protocolScheme: options?.billingProtocolScheme ?? 'agito',
      })

      let pendingCheckout: Promise<unknown> | null = null
      if (app.isPackaged && options?.billingDeepLinkCoordinator) {
        pendingCheckout = options.billingDeepLinkCoordinator.waitForCheckout()
        pendingCheckout
          .then((payload) => {
            broadcastToAll(IPC_EVENTS.BILLING_CHECKOUT_RETURNED, payload)
          })
          .catch((error) => {
            console.error('[BILLING] Checkout callback failed', error)
          })
      }

      try {
        const checkout = await fetchAuthenticatedJson<{
          provider: 'polar'
          checkout_id: string
          checkout_url: string
        }>('/api/billing/checkout-session', {
          method: 'POST',
          body: JSON.stringify({
            pack_id: args.packId,
            success_url: args.successUrl ?? redirectTargets.successUrl,
            cancel_url: args.cancelUrl ?? redirectTargets.cancelUrl,
          }),
        })
        await shell.openExternal(checkout.checkout_url)
        return {
          provider: checkout.provider,
          checkoutId: checkout.checkout_id,
          checkoutUrl: checkout.checkout_url,
        } satisfies BillingCheckoutSessionResponse
      } catch (error) {
        if (pendingCheckout && options?.billingDeepLinkCoordinator) {
          options.billingDeepLinkCoordinator.rejectPending(
            error instanceof Error ? error : new Error(String(error))
          )
        }
        throw error
      }
    }
  )

  ipcMain.handle(
    IPC_COMMANDS.CHARACTER_RUNTIME_SET_ATTENTION,
    (_, args: { characterId: string; attentionActive: boolean }) => {
      runtimeService.setAttention(args.characterId, args.attentionActive)
      return { success: true }
    }
  )

  // --- Character CRUD ---

  ipcMain.handle(
    IPC_COMMANDS.CHARACTER_CREATE,
    async (_, args: { name: string; soul?: string; skin?: string }) => {
      const { nanoid } = await import('nanoid')
      const characters = store.getCharacters()

      const gridPosition = findEmptyPosition(characters)

      const now = new Date().toISOString()
      const newCharacter: Character = {
        id: nanoid(),
        name: args.name,
        engine: null,
        soul: args.soul ?? '',
        skin: args.skin ?? '',
        gridPosition,
        currentSessionId: null,
        sessionHistory: [],
        stats: {
          createdAt: now,
          totalTasks: 0,
          totalCommits: 0,
        },
      }

      store.saveCharacters([...characters, newCharacter])
      runtimeService.syncCharacters(store.getCharacters(), store.getSessions())
      broadcastToAll(IPC_EVENTS.STORE_UPDATED, { key: 'characters' })
      return newCharacter
    }
  )

  ipcMain.handle(
    IPC_COMMANDS.CHARACTER_UPDATE,
    (_, characterId: string, updates: Partial<Character>) => {
      const characters = store.getCharacters()
      const updated = characters.map((c) =>
        c.id === characterId ? { ...c, ...updates } : c
      )
      store.saveCharacters(updated)
      runtimeService.syncCharacters(store.getCharacters(), store.getSessions())
      broadcastToAll(IPC_EVENTS.STORE_UPDATED, { key: 'characters' })
    }
  )

  ipcMain.handle(IPC_COMMANDS.CHARACTER_DELETE, (_, characterId: string) => {
    const characters = store.getCharacters()
    store.saveCharacters(characters.filter((c) => c.id !== characterId))
    runtimeService.syncCharacters(store.getCharacters(), store.getSessions())
    broadcastToAll(IPC_EVENTS.STORE_UPDATED, { key: 'characters' })
  })

  // --- Session lifecycle ---

  ipcMain.handle(
    IPC_COMMANDS.SESSION_START,
    async (_, args: { characterId: string; workingDirectory: string; engine: EngineType }) => {
      const { characterId, workingDirectory, engine } = args

      if (!existsSync(workingDirectory)) {
        throw new Error(`Working directory not found: ${workingDirectory}`)
      }

      const characters = store.getCharacters()
      const character = characters.find((c) => c.id === characterId)
      if (!character) throw new Error(`Character not found: ${characterId}`)

      const adapter = getEngineAdapter(engine)

      const soulContent = readCharacterSoul(character)
      const startSessionId = engine === 'claude-code' ? createUuidV7() : undefined
      const spawnArgs = adapter.buildSpawnArgs({
        startSessionId,
        soulPath: soulContent,
        workingDirectory,
        additionalArgs: getManagedEngineAdditionalArgs(engine),
      })
      spawnManagedSession(characterId, adapter.cliCommand, spawnArgs, workingDirectory)
      const updatedCharacters = characters.map((c) =>
        c.id === characterId
          ? { ...c, currentSessionId: null, engine }
          : c
      )
      store.saveCharacters(updatedCharacters)
      runtimeService.startSession({
        characterId,
        engine,
        sessionId: null,
        workingDirectory,
      })
      liveRuntimeMetadata.set(characterId, {
        engine,
        workingDirectory,
        claudeStartSessionId: startSessionId ?? null,
      })
      runtimeService.syncCharacters(store.getCharacters(), store.getSessions())
      broadcastToAll(IPC_EVENTS.STORE_UPDATED, { key: 'characters' })

      return { sessionId: null, characterId }
    }
  )

  ipcMain.handle(
    IPC_COMMANDS.SESSION_SYNC,
    async (_, args: { characterId: string }) => {
      const { characterId } = args
      const characters = store.getCharacters()
      const character = characters.find((candidate) => candidate.id === characterId)
      if (!character) throw new Error(`Character not found: ${characterId}`)

      const runtimeMeta = liveRuntimeMetadata.get(characterId)
      const runtimeState = runtimeService.getState(characterId)
      if (!runtimeMeta || !runtimeState?.hasLiveRuntime) {
        return {
          sessionId: character.currentSessionId,
          message: '세션을 찾을 수 없습니다. 턴을 진행한 뒤 다시 시도해주세요.',
        }
      }

      let candidateSessionId: string | null = null
      if (runtimeMeta.engine === 'claude-code') {
        candidateSessionId = runtimeMeta.claudeStartSessionId ?? character.currentSessionId
      } else {
        candidateSessionId = await waitForCodexStatusSessionId(characterId)
      }

      if (!candidateSessionId) {
        return {
          sessionId: character.currentSessionId,
          message: '세션을 찾을 수 없습니다. 턴을 진행한 뒤 다시 시도해주세요.',
        }
      }

      const artifactPath =
        runtimeMeta.engine === 'claude-code'
          ? findClaudeSessionArtifactPath(homedir(), candidateSessionId)
          : findCodexSessionArtifactPath(homedir(), candidateSessionId)

      if (!artifactPath) {
        return {
          sessionId: character.currentSessionId,
          message: '세션을 찾을 수 없습니다. 턴을 진행한 뒤 다시 시도해주세요.',
        }
      }

      persistVerifiedSessionId({
        characterId,
        sessionId: candidateSessionId,
        engineType: runtimeMeta.engine,
        workingDirectory: runtimeMeta.workingDirectory,
      })

      return { sessionId: candidateSessionId }
    }
  )

  ipcMain.handle(
    IPC_COMMANDS.SESSION_RESUME,
    async (_, args: { characterId: string; sessionId: string; workingDirectory?: string; engineType?: EngineType }) => {
      const { characterId, sessionId } = args

      const characters = store.getCharacters()
      const character = characters.find((c) => c.id === characterId)
      if (!character) throw new Error(`Character not found: ${characterId}`)

      // Resolve working directory: use provided, or look up from session mapping
      let workingDirectory = args.workingDirectory
      const sessions = store.getSessions()
      const existingMapping = sessions.find((s) => s.sessionId === sessionId)
      if (!workingDirectory) {
        workingDirectory = existingMapping?.workingDirectory
      }
      if (!workingDirectory) {
        throw new Error('Working directory not found for this session')
      }

      // Resolve engine: from args, mapping, or character.engine
      let engineType: EngineType
      if (args.engineType) {
        engineType = args.engineType
      } else if (existingMapping) {
        engineType = existingMapping.engineType
      } else if (character.engine !== null) {
        engineType = character.engine
      } else {
        throw new Error('Cannot resume session: engine type is unknown. Please start a new session.')
      }

      const adapter = getEngineAdapter(engineType)

      const soulContent = readCharacterSoul(character)

      // Validate working directory exists
      if (!existsSync(workingDirectory)) {
        throw new Error(`Working directory not found: ${workingDirectory}`)
      }

      const spawnArgs = adapter.buildSpawnArgs({
        sessionId,
        soulPath: soulContent,
        workingDirectory,
        additionalArgs: getManagedEngineAdditionalArgs(engineType),
      })
      spawnManagedSession(characterId, adapter.cliCommand, spawnArgs, workingDirectory)
      liveRuntimeMetadata.set(characterId, {
        engine: engineType,
        workingDirectory,
        claudeStartSessionId: null,
      })

      const now = new Date().toISOString()
      store.saveSessions(
        upsertSessionMappingOnResume({
          sessions,
          characterId,
          sessionId,
          workingDirectory,
          engineType,
          now,
          overwriteExistingMetadata:
            args.workingDirectory !== undefined || args.engineType !== undefined,
        })
      )

      const updatedCharacters = characters.map((c) =>
        c.id === characterId
          ? { ...c, currentSessionId: sessionId, engine: engineType }
          : c
      )
      store.saveCharacters(updatedCharacters)
      runtimeService.startSession({
        characterId,
        engine: engineType,
        sessionId,
        workingDirectory,
      })
      runtimeService.syncCharacters(store.getCharacters(), store.getSessions())
      broadcastToAll(IPC_EVENTS.STORE_UPDATED, { key: 'characters' })

      return { sessionId, characterId }
    }
  )

  ipcMain.handle(IPC_COMMANDS.SESSION_STOP, (_, args: { characterId: string }) => {
    const { characterId } = args

    terminalSessions.kill(characterId)
    liveRuntimeMetadata.delete(characterId)
    runtimeService.stopSession(characterId)

    const characters = store.getCharacters()
    const updatedCharacters = characters.map((c) =>
      c.id === characterId
        ? { ...c, currentSessionId: null, engine: null }
        : c
    )
    store.saveCharacters(updatedCharacters)
    runtimeService.syncCharacters(store.getCharacters(), store.getSessions())
    broadcastToAll(IPC_EVENTS.STORE_UPDATED, { key: 'characters' })
  })

  // --- Session scan (discover external CLI sessions) ---

  ipcMain.handle(IPC_COMMANDS.SESSION_SCAN, async () => {
    const results: ScannedSession[] = []

    // Scan Claude Code sessions: ~/.claude/projects/<encoded-dir>/*.jsonl
    try {
      const claudeProjectsDir = join(homedir(), '.claude', 'projects')
      const claudeHistoryLabels = (() => {
        const historyPath = join(homedir(), '.claude', 'history.jsonl')
        if (!existsSync(historyPath)) return new Map<string, string>()
        return extractClaudeSessionLabelsFromHistory(readFileSync(historyPath, 'utf-8'))
      })()
      if (existsSync(claudeProjectsDir)) {
        const dirs = readdirSync(claudeProjectsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
        for (const dir of dirs) {
          const dirPath = join(claudeProjectsDir, dir.name)
          // Decode working directory from folder name (e.g. "-Users-foo-project" → "/Users/foo/project")
          const workDir = dir.name.replace(/^-/, '/').replace(/-/g, '/')
          try {
            const files = readdirSync(dirPath)
              .filter((f) => f.endsWith('.jsonl') && !f.startsWith('agent-'))
            for (const file of files) {
              try {
                const filePath = join(dirPath, file)
                const meta = extractClaudeSessionMetadata(filePath)
                if (!meta) continue
                if (!meta.sessionId) continue
                const stat = statSync(filePath)
                results.push({
                  sessionId: meta.sessionId,
                  engineType: 'claude-code',
                  workingDirectory: meta.cwd || workDir,
                  label: getPreferredClaudeSessionLabel({
                    historyLabel: claudeHistoryLabels.get(meta.sessionId) ?? null,
                    gitBranch: meta.gitBranch,
                    workingDirectory: meta.cwd || workDir,
                  }),
                  createdAt: meta.timestamp || stat.birthtime.toISOString(),
                  lastActiveAt: stat.mtime.toISOString(),
                })
              } catch {
                // skip unparseable files
              }
            }
          } catch {
            // skip unreadable dirs
          }
        }
      }
    } catch {
      // Claude CLI not installed
    }

    // Scan Codex sessions: prefer sqlite, supplement with session files, fallback to session_index.jsonl
    const codexResults: ScannedSession[] = []
    let codexSqliteSessions: ScannedSession[] = []
    let codexFileSessions: ScannedSession[] = []
    let codexIndexSessions: ScannedSession[] = []
    let codexIndexEntries = new Map<string, CodexSessionIndexEntry>()

    try {
      const codexIndex = join(homedir(), '.codex', 'session_index.jsonl')
      if (existsSync(codexIndex)) {
        const indexContent = readFileSync(codexIndex, 'utf-8')
        codexIndexEntries = extractCodexSessionIndexEntries(indexContent)
        codexIndexSessions = Array.from(codexIndexEntries.values()).map((entry) => ({
          sessionId: entry.sessionId,
          engineType: 'codex',
          workingDirectory: entry.cwd || '',
          label: entry.threadName || entry.sessionId.slice(0, 8),
          createdAt: entry.updatedAt || '',
          lastActiveAt: entry.updatedAt || '',
        }))
      }
    } catch {
      // session_index is optional and stale-prone; ignore parse failures
    }

    try {
      const codexDb = join(homedir(), '.codex', 'state_5.sqlite')
      if (existsSync(codexDb)) {
        const SQL = await initSqlJs()
        const buffer = readFileSync(codexDb)
        const db = new SQL.Database(buffer)
        const stmt = db.prepare(
          'SELECT id, title, cwd, created_at, updated_at, git_branch FROM threads WHERE archived = 0 ORDER BY updated_at DESC'
        )
        while (stmt.step()) {
          const row = stmt.getAsObject()
          codexSqliteSessions.push({
            sessionId: String(row.id),
            engineType: 'codex',
            workingDirectory: String(row.cwd || ''),
            label: String(row.title || row.git_branch || String(row.id).slice(0, 8)),
            createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
            lastActiveAt: new Date(Number(row.updated_at) * 1000).toISOString(),
          })
        }
        stmt.free()
        db.close()
      }
    } catch {
      // SQLite read failed; session files may still contain newer sessions
    }

    try {
      const codexSessionsDir = join(homedir(), '.codex', 'sessions')
      if (existsSync(codexSessionsDir)) {
        codexFileSessions = scanCodexSessionFiles(codexSessionsDir, codexIndexEntries)
      }
    } catch {
      // Session file scan is best-effort only.
    }

    codexResults.push(...mergeCodexScannedSessions({
      sqliteSessions: codexSqliteSessions,
      fileSessions: codexFileSessions,
      indexSessions: codexIndexSessions,
    }))
    results.push(...codexResults)

    // Sort by lastActiveAt descending (most recent first)
    results.sort((a, b) => {
      const ta = a.lastActiveAt || a.createdAt
      const tb = b.lastActiveAt || b.createdAt
      return tb.localeCompare(ta)
    })

    return results
  })

  // --- Engine detection ---

  ipcMain.handle(IPC_COMMANDS.ENGINE_DETECT_CLI, async (_, engine: string) => {
    if (engine === 'claude-code') {
      const { detectCLI } = await import('./engine/claude-code')
      return detectCLI()
    }
    if (engine === 'codex') {
      const codex = await import('./engine/codex')
      return codex.detectCLI()
    }
    return { found: false, path: null }
  })

  // --- Dialog ---

  ipcMain.handle(IPC_COMMANDS.DIALOG_OPEN_FOLDER, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // --- Soul management ---

  ipcMain.handle(IPC_COMMANDS.SOUL_LIST, () => {
    const soulsDir = join(store.getBasePath(), 'souls')
    if (!existsSync(soulsDir)) {
      mkdirSync(soulsDir, { recursive: true })
      return []
    }
    return readdirSync(soulsDir).filter((f) => f.endsWith('.md'))
  })

  ipcMain.handle(IPC_COMMANDS.SOUL_READ, (_, filename: string) => {
    const filePath = join(store.getBasePath(), 'souls', filename)
    if (!existsSync(filePath)) return ''
    return readFileSync(filePath, 'utf-8')
  })

  ipcMain.handle(IPC_COMMANDS.SOUL_WRITE, (_, filename: string, content: string) => {
    const soulsDir = join(store.getBasePath(), 'souls')
    if (!existsSync(soulsDir)) {
      mkdirSync(soulsDir, { recursive: true })
    }
    writeFileSync(join(soulsDir, filename), content, 'utf-8')
  })

  // --- Asset / Sprite management ---

  ipcMain.handle(IPC_COMMANDS.ASSET_RESOLVE_PATH, (_, relativePath: string) => {
    if (!relativePath) return null
    const absPath = join(store.getBasePath(), relativePath)
    if (!existsSync(absPath)) return null
    return absPath
  })

  ipcMain.handle(IPC_COMMANDS.ASSET_LIST, () => {
    const imageExts = ['.png', '.webp', '.jpg', '.jpeg']
    const categories = ['skin', 'furniture', 'background']
    const results: { theme: string; category: string; filename: string; relativePath: string; source: 'builtin' | 'custom' }[] = []

    const scanDir = (baseDir: string, source: 'builtin' | 'custom'): void => {
      if (!existsSync(baseDir)) return
      for (const themeEntry of readdirSync(baseDir, { withFileTypes: true })) {
        if (!themeEntry.isDirectory()) continue
        const theme = themeEntry.name
        const themeDir = join(baseDir, theme)
        for (const catEntry of readdirSync(themeDir, { withFileTypes: true })) {
          if (!catEntry.isDirectory()) continue
          const category = catEntry.name
          if (!categories.includes(category)) continue
          const catDir = join(themeDir, category)
          for (const fileEntry of readdirSync(catDir, { withFileTypes: true })) {
            if (fileEntry.isDirectory()) continue
            if (!imageExts.includes(extname(fileEntry.name).toLowerCase())) continue
            results.push({
              theme,
              category,
              filename: fileEntry.name,
              relativePath: `${theme}/${category}/${fileEntry.name}`,
              source,
            })
          }
        }
      }
    }

    // Scan built-in assets first, then custom (custom can override)
    scanDir(store.getBuiltinAssetsPath(), 'builtin')
    const customDir = join(store.getBasePath(), ASSETS_DIR)
    if (!existsSync(customDir)) mkdirSync(customDir, { recursive: true })
    scanDir(customDir, 'custom')

    return results
  })

  ipcMain.handle(IPC_COMMANDS.ASSET_UPLOAD, async (_, category: string, theme?: string) => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Images', extensions: ['png', 'webp', 'jpg', 'jpeg'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const validCategory = ['skin', 'furniture', 'background'].includes(category) ? category : 'furniture'
    const themeName = theme || 'custom'
    const sourcePath = result.filePaths[0]
    const destDir = join(store.getBasePath(), ASSETS_DIR, themeName, validCategory)
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true })
    }

    let filename = basename(sourcePath)
    let destPath = join(destDir, filename)

    // Add numeric suffix if duplicate
    if (existsSync(destPath)) {
      const ext = extname(filename)
      const nameWithoutExt = filename.slice(0, -ext.length)
      let counter = 1
      while (existsSync(destPath)) {
        filename = `${nameWithoutExt}_${counter}${ext}`
        destPath = join(destDir, filename)
        counter++
      }
    }

    copyFileSync(sourcePath, destPath)
    return `${themeName}/${validCategory}/${filename}`
  })

  ipcMain.handle(IPC_COMMANDS.ASSET_READ_BASE64, (_, relativePath: string) => {
    // Check custom assets first, then builtin
    const customPath = join(store.getBasePath(), ASSETS_DIR, relativePath)
    const builtinPath = join(store.getBuiltinAssetsPath(), relativePath)
    const filePath = existsSync(customPath) ? customPath : existsSync(builtinPath) ? builtinPath : null
    if (!filePath) return null
    const ext = extname(relativePath).toLowerCase().replace('.', '')
    const mime = ext === 'jpg' ? 'jpeg' : ext
    const data = readFileSync(filePath)
    return `data:image/${mime};base64,${data.toString('base64')}`
  })

  // --- Settings ---

  ipcMain.handle(IPC_COMMANDS.SETTINGS_READ, () => {
    return store.getSettings()
  })

  ipcMain.handle(IPC_COMMANDS.SETTINGS_WRITE, (_, settings: AgitoSettings) => {
    store.saveSettings(settings)
    broadcastToAll(IPC_EVENTS.STORE_UPDATED, { key: 'settings' })
  })

  ipcMain.handle(IPC_COMMANDS.ASSET_GENERATE_JOB_SUBMIT, async (_, req: AssetGenerateRequest) => {
    try {
      const job = await fetchAuthenticatedJson<GeneratedJobApiPayload>('/api/generate/jobs', {
        method: 'POST',
        body: JSON.stringify(req),
      })
      return mapGeneratedJob(job)
    } catch (error) {
      if (error instanceof ApiRequestError) {
        throw new Error(error.message)
      }
      throw error
    }
  })

  ipcMain.handle(IPC_COMMANDS.ASSET_GENERATE_JOB_LIST, async () => {
    return await loadGeneratedJobs()
  })

  ipcMain.handle(IPC_COMMANDS.ASSET_GENERATE_JOB_DETAIL, async (_, jobId: string) => {
    const response = await fetchAuthenticatedJson<GeneratedJobApiPayload>(`/api/generate/jobs/${jobId}`)
    return mapGeneratedJob(response)
  })

  ipcMain.handle(IPC_COMMANDS.ASSET_GENERATE_JOB_RECOVER, async (_, jobId: string) => {
    const response = await fetchAuthenticatedJson<GeneratedJobApiPayload>(`/api/generate/jobs/${jobId}/recover`, { method: 'POST' })

    return mapGeneratedJob(response)
  })

  ipcMain.handle(
    IPC_COMMANDS.ASSET_GENERATE_JOB_GET_PREVIEW_URLS,
    async (_, jobId: string): Promise<GenerateJobPreviewUrls> => {
      const request = buildGeneratedJobPreviewUrlsRequest({ jobId })
      const response = await fetchAuthenticatedJson<{
        source_image_url?: string | null
        reference_image_url?: string | null
        results: Array<{ result_id: number; signed_url: string }>
      }>(request.path)

      return {
        sourceImageUrl: response.source_image_url ?? null,
        referenceImageUrl: response.reference_image_url ?? null,
        results: response.results.map((result) => ({
          resultId: result.result_id,
          signedUrl: result.signed_url,
        })),
      }
    }
  )

  ipcMain.handle(
    IPC_COMMANDS.ASSET_GENERATE_JOB_SAVE_RESULT,
    async (_, args: { category: AssetCategory; jobId: string; resultId: number; filename?: string | null }) => {
      const accessToken = await getAccessToken()
      const downloadRequest = buildGeneratedResultDownloadRequest({
        category: args.category,
        jobId: args.jobId,
        resultId: args.resultId,
      })

      const download = await fetch(`${publicConfig.apiUrl}${downloadRequest.path}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(30_000),
      })
      if (!download.ok) {
        throw new Error(`Failed to download generated image: ${download.status}`)
      }

      const destDir = join(store.getBasePath(), ASSETS_DIR, 'custom', args.category)
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true })
      }

      const disposition = download.headers.get('content-disposition')
      const dispositionFilename = disposition?.match(/filename=\"?([^"]+)\"?/)?.[1] ?? null
      const filename = args.filename ?? dispositionFilename ?? `generated-result-${args.resultId}.png`
      writeFileSync(join(destDir, filename), Buffer.from(await download.arrayBuffer()))
      return {
        relativePath: `custom/${args.category}/${filename}`,
      } satisfies SaveGeneratedResultResponse
    }
  )

}

function getEngineAdapter(engineType: EngineType | null): EngineAdapter {
  if (engineType === null) {
    throw new Error('Engine type is not set for this character. Please start a new session and select an engine.')
  }
  switch (engineType) {
    case 'claude-code':
      return claudeCodeAdapter
    case 'codex':
      return codexAdapter
    default:
      throw new Error(`Unknown engine type: ${engineType}`)
  }
}

function findEmptyPosition(characters: Character[]): { x: number; y: number } {
  const fw = FOOTPRINTS.character.w
  const fh = FOOTPRINTS.character.h

  for (let y = 0; y <= GRID_ROWS - fh; y++) {
    for (let x = 0; x <= GRID_COLS - fw; x++) {
      const occupied = characters.some((c) => {
        if (!c.gridPosition) return false
        const cx = c.gridPosition.x
        const cy = c.gridPosition.y
        // Check if the 2x2 area at (x,y) overlaps with this character's 2x2 footprint
        return x < cx + fw && x + fw > cx && y < cy + fh && y + fh > cy
      })
      if (!occupied) {
        return { x, y }
      }
    }
  }

  // Fallback: place at origin if grid is completely full
  return { x: 0, y: 0 }
}

function broadcastToAll(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args)
  }
}
