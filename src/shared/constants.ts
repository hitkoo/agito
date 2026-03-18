// World grid
export const GRID_COLS = 40
export const GRID_ROWS = 24
export const MIN_GRID_COLS = 20
export const MIN_GRID_ROWS = 12
export const MAX_GRID_COLS = 120
export const MAX_GRID_ROWS = 80

// Session history limit
export const MAX_SESSION_HISTORY = 10

// Data directory
export const AGITO_DIR_NAME = '.agito'
export const CHARACTERS_FILE = 'characters.json'
export const ROOM_LAYOUT_FILE = 'room-layout.json'
export const SESSIONS_FILE = 'sessions.json'
export const SOULS_DIR = 'souls'
export const ASSETS_DIR = 'assets'
export const BUILTIN_ASSETS_DIR = 'builtin-assets'

// Default footprints (grid cells)
export const FOOTPRINTS = {
  character: { w: 2, h: 2 },
  desk: { w: 3, h: 2 },
  chair: { w: 1, h: 1 },
  bookshelf: { w: 4, h: 1 },
  smallDecor: { w: 1, h: 1 },
} as const

// Supported engines
export const SUPPORTED_ENGINES = ['claude-code', 'codex'] as const

// Settings
export const SETTINGS_FILE = 'settings.json'
export const TERMINAL_FONT_FAMILY_OPTIONS = [
  'SF Mono',
  'JetBrains Mono',
  'Hack',
  'Iosevka',
  'Monaspace Neon',
  'Maple Mono',
  'monospace',
] as const
export const TERMINAL_FONT_SIZE_OPTIONS = [10, 11, 12, 13, 14, 15, 16] as const
export const DEFAULT_SETTINGS = {
  defaultSpriteSize: 64,
  terminalFontFamilies: [...TERMINAL_FONT_FAMILY_OPTIONS],
  terminalFontSize: 13,
} as const

export const ASSET_SIZES = [32, 64, 128] as const

// Asset categories
export const ASSET_CATEGORIES = ['skin', 'furniture', 'background'] as const
