import { ipcMain, BrowserWindow, dialog } from 'electron'
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs'
import { join, basename, extname } from 'path'
import { IPC_COMMANDS, IPC_EVENTS } from '../shared/ipc-channels'
import type { Character, EngineType, RoomLayout, SessionMapping } from '../shared/types'
import type { AgitoStore } from './store'
import { PtyPool } from './pty-pool'
import { StatusDetector } from './status-detector'
import { GRID_COLS, GRID_ROWS, WALL_ROWS, FOOTPRINTS, MAX_SESSION_HISTORY, SPRITES_DIR } from '../shared/constants'
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
        sprite: '',
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

  // --- Custom manifest persistence ---

  const customManifestsPath = join(store.getBasePath(), 'custom-manifests.json')

  ipcMain.handle(IPC_COMMANDS.MANIFEST_LIST, () => {
    if (!existsSync(customManifestsPath)) return []
    try {
      return JSON.parse(readFileSync(customManifestsPath, 'utf-8'))
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC_COMMANDS.MANIFEST_SAVE, (_, manifests: unknown) => {
    writeFileSync(customManifestsPath, JSON.stringify(manifests, null, 2), 'utf-8')
  })

  // --- Asset / Sprite management ---

  ipcMain.handle(IPC_COMMANDS.ASSET_RESOLVE_PATH, (_, relativePath: string) => {
    if (!relativePath) return null
    const absPath = join(store.getBasePath(), relativePath)
    if (!existsSync(absPath)) return null
    return absPath
  })

  ipcMain.handle(IPC_COMMANDS.SPRITE_LIST, () => {
    const spritesDir = join(store.getBasePath(), SPRITES_DIR)
    if (!existsSync(spritesDir)) {
      mkdirSync(spritesDir, { recursive: true })
      return []
    }
    const imageExts = ['.png', '.webp', '.jpg', '.jpeg']
    const results: string[] = []
    function scanDir(dir: string, prefix: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          scanDir(join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name)
        } else if (imageExts.includes(extname(entry.name).toLowerCase())) {
          results.push(prefix ? `${prefix}/${entry.name}` : entry.name)
        }
      }
    }
    scanDir(spritesDir, '')
    return results
  })

  ipcMain.handle(IPC_COMMANDS.SPRITE_UPLOAD, async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Images', extensions: ['png', 'webp', 'jpg', 'jpeg'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const sourcePath = result.filePaths[0]
    const spritesDir = join(store.getBasePath(), SPRITES_DIR)
    if (!existsSync(spritesDir)) {
      mkdirSync(spritesDir, { recursive: true })
    }

    let filename = basename(sourcePath)
    let destPath = join(spritesDir, filename)

    // Add numeric suffix if duplicate
    if (existsSync(destPath)) {
      const ext = extname(filename)
      const nameWithoutExt = filename.slice(0, -ext.length)
      let counter = 1
      while (existsSync(destPath)) {
        filename = `${nameWithoutExt}_${counter}${ext}`
        destPath = join(spritesDir, filename)
        counter++
      }
    }

    copyFileSync(sourcePath, destPath)
    return filename
  })

  ipcMain.handle(IPC_COMMANDS.SPRITE_READ_BASE64, (_, relativePath: string) => {
    // Support both "file.png" and "subdir/file.png"
    const filePath = join(store.getBasePath(), SPRITES_DIR, relativePath)
    if (!existsSync(filePath)) return null
    const ext = extname(relativePath).toLowerCase().replace('.', '')
    const mime = ext === 'jpg' ? 'jpeg' : ext
    const data = readFileSync(filePath)
    return `data:image/${mime};base64,${data.toString('base64')}`
  })
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

  for (let y = WALL_ROWS; y <= GRID_ROWS - fh; y++) {
    for (let x = 0; x <= GRID_COLS - fw; x++) {
      const occupied = characters.some((c) => {
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
