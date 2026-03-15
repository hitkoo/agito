import { ipcMain, BrowserWindow, dialog } from 'electron'
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs'
import { join, basename, extname } from 'path'
import { IPC_COMMANDS, IPC_EVENTS } from '../shared/ipc-channels'
import type { Character, EngineType, RoomLayout, SessionMapping, AgitoSettings, AssetGenerateRequest, AssetGenerateResult } from '../shared/types'
import type { AgitoStore } from './store'
import { PtyPool } from './pty-pool'
import { StatusDetector } from './status-detector'
import { GRID_COLS, GRID_ROWS, FOOTPRINTS, MAX_SESSION_HISTORY, ASSETS_DIR } from '../shared/constants'
import type { EngineAdapter } from './engine/types'
import { claudeCodeAdapter } from './engine/claude-code'
import { codexAdapter } from './engine/codex'

export function registerIPCHandlers(store: AgitoStore): void {
  const ptyPool = new PtyPool()
  const statusDetector = new StatusDetector()

  // --- Store operations ---

  ipcMain.handle(IPC_COMMANDS.STORE_READ, () => {
    return store.getAll()
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
    broadcastToAll(IPC_EVENTS.STORE_UPDATED, { key })
  })

  // --- PTY operations ---

  ipcMain.handle(
    IPC_COMMANDS.PTY_SPAWN,
    (_, characterId: string, args: { command: string; args: string[]; cwd: string }) => {
      const pty = ptyPool.spawn(characterId, args.command, args.args, args.cwd)

      pty.onData((data) => {
        broadcastToAll(IPC_EVENTS.PTY_DATA, { characterId, data })
        statusDetector.feedData(characterId, data)
      })

      statusDetector.attach(characterId, (status) => {
        broadcastToAll(IPC_EVENTS.CHARACTER_STATUS, { characterId, status })
      })

      pty.onExit(({ exitCode }) => {
        broadcastToAll(IPC_EVENTS.CHARACTER_STATUS, {
          characterId,
          status: exitCode === 0 ? 'done' : 'error',
        })
      })

      return { success: true }
    }
  )

  ipcMain.handle(IPC_COMMANDS.PTY_WRITE, (_, args: { characterId: string; data: string }) => {
    ptyPool.write(args.characterId, args.data)
  })

  ipcMain.handle(IPC_COMMANDS.PTY_RESIZE, (_, args: { characterId: string; cols: number; rows: number }) => {
    ptyPool.resize(args.characterId, args.cols, args.rows)
  })

  ipcMain.handle(IPC_COMMANDS.PTY_KILL, (_, characterId: string) => {
    statusDetector.detach(characterId)
    ptyPool.kill(characterId)
  })

  ipcMain.handle(IPC_COMMANDS.PTY_GET_BUFFER, (_, characterId: string) => {
    return ptyPool.getOutputBuffer(characterId)
  })

  // --- Character CRUD ---

  ipcMain.handle(
    IPC_COMMANDS.CHARACTER_CREATE,
    async (_, args: { name: string; engine: EngineType; soul?: string }) => {
      const { nanoid } = await import('nanoid')
      const characters = store.getCharacters()

      const gridPosition = findEmptyPosition(characters)

      const now = new Date().toISOString()
      const newCharacter: Character = {
        id: nanoid(),
        name: args.name,
        engine: args.engine,
        soul: args.soul ?? '',
        skin: '',
        gridPosition,
        currentSessionId: null,
        sessionHistory: [],
        status: 'idle',
        stats: {
          createdAt: now,
          totalTasks: 0,
          totalCommits: 0,
        },
      }

      store.saveCharacters([...characters, newCharacter])
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
      broadcastToAll(IPC_EVENTS.STORE_UPDATED, { key: 'characters' })
    }
  )

  ipcMain.handle(IPC_COMMANDS.CHARACTER_DELETE, (_, characterId: string) => {
    const characters = store.getCharacters()
    store.saveCharacters(characters.filter((c) => c.id !== characterId))
    broadcastToAll(IPC_EVENTS.STORE_UPDATED, { key: 'characters' })
  })

  // --- Session lifecycle ---

  ipcMain.handle(
    IPC_COMMANDS.SESSION_START,
    async (_, args: { characterId: string; workingDirectory: string }) => {
      const { nanoid } = await import('nanoid')
      const { characterId, workingDirectory } = args

      const characters = store.getCharacters()
      const character = characters.find((c) => c.id === characterId)
      if (!character) throw new Error(`Character not found: ${characterId}`)

      const adapter = getEngineAdapter(character.engine)

      let soulContent: string | undefined
      if (character.soul) {
        try {
          soulContent = readFileSync(join(store.getBasePath(), character.soul), 'utf-8')
        } catch {
          // soul file missing — proceed without it
        }
      }

      const spawnArgs = adapter.buildSpawnArgs({ soulPath: soulContent, workingDirectory })

      const pty = ptyPool.spawn(characterId, adapter.cliCommand, spawnArgs, workingDirectory)

      pty.onData((data) => {
        broadcastToAll(IPC_EVENTS.PTY_DATA, { characterId, data })
        statusDetector.feedData(characterId, data)
      })

      statusDetector.attach(characterId, (status) => {
        broadcastToAll(IPC_EVENTS.CHARACTER_STATUS, { characterId, status })
      })

      pty.onExit(({ exitCode }) => {
        broadcastToAll(IPC_EVENTS.CHARACTER_STATUS, {
          characterId,
          status: exitCode === 0 ? 'done' : 'error',
        })
      })

      const sessionId = nanoid()
      const now = new Date().toISOString()

      const sessionMapping: SessionMapping = {
        characterId,
        sessionId,
        engineType: character.engine,
        workingDirectory,
        createdAt: now,
        lastActiveAt: now,
      }

      const sessions = store.getSessions()
      store.saveSessions([...sessions, sessionMapping])

      const updatedHistory = [sessionId, ...character.sessionHistory].slice(0, MAX_SESSION_HISTORY)
      const updatedCharacters = characters.map((c) =>
        c.id === characterId
          ? { ...c, currentSessionId: sessionId, sessionHistory: updatedHistory, status: 'working' as const }
          : c
      )
      store.saveCharacters(updatedCharacters)
      broadcastToAll(IPC_EVENTS.STORE_UPDATED, { key: 'characters' })

      return { sessionId, characterId }
    }
  )

  ipcMain.handle(
    IPC_COMMANDS.SESSION_RESUME,
    async (_, args: { characterId: string; sessionId: string; workingDirectory: string }) => {
      const { characterId, sessionId, workingDirectory } = args

      const characters = store.getCharacters()
      const character = characters.find((c) => c.id === characterId)
      if (!character) throw new Error(`Character not found: ${characterId}`)

      const adapter = getEngineAdapter(character.engine)

      let soulContent: string | undefined
      if (character.soul) {
        try {
          soulContent = readFileSync(join(store.getBasePath(), character.soul), 'utf-8')
        } catch {
          // soul file missing — proceed without it
        }
      }

      const spawnArgs = adapter.buildSpawnArgs({ sessionId, soulPath: soulContent, workingDirectory })

      const pty = ptyPool.spawn(characterId, adapter.cliCommand, spawnArgs, workingDirectory)

      pty.onData((data) => {
        broadcastToAll(IPC_EVENTS.PTY_DATA, { characterId, data })
        statusDetector.feedData(characterId, data)
      })

      statusDetector.attach(characterId, (status) => {
        broadcastToAll(IPC_EVENTS.CHARACTER_STATUS, { characterId, status })
      })

      pty.onExit(({ exitCode }) => {
        broadcastToAll(IPC_EVENTS.CHARACTER_STATUS, {
          characterId,
          status: exitCode === 0 ? 'done' : 'error',
        })
      })

      const now = new Date().toISOString()
      const sessions = store.getSessions()
      const updatedSessions = sessions.map((s) =>
        s.sessionId === sessionId ? { ...s, lastActiveAt: now } : s
      )
      store.saveSessions(updatedSessions)

      const updatedCharacters = characters.map((c) =>
        c.id === characterId
          ? { ...c, currentSessionId: sessionId, status: 'working' as const }
          : c
      )
      store.saveCharacters(updatedCharacters)
      broadcastToAll(IPC_EVENTS.STORE_UPDATED, { key: 'characters' })

      return { sessionId, characterId }
    }
  )

  ipcMain.handle(IPC_COMMANDS.SESSION_STOP, (_, args: { characterId: string }) => {
    const { characterId } = args

    statusDetector.detach(characterId)
    ptyPool.kill(characterId)

    const characters = store.getCharacters()
    const updatedCharacters = characters.map((c) =>
      c.id === characterId
        ? { ...c, currentSessionId: null, status: 'idle' as const }
        : c
    )
    store.saveCharacters(updatedCharacters)
    broadcastToAll(IPC_EVENTS.STORE_UPDATED, { key: 'characters' })
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

  const getApiBaseUrl = (): string => process.env.AGITO_API_URL || 'http://localhost:8000'

  ipcMain.handle(IPC_COMMANDS.ASSET_LIST_TEMPLATES, async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/templates`, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) return []
      return await res.json()
    } catch {
      return []
    }
  })


  ipcMain.handle(IPC_COMMANDS.ASSET_GENERATE, async (_, req: AssetGenerateRequest) => {
    const baseUrl = getApiBaseUrl()

    try {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  // --- Auto-resume stale sessions on startup ---
  // Characters with currentSessionId but no running PTY need to be resumed
  const startupCharacters = store.getCharacters()
  const sessions = store.getSessions()
  for (const char of startupCharacters) {
    if (char.currentSessionId && !ptyPool.isAlive(char.id)) {
      const session = sessions.find((s) => s.sessionId === char.currentSessionId)
      if (!session) {
        // Session mapping not found — reset to idle
        store.saveCharacters(
          store.getCharacters().map((c) =>
            c.id === char.id ? { ...c, currentSessionId: null, status: 'idle' as const } : c
          )
        )
        continue
      }

      const adapter = getEngineAdapter(char.engine)
      let soulContent: string | undefined
      if (char.soul) {
        try {
          soulContent = readFileSync(join(store.getBasePath(), char.soul), 'utf-8')
        } catch { /* ignore */ }
      }

      const spawnArgs = adapter.buildSpawnArgs({
        sessionId: char.currentSessionId,
        soulPath: soulContent,
        workingDirectory: session.workingDirectory,
      })

      const pty = ptyPool.spawn(char.id, adapter.cliCommand, spawnArgs, session.workingDirectory)

      pty.onData((ptyData) => {
        broadcastToAll(IPC_EVENTS.PTY_DATA, { characterId: char.id, data: ptyData })
        statusDetector.feedData(char.id, ptyData)
      })

      statusDetector.attach(char.id, (status) => {
        broadcastToAll(IPC_EVENTS.CHARACTER_STATUS, { characterId: char.id, status })
      })

      pty.onExit(({ exitCode }) => {
        broadcastToAll(IPC_EVENTS.CHARACTER_STATUS, {
          characterId: char.id,
          status: exitCode === 0 ? 'done' : 'error',
        })
      })

      // Update status to idle initially — statusDetector will set 'working' when data flows
      store.saveCharacters(
        store.getCharacters().map((c) =>
          c.id === char.id ? { ...c, status: 'idle' as const } : c
        )
      )
    }
  }
}

function getEngineAdapter(engineType: EngineType): EngineAdapter {
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
