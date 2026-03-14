import { type ReactElement, useEffect, useCallback, useState } from 'react'
import { useUIStore } from '../stores/ui-store'
import { useCharacterStore } from '../stores/character-store'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import { SUPPORTED_ENGINES } from '../../../shared/constants'
import type { EngineType } from '../../../shared/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { SpriteLibrary } from './SpriteLibrary'

export function CharacterContextMenu(): ReactElement | null {
  const contextMenu = useUIStore((s) => s.contextMenu)
  const closeContextMenu = useUIStore((s) => s.closeContextMenu)
  const characters = useCharacterStore((s) => s.characters)
  const loadCharacters = useCharacterStore((s) => s.loadFromMain)

  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [editCharacterId, setEditCharacterId] = useState<string | null>(null)

  const character = contextMenu
    ? characters.find((c) => c.id === contextMenu.characterId)
    : null

  // Close on ESC
  useEffect(() => {
    if (!contextMenu) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeContextMenu()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [contextMenu, closeContextMenu])

  // Close on click outside
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = (): void => closeContextMenu()
    // Delay attaching to avoid immediately closing
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', handleClick)
    }, 0)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousedown', handleClick)
    }
  }, [contextMenu, closeContextMenu])

  const handleStartSession = useCallback(async () => {
    if (!contextMenu) return
    closeContextMenu()
    const dir = await window.api.invoke<string | null>(IPC_COMMANDS.DIALOG_OPEN_FOLDER)
    if (!dir) return
    await window.api.invoke(IPC_COMMANDS.SESSION_START, {
      characterId: contextMenu.characterId,
      workingDirectory: dir,
    })
    await loadCharacters()
  }, [contextMenu, closeContextMenu, loadCharacters])

  const handleStopSession = useCallback(async () => {
    if (!contextMenu) return
    closeContextMenu()
    await window.api.invoke(IPC_COMMANDS.SESSION_STOP, {
      characterId: contextMenu.characterId,
    })
    await loadCharacters()
  }, [contextMenu, closeContextMenu, loadCharacters])

  const handleEdit = useCallback(() => {
    if (!contextMenu) return
    setEditCharacterId(contextMenu.characterId)
    closeContextMenu()
    setEditDialogOpen(true)
  }, [contextMenu, closeContextMenu])

  const handleDelete = useCallback(() => {
    if (!contextMenu) return
    setEditCharacterId(contextMenu.characterId)
    closeContextMenu()
    setDeleteDialogOpen(true)
  }, [contextMenu, closeContextMenu])

  // Prevent browser context menu on the canvas
  useEffect(() => {
    const preventDefault = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (target.tagName === 'CANVAS') {
        e.preventDefault()
      }
    }
    window.addEventListener('contextmenu', preventDefault)
    return () => window.removeEventListener('contextmenu', preventDefault)
  }, [])

  return (
    <>
      {contextMenu && character && (
        <div
          className="fixed z-[200] min-w-[160px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {/* Session actions */}
          {character.currentSessionId === null ? (
            <button
              className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              onClick={handleStartSession}
            >
              Start Session
            </button>
          ) : (
            <button
              className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              onClick={handleStopSession}
            >
              Stop Session
            </button>
          )}

          {/* Separator */}
          <div className="-mx-1 my-1 h-px bg-border" />

          {/* Edit */}
          <button
            className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
            onClick={handleEdit}
          >
            Edit
          </button>

          {/* Delete */}
          <button
            className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm text-destructive outline-none hover:bg-accent hover:text-accent-foreground"
            onClick={handleDelete}
          >
            Delete
          </button>
        </div>
      )}

      {/* Edit Dialog */}
      {editDialogOpen && editCharacterId && (
        <EditCharacterDialog
          characterId={editCharacterId}
          onClose={() => {
            setEditDialogOpen(false)
            setEditCharacterId(null)
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {deleteDialogOpen && editCharacterId && (
        <DeleteCharacterDialog
          characterId={editCharacterId}
          onClose={() => {
            setDeleteDialogOpen(false)
            setEditCharacterId(null)
          }}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// EditCharacterDialog
// ---------------------------------------------------------------------------

function EditCharacterDialog({
  characterId,
  onClose,
}: {
  characterId: string
  onClose: () => void
}): ReactElement | null {
  const character = useCharacterStore((s) =>
    s.characters.find((c) => c.id === characterId)
  )
  const loadCharacters = useCharacterStore((s) => s.loadFromMain)

  const [name, setName] = useState(character?.name ?? '')
  const [engine, setEngine] = useState<EngineType>(character?.engine ?? 'claude-code')
  const [soulContent, setSoulContent] = useState('')
  const [soulFiles, setSoulFiles] = useState<string[]>([])
  const [selectedSoulFile, setSelectedSoulFile] = useState('')
  const [spritePath, setSpritePath] = useState(character?.sprite ?? '')
  const [spritePreview, setSpritePreview] = useState<string | null>(null)
  const [showSpriteLibrary, setShowSpriteLibrary] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load sprite preview
  useEffect(() => {
    const loadPreview = async (): Promise<void> => {
      if (spritePath) {
        const filename = spritePath.split('/').pop() ?? ''
        if (filename) {
          const dataUrl = await window.api.invoke<string | null>(
            IPC_COMMANDS.SPRITE_READ_BASE64,
            filename
          )
          setSpritePreview(dataUrl)
        }
      } else {
        setSpritePreview(null)
      }
    }
    loadPreview()
  }, [spritePath])

  // Load soul files list and current soul content
  useEffect(() => {
    const loadSouls = async (): Promise<void> => {
      const files = await window.api.invoke<string[]>(IPC_COMMANDS.SOUL_LIST)
      setSoulFiles(files)

      if (character?.soul) {
        // soul is stored as relative path like "souls/foo.md"
        const filename = character.soul.split('/').pop() ?? ''
        setSelectedSoulFile(filename)
        if (filename) {
          const content = await window.api.invoke<string>(IPC_COMMANDS.SOUL_READ, filename)
          setSoulContent(content)
        }
      }
    }
    loadSouls()
  }, [character?.soul])

  const handleSoulFileChange = async (filename: string): Promise<void> => {
    setSelectedSoulFile(filename)
    if (filename) {
      const content = await window.api.invoke<string>(IPC_COMMANDS.SOUL_READ, filename)
      setSoulContent(content)
    } else {
      setSoulContent('')
    }
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Name is required.')
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      // Save soul content if there's a selected file
      if (selectedSoulFile && soulContent) {
        await window.api.invoke(IPC_COMMANDS.SOUL_WRITE, selectedSoulFile, soulContent)
      }

      const soulPath = selectedSoulFile ? `souls/${selectedSoulFile}` : ''
      await window.api.invoke(IPC_COMMANDS.CHARACTER_UPDATE, characterId, {
        name: trimmed,
        engine,
        soul: soulPath,
        sprite: spritePath,
      })
      await loadCharacters()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update character.')
      setIsSubmitting(false)
    }
  }

  if (!character) return null

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Edit Character</DialogTitle>
          <DialogDescription>Update character properties and soul configuration.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              disabled={isSubmitting}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-engine">Engine</Label>
            <select
              id="edit-engine"
              value={engine}
              onChange={(e) => setEngine(e.target.value as EngineType)}
              disabled={isSubmitting}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {SUPPORTED_ENGINES.map((eng) => (
                <option key={eng} value={eng}>
                  {eng}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-soul-file">Soul File</Label>
            <select
              id="edit-soul-file"
              value={selectedSoulFile}
              onChange={(e) => handleSoulFileChange(e.target.value)}
              disabled={isSubmitting}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">None</option>
              {soulFiles.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>

          {selectedSoulFile && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-soul-content">Soul Content</Label>
              <textarea
                id="edit-soul-content"
                value={soulContent}
                onChange={(e) => setSoulContent(e.target.value)}
                disabled={isSubmitting}
                rows={8}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y font-mono"
              />
            </div>
          )}

          {/* Sprite section */}
          <div className="flex flex-col gap-1.5">
            <Label>Sprite</Label>
            <div className="flex items-center gap-3">
              {spritePreview ? (
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border bg-muted">
                  <img
                    src={spritePreview}
                    alt="Current sprite"
                    className="h-full w-full object-contain"
                  />
                </div>
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-md border bg-muted">
                  <span className="text-xs text-muted-foreground">No sprite</span>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSpriteLibrary((v) => !v)}
                  disabled={isSubmitting}
                >
                  {showSpriteLibrary ? 'Hide Library' : 'Change'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const filename = await window.api.invoke<string | null>(IPC_COMMANDS.SPRITE_UPLOAD)
                    if (filename) setSpritePath(`sprites/${filename}`)
                  }}
                  disabled={isSubmitting}
                >
                  Upload
                </Button>
                {spritePath && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSpritePath('')}
                    disabled={isSubmitting}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
            {showSpriteLibrary && (
              <div className="mt-2">
                <SpriteLibrary
                  onSelect={(path) => {
                    setSpritePath(path)
                    setShowSpriteLibrary(false)
                  }}
                  currentSprite={spritePath}
                />
              </div>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" variant="default" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// DeleteCharacterDialog
// ---------------------------------------------------------------------------

function DeleteCharacterDialog({
  characterId,
  onClose,
}: {
  characterId: string
  onClose: () => void
}): ReactElement | null {
  const character = useCharacterStore((s) =>
    s.characters.find((c) => c.id === characterId)
  )
  const loadCharacters = useCharacterStore((s) => s.loadFromMain)
  const selectCharacter = useUIStore((s) => s.selectCharacter)
  const selectedCharacterId = useUIStore((s) => s.selectedCharacterId)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async (): Promise<void> => {
    setIsDeleting(true)
    try {
      await window.api.invoke(IPC_COMMANDS.CHARACTER_DELETE, characterId)
      if (selectedCharacterId === characterId) {
        selectCharacter(null)
      }
      await loadCharacters()
      onClose()
    } catch {
      setIsDeleting(false)
    }
  }

  if (!character) return null

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Delete Character</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete &quot;{character.name}&quot;? This action cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
