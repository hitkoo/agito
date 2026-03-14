import { type ReactElement, useEffect, useState } from 'react'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import { Button } from './ui/button'

interface SpriteLibraryProps {
  onSelect: (spritePath: string) => void
  currentSprite?: string
}

interface SpriteEntry {
  filename: string
  dataUrl: string | null
}

export function SpriteLibrary({ onSelect, currentSprite }: SpriteLibraryProps): ReactElement {
  const [sprites, setSprites] = useState<SpriteEntry[]>([])
  const [loading, setLoading] = useState(true)

  const loadSprites = async (): Promise<void> => {
    setLoading(true)
    try {
      const files = await window.api.invoke<string[]>(IPC_COMMANDS.SPRITE_LIST)
      const entries: SpriteEntry[] = await Promise.all(
        files.map(async (filename) => {
          const dataUrl = await window.api.invoke<string | null>(
            IPC_COMMANDS.SPRITE_READ_BASE64,
            filename
          )
          return { filename, dataUrl }
        })
      )
      setSprites(entries)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSprites()
  }, [])

  const handleUpload = async (): Promise<void> => {
    const filename = await window.api.invoke<string | null>(IPC_COMMANDS.SPRITE_UPLOAD)
    if (filename) {
      await loadSprites()
      onSelect(`sprites/${filename}`)
    }
  }

  // Extract current filename from sprite path for comparison
  const currentFilename = currentSprite?.split('/').pop() ?? ''

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
        <div className="grid grid-cols-4 gap-2 max-h-[300px] overflow-y-auto pr-1">
          {sprites.map((entry) => (
            <button
              key={entry.filename}
              type="button"
              className={`flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border-2 bg-muted ${
                entry.filename === currentFilename
                  ? 'border-primary'
                  : 'border-transparent hover:border-muted-foreground/40'
              }`}
              onClick={() => onSelect(`sprites/${entry.filename}`)}
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
