import type {
  CharacterMarkerStatus,
  CharacterRuntimeState,
} from './character-runtime-state'

// --- Engine ---

export type EngineType = 'claude-code' | 'codex'

// --- Character ---

export type CharacterStatus = CharacterMarkerStatus

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
  skin: string // path to skin image relative to ~/.agito/
  engine: EngineType | null
  gridPosition: GridPosition | null
  currentSessionId: string | null
  sessionHistory: string[] // max 10, most recent first
  status: CharacterStatus
  stats: CharacterStats
  footprint?: ItemFootprint // defaults to FOOTPRINTS.character (2×2) if not set
  zOrder?: number
}

// --- Room ---

export type PlacementZone = 'floor' | 'wall'

export type ItemCategory = 'background' | 'furniture'

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
  gridCols: number
  gridRows: number
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

// --- Scanned Session (external CLI sessions) ---

export interface ScannedSession {
  sessionId: string
  engineType: EngineType
  workingDirectory: string
  label: string // thread_name (codex) or gitBranch (claude)
  createdAt: string
  lastActiveAt?: string
}

// --- Store Data ---

export interface AgitoPersistentData {
  characters: Character[]
  roomLayout: RoomLayout
  sessions: SessionMapping[]
  settings: AgitoSettings
  runtimeStates?: CharacterRuntimeState[]
}

// --- Settings ---

export interface AgitoSettings {
  defaultSpriteSize: number
}

// --- Terminal Dock ---

export interface TerminalDockSyncState {
  detached: boolean
  minimized: boolean
  activeCharacterId: string | null
  ownerWindow: 'attached' | 'detached'
  detachedReady: boolean
}

// --- Asset Management ---

export type AssetSource = 'builtin' | 'custom'

export type AssetCategory = 'skin' | 'furniture' | 'background'

export interface AssetListEntry {
  theme: string
  category: string
  filename: string
  relativePath: string
  source: AssetSource
}

// --- Asset Generation ---

export interface AssetGenerateRequest {
  category: AssetCategory
  prompt: string
  width: number
  height: number
  view?: '3/4' | 'iso'
  source_image?: string | null
  reference_image?: string | null
  template_id?: string | null
}

export interface AssetGenerateResult {
  success: boolean
  relativePath?: string
  image_base64?: string
  filename?: string
  error?: string
  duration_ms?: number
}
