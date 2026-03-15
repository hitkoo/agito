import { useMemo, useState, useEffect, useCallback } from 'react'
import { Sparkles } from 'lucide-react'
import { useUIStore } from '../stores/ui-store'
import { useCharacterStore } from '../stores/character-store'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import { Button } from './ui/button'
import { GenerateDialog } from './GenerateDialog'
import type { ItemCategory, AssetCategory, Character } from '../../../shared/types'

// --- Types ---

interface SpriteEntry {
  theme: string
  category: string
  filename: string
  relativePath: string
}

// --- Thumbnail loader ---

function useSpritePreview(relativePath: string): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!relativePath) { setDataUrl(null); return }
    window.api.invoke<string | null>(IPC_COMMANDS.ASSET_READ_BASE64, relativePath).then(setDataUrl)
  }, [relativePath])
  return dataUrl
}

// --- Sprite Card ---

function SpriteCard({ entry, dataUrl: preloadedDataUrl }: { entry: SpriteEntry; dataUrl?: string }): JSX.Element {
  const setDraggingManifestId = useUIStore((s) => s.setDraggingManifestId)
  const preview = useSpritePreview(preloadedDataUrl ? '' : entry.relativePath)
  const displayDataUrl = preloadedDataUrl ?? preview
  const displayName = entry.filename.replace(/\.[^.]+$/, '').replace(/Modern_Office_Singles_32x32_/, '#')

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', entry.relativePath)
    setDraggingManifestId(entry.relativePath)
  }, [entry.relativePath, setDraggingManifestId])

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={() => setDraggingManifestId(null)}
      className="rounded-lg bg-secondary p-1.5 cursor-grab active:cursor-grabbing select-none flex flex-col items-center gap-1 border border-transparent hover:border-muted-foreground/30 transition-colors"
    >
      <div className="w-full aspect-square rounded bg-muted/50 flex items-center justify-center overflow-hidden">
        {displayDataUrl ? (
          <img src={displayDataUrl} alt={displayName} className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
        ) : (
          <span className="text-2xl text-muted-foreground/40">?</span>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground text-center truncate w-full">{displayName}</p>
    </div>
  )
}

// --- Collapsible section ---

function CollapsibleSection({ title, count, defaultOpen = true, children }: {
  title: string
  count?: number
  defaultOpen?: boolean
  children: React.ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className="space-y-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 w-full text-left group"
      >
        <span className="text-[10px] text-muted-foreground transition-transform" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          ▶
        </span>
        <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wider group-hover:text-foreground transition-colors">
          {title}{count !== undefined ? ` (${count})` : ''}
        </span>
      </button>
      {open && children}
    </section>
  )
}

// --- Character Placement List ---

function CharacterPlacementList(): JSX.Element {
  const characters = useCharacterStore((s) => s.characters)
  const loadCharacters = useCharacterStore((s) => s.loadFromMain)
  const setDraggingManifestId = useUIStore((s) => s.setDraggingManifestId)

  useEffect(() => { loadCharacters() }, [loadCharacters])

  if (characters.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-8">
        <p>No characters yet.</p>
        <p className="mt-1">Create one in the Characters tab.</p>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {characters.map((char: Character) => (
        <CharacterPlacementCard
          key={char.id}
          character={char}
          setDraggingManifestId={setDraggingManifestId}
        />
      ))}
    </div>
  )
}

function CharacterPlacementCard({ character, setDraggingManifestId }: {
  character: Character
  setDraggingManifestId: (id: string | null) => void
}): JSX.Element {
  const preview = useSpritePreview(
    character.skin
      ? (character.skin.startsWith('assets/') ? character.skin.slice(7) : character.skin)
      : ''
  )
  const isPlaced = character.gridPosition !== null

  const handleDragStart = useCallback((e: React.DragEvent) => {
    // Use a special prefix so App.tsx handleDrop knows this is a character placement
    e.dataTransfer.setData('text/plain', `__character__:${character.id}`)
    setDraggingManifestId(`__character__:${character.id}`)
  }, [character.id, setDraggingManifestId])

  return (
    <div
      draggable={!isPlaced}
      onDragStart={isPlaced ? undefined : handleDragStart}
      onDragEnd={() => setDraggingManifestId(null)}
      className={`flex items-center gap-2 rounded-md border border-border bg-secondary/30 p-1.5 ${
        !isPlaced ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
    >
      <div className="w-10 h-10 rounded bg-muted/50 flex items-center justify-center overflow-hidden shrink-0">
        {preview ? (
          <img src={preview} alt={character.name} className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
        ) : (
          <span className="text-lg text-muted-foreground/40">?</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{character.name}</p>
        <p className={`text-[10px] ${isPlaced ? 'text-green-500' : 'text-muted-foreground'}`}>
          {isPlaced ? 'On canvas' : 'Drag to place'}
        </p>
      </div>
    </div>
  )
}

// --- Main Palette ---

type PaletteTab = 'background' | 'furniture' | 'skin'

export function ItemPalette(): JSX.Element {
  const [showGenerateDialog, setShowGenerateDialog] = useState(false)
  const [activeTab, setActiveTab] = useState<PaletteTab>('furniture')
  const [allSprites, setAllSprites] = useState<SpriteEntry[]>([])
  const [spriteDataUrls, setSpriteDataUrls] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)

  // Load all sprites from the asset folder scan
  const loadSprites = useCallback(async () => {
    setLoading(true)
    try {
      const entries = await window.api.invoke<SpriteEntry[]>(IPC_COMMANDS.ASSET_LIST)
      setAllSprites(entries ?? [])
      setLoading(false)

      // Load thumbnails in background (non-blocking)
      if (entries && entries.length > 0) {
        const urlMap = new Map<string, string>()
        for (let i = 0; i < entries.length; i += 20) {
          const batch = entries.slice(i, i + 20)
          const results = await Promise.all(
            batch.map(async (entry) => {
              try {
                const data = await window.api.invoke<string | null>(IPC_COMMANDS.ASSET_READ_BASE64, entry.relativePath)
                return { key: entry.relativePath, data }
              } catch {
                return { key: entry.relativePath, data: null }
              }
            })
          )
          for (const r of results) {
            if (r.data) urlMap.set(r.key, r.data)
          }
          // Update progressively so cards appear as thumbnails load
          setSpriteDataUrls(new Map(urlMap))
        }
      }
    } catch {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSprites()
  }, [loadSprites])

  // Filter by category for each tab
  const tileSprites = useMemo(() => allSprites.filter((s) => s.category === 'background'), [allSprites])
  const furnitureSprites = useMemo(() => allSprites.filter((s) => s.category === 'furniture'), [allSprites])

  // Group by theme
  const groupByTheme = useCallback((sprites: SpriteEntry[]) => {
    const groups = new Map<string, SpriteEntry[]>()
    for (const s of sprites) {
      const existing = groups.get(s.theme) ?? []
      existing.push(s)
      groups.set(s.theme, existing)
    }
    return groups
  }, [])

  const tileGroups = useMemo(() => groupByTheme(tileSprites), [groupByTheme, tileSprites])
  const furnitureGroups = useMemo(() => groupByTheme(furnitureSprites), [groupByTheme, furnitureSprites])

  const handleUpload = useCallback(async () => {
    const category: ItemCategory = activeTab === 'background' ? 'background' : 'furniture'
    const relativePath = await window.api.invoke<string | null>(IPC_COMMANDS.ASSET_UPLOAD, category)
    if (relativePath) {
      await loadSprites()
    }
  }, [activeTab, loadSprites])

  const tabs: { id: PaletteTab; label: string }[] = [
    { id: 'background', label: 'Background' },
    { id: 'furniture', label: 'Furniture' },
    { id: 'skin', label: 'Character' },
  ]

  const renderThemeGroups = (groups: Map<string, SpriteEntry[]>): JSX.Element => {
    const themeOrder = [...groups.keys()].sort((a, b) => {
      // Put 'custom' last
      if (a === 'custom') return 1
      if (b === 'custom') return -1
      return a.localeCompare(b)
    })

    return (
      <>
        {themeOrder.map((theme) => {
          const entries = groups.get(theme) ?? []
          const themeLabel = theme.charAt(0).toUpperCase() + theme.slice(1)
          return (
            <CollapsibleSection key={theme} title={themeLabel} count={entries.length} defaultOpen={theme !== 'custom' || entries.length > 0}>
              {entries.length > 0 ? (
                <div className="grid grid-cols-3 gap-1.5">
                  {entries.map((entry) => (
                    <SpriteCard key={entry.relativePath} entry={entry} dataUrl={spriteDataUrls.get(entry.relativePath)} />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-2">No items. Click &quot;+ Add&quot;.</p>
              )}
            </CollapsibleSection>
          )
        })}
        {groups.size === 0 && (
          <p className="text-xs text-muted-foreground py-2">No items found. Click &quot;+ Add&quot;.</p>
        )}
      </>
    )
  }

  return (
    <div className="w-64 h-full bg-background border-l border-border flex flex-col shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <h2 className="text-sm font-semibold">Items</h2>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => setShowGenerateDialog(true)}>
            <Sparkles className="h-3 w-3 mr-1" />AI
          </Button>
          <Button variant="outline" size="sm" onClick={handleUpload}>+ Add</Button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`flex-1 py-2 text-[11px] font-medium text-center transition-colors ${
              activeTab === tab.id ? 'text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading sprites...</p>
        ) : (
          <>
            {activeTab === 'background' && renderThemeGroups(tileGroups)}
            {activeTab === 'furniture' && renderThemeGroups(furnitureGroups)}
            {activeTab === 'skin' && <CharacterPlacementList />}
          </>
        )}
      </div>

      {showGenerateDialog && (
        <GenerateDialog
          defaultCategory={(activeTab === 'skin' ? 'furniture' : activeTab) as AssetCategory}
          onClose={() => setShowGenerateDialog(false)}
          onGenerated={() => { setShowGenerateDialog(false); loadSprites() }}
        />
      )}
    </div>
  )
}
