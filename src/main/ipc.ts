import { ipcMain, BrowserWindow, dialog, app } from 'electron'
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, copyFileSync, statSync } from 'fs'
import initSqlJs from 'sql.js'
import { join, basename, extname } from 'path'
import { homedir } from 'os'
import { IPC_COMMANDS, IPC_EVENTS } from '../shared/ipc-channels'
import type { Character, EngineType, RoomLayout, SessionMapping, AgitoSettings, AssetGenerateRequest, AssetGenerateResult, ScannedSession } from '../shared/types'
import { canAccessGenerate, type AuthSessionState } from '../shared/auth'
import { hasSupabasePublicConfig, publicConfig } from '../shared/public-config'
import type { AgitoStore } from './store'
import { TerminalSessionService } from './terminal-session-service'
import { GRID_COLS, GRID_ROWS, FOOTPRINTS, MAX_SESSION_HISTORY, ASSETS_DIR } from '../shared/constants'
import type { EngineAdapter } from './engine/types'
import { claudeCodeAdapter } from './engine/claude-code'
import { codexAdapter } from './engine/codex'
import { CharacterRuntimeService } from './character-runtime-service'
import { MainAuthService, type AuthProviderAdapter, type AuthProviderResult } from './auth/auth-service'
import { createCredentialStore, type StoredAuthSession } from './auth/credential-store'
import { SupabaseAuthProvider } from './auth/supabase-auth-provider'
import type { DeepLinkOAuthCallbackCoordinator } from './auth/oauth-callback'

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
  app.once('before-quit', () => {
    terminalSessions.killAll()
  })

  runtimeService.syncCharacters(store.getCharacters(), store.getSessions())
  runtimeService.onUpdate((state) => {
    broadcastToAll(IPC_EVENTS.CHARACTER_RUNTIME, state)
  })
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
    })

    spawnManagedSession(characterId, adapter.cliCommand, spawnArgs, sessionMapping.workingDirectory)
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
      const { nanoid } = await import('nanoid')
      const { characterId, workingDirectory, engine } = args

      if (!existsSync(workingDirectory)) {
        throw new Error(`Working directory not found: ${workingDirectory}`)
      }

      const characters = store.getCharacters()
      const character = characters.find((c) => c.id === characterId)
      if (!character) throw new Error(`Character not found: ${characterId}`)

      const adapter = getEngineAdapter(engine)

      const soulContent = readCharacterSoul(character)

      const spawnArgs = adapter.buildSpawnArgs({ soulPath: soulContent, workingDirectory })
      spawnManagedSession(characterId, adapter.cliCommand, spawnArgs, workingDirectory)

      const sessionId = nanoid()
      const now = new Date().toISOString()

      const sessionMapping: SessionMapping = {
        characterId,
        sessionId,
        engineType: engine,
        workingDirectory,
        createdAt: now,
        lastActiveAt: now,
      }

      const sessions = store.getSessions()
      store.saveSessions([...sessions, sessionMapping])

      const updatedHistory = [sessionId, ...character.sessionHistory].slice(0, MAX_SESSION_HISTORY)
      const updatedCharacters = characters.map((c) =>
        c.id === characterId
          ? { ...c, currentSessionId: sessionId, sessionHistory: updatedHistory, engine }
          : c
      )
      store.saveCharacters(updatedCharacters)
      runtimeService.startSession({
        characterId,
        engine,
        sessionId,
        workingDirectory,
      })
      runtimeService.syncCharacters(store.getCharacters(), store.getSessions())
      broadcastToAll(IPC_EVENTS.STORE_UPDATED, { key: 'characters' })

      return { sessionId, characterId }
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

      const spawnArgs = adapter.buildSpawnArgs({ sessionId, soulPath: soulContent, workingDirectory })
      spawnManagedSession(characterId, adapter.cliCommand, spawnArgs, workingDirectory)

      const now = new Date().toISOString()
      if (existingMapping) {
        store.saveSessions(sessions.map((s) =>
          s.sessionId === sessionId ? { ...s, lastActiveAt: now } : s
        ))
      } else {
        // Create new mapping for externally scanned sessions
        sessions.push({
          characterId,
          sessionId,
          engineType,
          workingDirectory,
          createdAt: now,
          lastActiveAt: now,
        })
        store.saveSessions(sessions)
      }

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
                const firstLine = readFileSync(filePath, 'utf-8').split('\n')[0]
                if (!firstLine) continue
                const meta = JSON.parse(firstLine)
                if (!meta.sessionId) continue
                const stat = statSync(filePath)
                results.push({
                  sessionId: meta.sessionId,
                  engineType: 'claude-code',
                  workingDirectory: meta.cwd || workDir,
                  label: meta.gitBranch || basename(workDir),
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

    // Scan Codex sessions: ~/.codex/state_5.sqlite (SoT), fallback to session_index.jsonl
    let codexScanned = false
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
          results.push({
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
        codexScanned = true
      }
    } catch {
      // SQLite read failed, try fallback
    }

    // Fallback: session_index.jsonl (no cwd field)
    if (!codexScanned) {
      try {
        const codexIndex = join(homedir(), '.codex', 'session_index.jsonl')
        if (existsSync(codexIndex)) {
          const lines = readFileSync(codexIndex, 'utf-8').split('\n').filter(Boolean)
          for (const line of lines) {
            try {
              const entry = JSON.parse(line)
              if (!entry.id) continue
              results.push({
                sessionId: entry.id,
                engineType: 'codex',
                workingDirectory: entry.cwd || '',
                label: entry.thread_name || entry.id.slice(0, 8),
                createdAt: entry.updated_at || '',
                lastActiveAt: entry.updated_at,
              })
            } catch {
              // skip unparseable lines
            }
          }
        }
      } catch {
        // Codex CLI not installed
      }
    }

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

  // --- Asset Generation (via agito-server) ---

  ipcMain.handle(IPC_COMMANDS.ASSET_GENERATE, async (_, req: AssetGenerateRequest) => {
    const baseUrl = publicConfig.apiUrl
    await authReady
    const authState: AuthSessionState = authService.getState()
    if (!canAccessGenerate(authState.status)) {
      return {
        success: false,
        error: 'Sign in to use Generate.',
      }
    }

    const authSession = await credentialStore.getSession()
    if (!authSession?.accessToken) {
      return {
        success: false,
        error: 'Missing auth session. Sign in again to use Generate.',
      }
    }

    try {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authSession.accessToken}`,
        },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(300_000),
      })

      if (!res.ok) {
        const text = await res.text()
        return { success: false, error: `Server error ${res.status}: ${text}` }
      }

      const result = await res.json() as {
        success: boolean
        results?: { success: boolean; image_base64?: string; filename?: string; error?: string }[]
        error?: string
        duration_ms?: number
      }

      console.log('[ASSET_GENERATE] Server response:', { success: result.success, resultCount: result.results?.length, error: result.error, duration_ms: result.duration_ms })

      if (result.success && result.results) {
        // Save each generated image to local assets
        const destDir = join(store.getBasePath(), ASSETS_DIR, 'custom', req.category)
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true })
        }

        for (const item of result.results) {
          if (item.success && item.image_base64 && item.filename) {
            const buf = Buffer.from(item.image_base64, 'base64')
            writeFileSync(join(destDir, item.filename), buf)
          }
        }

        return {
          success: true,
          results: result.results.map((item) => ({
            ...item,
            relativePath: item.filename ? `custom/${req.category}/${item.filename}` : undefined,
          })),
          duration_ms: result.duration_ms,
        }
      }

      return { success: false, error: result.error || 'Unknown error' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED')) {
        return { success: false, error: 'Cannot connect to agito-server. Is it running on ' + baseUrl + '?' }
      }
      return { success: false, error: msg }
    }
  })

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
