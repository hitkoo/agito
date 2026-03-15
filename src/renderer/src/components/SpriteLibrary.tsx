import { type ReactElement, useEffect, useState } from 'react'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import { Button } from './ui/button'

interface SpriteLibraryProps {
  onSelect: (spritePath: string) => void
  currentSprite?: string
}

interface SpriteListEntry {
  theme: string
  category: string
  filename: string
  relativePath: string
}

interface SpriteEntry {
  relativePath: string
  filename: string
  dataUrl: string | null
}

export function SpriteLibrary({ onSelect, currentSprite }: SpriteLibraryProps): ReactElement {
  const [sprites, setSprites] = useState<SpriteEntry[]>([])
  const [loading, setLoading] = useState(true)

  const loadSprites = async (): Promise<void> => {
    setLoading(true)
    try {
      const entries = await window.api.invoke<SpriteListEntry[]>(IPC_COMMANDS.ASSET_LIST)
      // Filter to skin sprites for the sprite library (used in character editing)
      const characterEntries = entries.filter((e) => e.category === 'skin')
      const spriteEntries: SpriteEntry[] = await Promise.all(
        characterEntries.map(async (entry) => {
          const dataUrl = await window.api.invoke<string | null>(
            IPC_COMMANDS.ASSET_READ_BASE64,
            entry.relativePath
          )
          return { relativePath: entry.relativePath, filename: entry.filename, dataUrl }
        })
      )
      setSprites(spriteEntries)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSprites()
  }, [])

  const handleUpload = async (): Promise<void> => {
    const relativePath = await window.api.invoke<string | null>(IPC_COMMANDS.ASSET_UPLOAD, 'skin')
    if (relativePath) {
      await loadSprites()
      onSelect(`assets/${relativePath}`)
    }
  }

  // Extract current relativePath from sprite path for comparison
  const currentRelPath = currentSprite?.startsWith('assets/')
    ? currentSprite.slice(7)
    : currentSprite ?? ''

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Sprite Library</span>
        <Button type="button" variant="outline" size="sm" onClick={handleUpload}>
          Upload
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading sprites...</p>
      ) : sprites.length === 0 ? (
        <p className="text-xs text-muted-foreground">No sprites found. Upload one to get started.</p>
      ) : (
        <div className="grid grid-cols-4 gap-2 max-h-[300px] overflow-y-auto styled-scroll pr-1">
          {sprites.map((entry) => (
            <button
              key={entry.relativePath}
              type="button"
              className={`flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border-2 bg-muted ${
                entry.relativePath === currentRelPath
                  ? 'border-primary'
                  : 'border-transparent hover:border-muted-foreground/40'
              }`}
              onClick={() => onSelect(`assets/${entry.relativePath}`)}
              title={entry.filename}
            >
              {entry.dataUrl ? (
                <img
                  src={entry.dataUrl}
                  alt={entry.filename}
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="text-xs text-muted-foreground">?</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
