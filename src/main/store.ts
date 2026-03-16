import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync } from 'fs'
import {
  AGITO_DIR_NAME,
  CHARACTERS_FILE,
  ROOM_LAYOUT_FILE,
  SESSIONS_FILE,
  SOULS_DIR,
  ASSETS_DIR,
  BUILTIN_ASSETS_DIR,
  SETTINGS_FILE,
  DEFAULT_SETTINGS,
} from '../shared/constants'
import type {
  Character,
  RoomLayout,
  SessionMapping,
  AgitoPersistentData,
  AgitoSettings,
} from '../shared/types'

const MIGRATION_VERSION = 1

export class AgitoStore {
  private basePath: string

  constructor() {
    this.basePath = process.env.AGITO_HOME || join(app.getPath('home'), AGITO_DIR_NAME)
  }

  initialize(): void {
    // Create base directories
    const dirs = [
      this.basePath,
      join(this.basePath, SOULS_DIR),
      join(this.basePath, ASSETS_DIR, 'custom', 'skin'),
      join(this.basePath, ASSETS_DIR, 'custom', 'furniture'),
      join(this.basePath, ASSETS_DIR, 'custom', 'background'),
    ]
    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
    }

    // Create default files
    if (!existsSync(this.filePath(CHARACTERS_FILE))) {
      this.writeJSON(CHARACTERS_FILE, [])
    }
    if (!existsSync(this.filePath(ROOM_LAYOUT_FILE))) {
      this.writeJSON(ROOM_LAYOUT_FILE, { background: '', items: [], gridCols: 40, gridRows: 24 })
    }
    if (!existsSync(this.filePath(SESSIONS_FILE))) {
      this.writeJSON(SESSIONS_FILE, [])
    }
    if (!existsSync(this.filePath(SETTINGS_FILE))) {
      this.writeJSON(SETTINGS_FILE, { ...DEFAULT_SETTINGS })
    }

    // Run migration if needed
    this.runMigration()
  }

  private runMigration(): void {
    const settings = this.getSettings()
    const currentVersion = (settings as unknown as Record<string, unknown>)._migrationVersion as number ?? 0
    if (currentVersion >= MIGRATION_VERSION) return

    console.log(`[AgitoStore] Running migration v${currentVersion} → v${MIGRATION_VERSION}`)

    // Migration 0 → 1: sprite→skin, character→skin folders, tile→background
    this.migrateCharactersJson()
    this.migrateAssetFolders()
    this.migrateRoomLayout()

    // Update migration version
    this.saveSettings({ ...settings, _migrationVersion: MIGRATION_VERSION } as AgitoSettings)
    console.log('[AgitoStore] Migration complete')
  }

  private migrateCharactersJson(): void {
    try {
      const raw = readFileSync(this.filePath(CHARACTERS_FILE), 'utf-8')
      const characters = JSON.parse(raw) as Record<string, unknown>[]
      let changed = false

      for (const char of characters) {
        // sprite → skin
        if ('sprite' in char && !('skin' in char)) {
          const spritePath = (char.sprite as string) || ''
          char.skin = spritePath.replace(/\/character\//g, '/skin/')
          delete char.sprite
          changed = true
        }
      }

      if (changed) {
        this.writeJSON(CHARACTERS_FILE, characters)
        console.log('[Migration] characters.json: sprite → skin')
      }
    } catch {
      // File doesn't exist or is invalid, skip
    }
  }

  private migrateAssetFolders(): void {
    const assetsDir = join(this.basePath, ASSETS_DIR)
    if (!existsSync(assetsDir)) return

    for (const themeEntry of readdirSync(assetsDir, { withFileTypes: true })) {
      if (!themeEntry.isDirectory()) continue
      const themeDir = join(assetsDir, themeEntry.name)

      // character/ → skin/
      const charDir = join(themeDir, 'character')
      const skinDir = join(themeDir, 'skin')
      if (existsSync(charDir) && !existsSync(skinDir)) {
        renameSync(charDir, skinDir)
        console.log(`[Migration] ${themeEntry.name}/character → skin`)
      }

      // tile/ → background/
      const tileDir = join(themeDir, 'tile')
      const bgDir = join(themeDir, 'background')
      if (existsSync(tileDir) && !existsSync(bgDir)) {
        renameSync(tileDir, bgDir)
        console.log(`[Migration] ${themeEntry.name}/tile → background`)
      }
    }
  }

  private migrateRoomLayout(): void {
    try {
      const raw = readFileSync(this.filePath(ROOM_LAYOUT_FILE), 'utf-8')
      const layout = JSON.parse(raw) as { items?: { manifestId: string }[] }
      let changed = false

      if (layout.items) {
        for (const item of layout.items) {
          if (item.manifestId && item.manifestId.includes('/tile/')) {
            item.manifestId = item.manifestId.replace(/\/tile\//g, '/background/')
            changed = true
          }
          if (item.manifestId && item.manifestId.includes('/character/')) {
            item.manifestId = item.manifestId.replace(/\/character\//g, '/skin/')
            changed = true
          }
        }
      }

      if (changed) {
        this.writeJSON(ROOM_LAYOUT_FILE, layout)
        console.log('[Migration] room-layout.json: paths updated')
      }
    } catch {
      // File doesn't exist or is invalid, skip
    }
  }

  private filePath(filename: string): string {
    return join(this.basePath, filename)
  }

  private readJSON<T>(filename: string): T {
    const raw = readFileSync(this.filePath(filename), 'utf-8')
    return JSON.parse(raw) as T
  }

  private writeJSON<T>(filename: string, data: T): void {
    writeFileSync(
      this.filePath(filename),
      JSON.stringify(data, null, 2),
      'utf-8'
    )
  }

  getCharacters(): Character[] {
    return this.readJSON<Character[]>(CHARACTERS_FILE)
  }

  saveCharacters(characters: Character[]): void {
    this.writeJSON(CHARACTERS_FILE, characters)
  }

  getRoomLayout(): RoomLayout {
    return this.readJSON<RoomLayout>(ROOM_LAYOUT_FILE)
  }

  saveRoomLayout(layout: RoomLayout): void {
    this.writeJSON(ROOM_LAYOUT_FILE, layout)
  }

  getSessions(): SessionMapping[] {
    return this.readJSON<SessionMapping[]>(SESSIONS_FILE)
  }

  saveSessions(sessions: SessionMapping[]): void {
    this.writeJSON(SESSIONS_FILE, sessions)
  }

  getSettings(): AgitoSettings {
    try {
      return this.readJSON<AgitoSettings>(SETTINGS_FILE)
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  saveSettings(settings: AgitoSettings): void {
    this.writeJSON(SETTINGS_FILE, settings)
  }

  getAll(): AgitoPersistentData {
    return {
      characters: this.getCharacters(),
      roomLayout: this.getRoomLayout(),
      sessions: this.getSessions(),
      settings: this.getSettings(),
    }
  }

  getBasePath(): string {
    return this.basePath
  }

  getBuiltinAssetsPath(): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, BUILTIN_ASSETS_DIR)
    }
    // Dev mode: relative to project root
    return join(app.getAppPath(), BUILTIN_ASSETS_DIR)
  }
}
