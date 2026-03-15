import { useState, useEffect, useCallback } from 'react'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import { Button } from './ui/button'

interface SkinEntry {
  theme: string
  category: string
  filename: string
  relativePath: string
  source?: 'builtin' | 'custom'
}

interface SkinPickerModalProps {
  currentSkin: string
  onSelect: (path: string) => void
  onClose: () => void
}

export function SkinPickerModal({ currentSkin, onSelect, onClose }: SkinPickerModalProps): JSX.Element {
  const [skins, setSkins] = useState<SkinEntry[]>([])
  const [previews, setPreviews] = useState<Map<string, string>>(new Map())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const loadSkins = useCallback(async () => {
    const entries = await window.api.invoke<SkinEntry[]>(IPC_COMMANDS.ASSET_LIST)
    const skinEntries = (entries ?? []).filter((e) => e.category === 'skin')
    setSkins(skinEntries)

    // Load previews in batches
    const urlMap = new Map<string, string>()
    for (let i = 0; i < skinEntries.length; i += 10) {
      const batch = skinEntries.slice(i, i + 10)
      const results = await Promise.all(
        batch.map(async (entry) => {
          const data = await window.api.invoke<string | null>(IPC_COMMANDS.ASSET_READ_BASE64, entry.relativePath)
          return { key: entry.relativePath, data }
        })
      )
      for (const r of results) {
        if (r.data) urlMap.set(r.key, r.data)
      }
      setPreviews(new Map(urlMap))
    }
  }, [])

  useEffect(() => { loadSkins() }, [loadSkins])

  // Group by theme
  const themeGroups = new Map<string, SkinEntry[]>()
  for (const s of skins) {
    const existing = themeGroups.get(s.theme) ?? []
    existing.push(s)
    themeGroups.set(s.theme, existing)
  }

  const themeOrder = [...themeGroups.keys()].sort((a, b) => {
    if (a === 'custom') return 1
    if (b === 'custom') return -1
    return a.localeCompare(b)
  })

  const toggleCollapse = (theme: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(theme) ? next.delete(theme) : next.add(theme)
      return next
    })
  }

  const handleUpload = useCallback(async () => {
    const relativePath = await window.api.invoke<string | null>(IPC_COMMANDS.ASSET_UPLOAD, 'skin')
    if (relativePath) {
      await loadSkins()
    }
  }, [loadSkins])

  const handleSelect = useCallback((relativePath: string) => {
    onSelect(`assets/${relativePath}`)
    onClose()
  }, [onSelect, onClose])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[80vh] rounded-lg border border-border bg-background shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h3 className="text-base font-semibold">Select Skin</h3>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleUpload}>Upload</Button>
            <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto styled-scroll p-4 space-y-3">
          {themeOrder.map((theme) => {
            const entries = themeGroups.get(theme) ?? []
            const isBuiltin = entries[0]?.source === 'builtin'
            const isCollapsed = collapsed.has(theme)
            const themeLabel = theme.charAt(0).toUpperCase() + theme.slice(1)

            return (
              <section key={theme} className="space-y-2">
                <button
                  onClick={() => toggleCollapse(theme)}
                  className="flex items-center gap-1.5 w-full text-left group"
                >
                  <span
                    className="text-[10px] text-muted-foreground transition-transform"
                    style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}
                  >
                    ▶
                  </span>
                  <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wider group-hover:text-foreground transition-colors">
                    {themeLabel} ({entries.length})
                  </span>
                  {isBuiltin && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                      built-in
                    </span>
                  )}
                </button>
                {!isCollapsed && (
                  <div className="grid grid-cols-4 gap-1.5">
                    {entries.map((entry) => {
                      const preview = previews.get(entry.relativePath)
                      const isSelected = currentSkin === `assets/${entry.relativePath}`
                      const displayName = entry.filename.replace(/\.[^.]+$/, '')
                      return (
                        <button
                          key={entry.relativePath}
                          onClick={() => handleSelect(entry.relativePath)}
                          className={`rounded-lg bg-secondary p-1.5 flex flex-col items-center gap-1 border transition-colors ${
                            isSelected
                              ? 'border-primary bg-primary/10'
                              : 'border-transparent hover:border-muted-foreground/30'
                          }`}
                        >
                          <div className="w-full aspect-square rounded bg-muted/50 flex items-center justify-center overflow-hidden">
                            {preview ? (
                              <img src={preview} alt={displayName} className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
                            ) : (
                              <span className="text-2xl text-muted-foreground/40">?</span>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground text-center truncate w-full">{displayName}</p>
                        </button>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
          {skins.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No skins available. Upload one.</p>
          )}
        </div>
      </div>
    </div>
  )
}
