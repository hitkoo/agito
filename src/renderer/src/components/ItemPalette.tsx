import { useMemo, useState, useEffect, useCallback } from 'react'
import { ITEM_MANIFESTS, addManifest, loadCustomManifests, getCustomManifests } from '../../../shared/item-manifests'
import { useUIStore } from '../stores/ui-store'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import { Button } from './ui/button'
import { Label } from './ui/label'
import type { ItemManifest, ItemCategory } from '../../../shared/types'

// --- Thumbnail loader ---

function useSpritePreview(texturePath: string): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!texturePath) { setDataUrl(null); return }
    const relPath = texturePath.startsWith('sprites/') ? texturePath.slice(8) : texturePath
    window.api.invoke<string | null>(IPC_COMMANDS.SPRITE_READ_BASE64, relPath).then(setDataUrl)
  }, [texturePath])
  return dataUrl
}

// --- Item Card ---

function ItemCard({ manifest }: { manifest: ItemManifest }): JSX.Element {
  const setDraggingManifestId = useUIStore((s) => s.setDraggingManifestId)
  const preview = useSpritePreview(manifest.texture)

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', manifest.id)
        setDraggingManifestId(manifest.id)
      }}
      onDragEnd={() => setDraggingManifestId(null)}
      className="rounded-lg bg-secondary p-2 cursor-grab active:cursor-grabbing select-none flex flex-col items-center gap-1.5 border border-transparent hover:border-muted-foreground/30 transition-colors"
    >
      <div className="w-full aspect-square rounded bg-muted/50 flex items-center justify-center overflow-hidden">
        {preview ? (
          <img src={preview} alt={manifest.name} className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
        ) : (
          <span className="text-2xl text-muted-foreground/40">?</span>
        )}
      </div>
      <p className="text-xs font-medium text-foreground text-center truncate w-full">{manifest.name}</p>
    </div>
  )
}

// --- Built-in sprite card (office pack) ---

function BuiltinSpriteCard({ relativePath, dataUrl }: { relativePath: string; dataUrl: string }): JSX.Element {
  const setDraggingManifestId = useUIStore((s) => s.setDraggingManifestId)
  const filename = relativePath.split('/').pop() ?? relativePath
  const displayName = filename.replace(/\.[^.]+$/, '').replace(/Modern_Office_Singles_32x32_/, '#')
  const manifestId = `builtin-${relativePath.replace(/[/\\. ]/g, '-')}`

  const handleDragStart = useCallback((e: React.DragEvent) => {
    let manifest = ITEM_MANIFESTS.find((m) => m.id === manifestId)
    if (!manifest) {
      manifest = {
        id: manifestId,
        name: displayName,
        category: 'furniture' as ItemCategory,
        footprint: { w: 2, h: 3 },
        texture: `sprites/${relativePath}`,
        anchor: { x: 0.5, y: 1.0 },
        placementZone: 'floor',
        tags: ['builtin'],
      }
      addManifest(manifest)
      window.api.invoke(IPC_COMMANDS.MANIFEST_SAVE, getCustomManifests())
    }
    e.dataTransfer.setData('text/plain', manifestId)
    setDraggingManifestId(manifestId)
  }, [manifestId, displayName, relativePath, setDraggingManifestId])

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={() => setDraggingManifestId(null)}
      className="rounded-lg bg-secondary p-1.5 cursor-grab active:cursor-grabbing select-none flex flex-col items-center gap-1 border border-transparent hover:border-muted-foreground/30 transition-colors"
    >
      <div className="w-full aspect-square rounded bg-muted/50 flex items-center justify-center overflow-hidden">
        <img src={dataUrl} alt={displayName} className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
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

// --- Add Item Modal ---

function AddItemModal({ onClose, defaultCategory }: { onClose: () => void; defaultCategory: ItemCategory }): JSX.Element {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<ItemCategory>(defaultCategory)
  const [spritePath, setSpritePath] = useState('')
  const [preview, setPreview] = useState<string | null>(null)

  const handleUploadSprite = useCallback(async () => {
    const filename = await window.api.invoke<string | null>(IPC_COMMANDS.SPRITE_UPLOAD)
    if (filename) {
      setSpritePath(`sprites/${filename}`)
      const data = await window.api.invoke<string | null>(IPC_COMMANDS.SPRITE_READ_BASE64, filename)
      setPreview(data)
    }
  }, [])

  const handleSubmit = useCallback(() => {
    const trimmed = name.trim()
    if (!trimmed || !spritePath) return
    const id = `custom-${crypto.randomUUID().slice(0, 8)}`
    const manifest: ItemManifest = {
      id,
      name: trimmed,
      category,
      footprint: { w: 2, h: 2 },
      texture: spritePath,
      anchor: { x: 0.5, y: 1.0 },
      placementZone: 'floor',
      tags: ['custom'],
    }
    addManifest(manifest)
    onClose()
  }, [name, category, spritePath, onClose])

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-background border border-border rounded-lg p-5 w-[340px] space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Add New Item</h3>
        <div className="space-y-1.5">
          <Label htmlFor="item-name">Name</Label>
          <input id="item-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Office Desk"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="item-category">Category</Label>
          <select id="item-category" value={category} onChange={(e) => setCategory(e.target.value as ItemCategory)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="tile">Tile / Wallpaper</option>
            <option value="furniture">Furniture</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Sprite</Label>
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded bg-muted/50 flex items-center justify-center overflow-hidden border border-border">
              {preview ? <img src={preview} alt="preview" className="w-full h-full object-contain" /> : <span className="text-xs text-muted-foreground">None</span>}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={handleUploadSprite}>Upload Image</Button>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={!name.trim() || !spritePath}>Add</Button>
        </div>
      </div>
    </div>
  )
}

// --- Main Palette ---

type PaletteTab = 'tile' | 'furniture' | 'character'

export function ItemPalette(): JSX.Element {
  const [activeTab, setActiveTab] = useState<PaletteTab>('furniture')
  const [showAddModal, setShowAddModal] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const [builtinSprites, setBuiltinSprites] = useState<{ path: string; dataUrl: string }[]>([])
  const [loadingBuiltin, setLoadingBuiltin] = useState(true)

  useEffect(() => {
    window.api.invoke<ItemManifest[]>(IPC_COMMANDS.MANIFEST_LIST).then((custom) => {
      if (custom && custom.length > 0) {
        loadCustomManifests(custom)
        setRefreshKey((k) => k + 1)
      }
    })
  }, [])

  useEffect(() => {
    setLoadingBuiltin(true)
    window.api.invoke<string[]>(IPC_COMMANDS.SPRITE_LIST).then(async (allFiles) => {
      const officeFiles = allFiles.filter((f) => f.startsWith('office/'))
      const entries: { path: string; dataUrl: string }[] = []
      for (let i = 0; i < officeFiles.length; i += 20) {
        const batch = officeFiles.slice(i, i + 20)
        const results = await Promise.all(
          batch.map(async (f) => {
            const data = await window.api.invoke<string | null>(IPC_COMMANDS.SPRITE_READ_BASE64, f)
            return data ? { path: f, dataUrl: data } : null
          })
        )
        for (const r of results) if (r) entries.push(r)
      }
      setBuiltinSprites(entries)
      setLoadingBuiltin(false)
    })
  }, [])

  const allItems = useMemo(() => ITEM_MANIFESTS, [refreshKey])

  const builtinTiles = useMemo(() => allItems.filter((m) => m.category === 'tile' && !m.tags.includes('custom') && !m.tags.includes('builtin')), [allItems])
  const customTiles = useMemo(() => allItems.filter((m) => m.category === 'tile' && (m.tags.includes('custom'))), [allItems])
  const builtinFurniture = useMemo(() => allItems.filter((m) => m.category === 'furniture' && !m.tags.includes('custom') && !m.tags.includes('builtin')), [allItems])
  const customFurniture = useMemo(() => allItems.filter((m) => m.category === 'furniture' && (m.tags.includes('custom'))), [allItems])

  const handleCloseModal = useCallback(() => {
    setShowAddModal(false)
    window.api.invoke(IPC_COMMANDS.MANIFEST_SAVE, getCustomManifests())
    setRefreshKey((k) => k + 1)
  }, [])

  const tabs: { id: PaletteTab; label: string }[] = [
    { id: 'tile', label: 'Tile/Wall' },
    { id: 'furniture', label: 'Furniture' },
    { id: 'character', label: 'Character' },
  ]

  return (
    <div className="absolute right-0 top-0 w-64 h-full bg-background border-l border-border z-[50] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <h2 className="text-sm font-semibold">Items</h2>
        <Button variant="outline" size="sm" onClick={() => setShowAddModal(true)}>+ Add</Button>
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
        {/* --- Tile/Wall Tab --- */}
        {activeTab === 'tile' && (
          <>
            {builtinTiles.length > 0 && (
              <CollapsibleSection title="Built-in" count={builtinTiles.length}>
                <div className="grid grid-cols-2 gap-2">
                  {builtinTiles.map((m) => <ItemCard key={m.id} manifest={m} />)}
                </div>
              </CollapsibleSection>
            )}
            <CollapsibleSection title="Custom" count={customTiles.length} defaultOpen={customTiles.length > 0}>
              {customTiles.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {customTiles.map((m) => <ItemCard key={m.id} manifest={m} />)}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-2">No custom tiles. Click &quot;+ Add&quot;.</p>
              )}
            </CollapsibleSection>
          </>
        )}

        {/* --- Furniture Tab --- */}
        {activeTab === 'furniture' && (
          <>
            {builtinFurniture.length > 0 && (
              <CollapsibleSection title="Built-in" count={builtinFurniture.length}>
                <div className="grid grid-cols-2 gap-2">
                  {builtinFurniture.map((m) => <ItemCard key={m.id} manifest={m} />)}
                </div>
              </CollapsibleSection>
            )}
            <CollapsibleSection title="Custom" count={customFurniture.length} defaultOpen={customFurniture.length > 0}>
              {customFurniture.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {customFurniture.map((m) => <ItemCard key={m.id} manifest={m} />)}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-2">No custom furniture. Click &quot;+ Add&quot;.</p>
              )}
            </CollapsibleSection>
            <CollapsibleSection title="Office Pack" count={builtinSprites.length} defaultOpen={false}>
              {loadingBuiltin ? (
                <p className="text-xs text-muted-foreground">Loading sprites...</p>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {builtinSprites.map((entry) => (
                    <BuiltinSpriteCard key={entry.path} relativePath={entry.path} dataUrl={entry.dataUrl} />
                  ))}
                </div>
              )}
            </CollapsibleSection>
          </>
        )}

        {/* --- Character Tab --- */}
        {activeTab === 'character' && (
          <div className="text-sm text-muted-foreground text-center py-8">
            <p>Character sprites are managed via</p>
            <p className="mt-1">Runtime tab → Right-click → Edit → Sprite</p>
          </div>
        )}
      </div>

      {showAddModal && <AddItemModal onClose={handleCloseModal} defaultCategory={activeTab === 'tile' ? 'tile' : 'furniture'} />}
    </div>
  )
}
