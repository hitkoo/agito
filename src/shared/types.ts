import type {
  CharacterRuntimeState,
} from './character-runtime-state'
import type { DockLayout } from './terminal-dock-layout'

// --- Engine ---

export type EngineType = 'claude-code' | 'codex'

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
  stats: CharacterStats
  footprint?: ItemFootprint // defaults to FOOTPRINTS.character (2×2) if not set
  zOrder?: number
  rotation?: 0 | 90 | 180 | 270
  flipX?: boolean
  flipY?: boolean
  crop?: CropRect | null
}

// --- Room ---

export interface CropRect {
  top: number
  bottom: number
  left: number
  right: number
}

export type PlacementZone = 'floor' | 'wall'

export type ItemCategory = 'background' | 'furniture'

export interface ItemFootprint {
  w: number
  h: number
}

export function getEffectiveFootprint(fp: ItemFootprint, rotation?: number): ItemFootprint {
  return (rotation === 90 || rotation === 270) ? { w: fp.h, h: fp.w } : fp
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
  rotation?: 0 | 90 | 180 | 270
  flipX?: boolean
  flipY?: boolean
  crop?: CropRect | null
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
  skipPermissionPrompts: boolean
  terminalFontFamilies: string[]
  terminalFontSize: number
}

// --- Terminal Dock ---

export interface TerminalDockSyncState {
  floatMode: boolean
  terminalVisible: boolean
  barVisible: boolean
  focusedPaneId: string
  activeCharacterId: string | null
  layout: DockLayout
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
  batch_count?: number
}

export type GenerateJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'partial_success'

export interface GenerateJobResultItem {
  id: number
  filename: string
  storagePath: string
  sortIndex: number
  mimeType: string
}

export interface GenerateJobPreviewResultUrl {
  resultId: number
  signedUrl: string
}

export interface GenerateJobPreviewUrls {
  sourceImageUrl?: string | null
  referenceImageUrl?: string | null
  results: GenerateJobPreviewResultUrl[]
}

export interface GenerateJob {
  id: string
  category: AssetCategory
  prompt: string
  status: GenerateJobStatus
  reservedCredits: number
  chargedCredits: number
  uploadedCount: number
  expectedCount: number
  error?: string | null
  storagePrefix?: string | null
  originalPrompt?: string | null
  hasSourceImage?: boolean
  hasReferenceImage?: boolean
  createdAt: string
  startedAt?: string | null
  completedAt?: string | null
  leaseExpiresAt?: string | null
  results: GenerateJobResultItem[]
}

export interface SaveGeneratedResultResponse {
  relativePath: string
}
