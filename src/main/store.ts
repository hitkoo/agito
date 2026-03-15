import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import {
  AGITO_DIR_NAME,
  CHARACTERS_FILE,
  ROOM_LAYOUT_FILE,
  SESSIONS_FILE,
  SOULS_DIR,
  ASSETS_DIR,
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

export class AgitoStore {
  private basePath: string

  constructor() {
    this.basePath = join(app.getPath('home'), AGITO_DIR_NAME)
  }

  initialize(): void {
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
}
