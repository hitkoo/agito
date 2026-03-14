// --- Engine ---

export type EngineType = 'claude-code' | 'codex'

// --- Character ---

export type CharacterStatus = 'idle' | 'waiting' | 'working' | 'error' | 'done'

export interface GridPosition {
  x: number
  y: number
}

export interface CharacterStats {
  createdAt: string
  totalTasks: number
  totalCommits: number
}

export interface Character {
  id: string
  name: string
  soul: string // path to soul.md relative to ~/.agito/
  sprite: string // path to sprite image relative to ~/.agito/
  engine: EngineType
  gridPosition: GridPosition
  currentSessionId: string | null
  sessionHistory: string[] // max 10, most recent first
  status: CharacterStatus
  stats: CharacterStats
  footprint?: ItemFootprint // defaults to FOOTPRINTS.character (2×2) if not set
  zOrder?: number
}

// --- Room ---

export type PlacementZone = 'floor' | 'wall'

export type ItemCategory = 'tile' | 'furniture'

export interface ItemFootprint {
  w: number
  h: number
}

export interface ItemManifest {
  id: string
  name: string
  category: ItemCategory
  footprint: ItemFootprint
  texture: string
  anchor: { x: number; y: number }
  placementZone: PlacementZone
  tags: string[]
}

export interface PlacedItem {
  id: string // unique instance id
  manifestId: string // reference to ItemManifest.id
  position: GridPosition
  footprint: ItemFootprint
  zOrder?: number
}

export interface RoomLayout {
  background: string // path to background texture
  items: PlacedItem[]
}

// --- Session ---

export interface SessionMapping {
  characterId: string
  sessionId: string
  engineType: EngineType
  workingDirectory: string
  createdAt: string
  lastActiveAt: string
}

// --- Store Data ---

export interface AgitoPersistentData {
  characters: Character[]
  roomLayout: RoomLayout
  sessions: SessionMapping[]
}
