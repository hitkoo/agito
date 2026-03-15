import { type ReactElement, useEffect, useState, useCallback } from 'react'
import { useCharacterStore } from '../stores/character-store'
import { useUIStore } from '../stores/ui-store'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import { SUPPORTED_ENGINES } from '../../../shared/constants'
import type { Character, EngineType } from '../../../shared/types'
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
import { CreateCharacterDialog } from './CreateCharacterDialog'

// ---------------------------------------------------------------------------
// Sprite preview hook
// ---------------------------------------------------------------------------

function useSpritePreview(spritePath: string): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!spritePath) {
      setDataUrl(null)
      return
    }
    const relPath = spritePath.startsWith('assets/')
      ? spritePath.slice(7)
      : spritePath
    window.api
      .invoke<string | null>(IPC_COMMANDS.ASSET_READ_BASE64, relPath)
      .then(setDataUrl)
  }, [spritePath])
  return dataUrl
}

// ---------------------------------------------------------------------------
// Status dot colours
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  working: 'bg-green-500',
  idle: 'bg-gray-400',
  error: 'bg-red-500',
  waiting: 'bg-yellow-500',
  done: 'bg-green-500',
}

// ---------------------------------------------------------------------------
// CharacterListCard (left panel item)
// ---------------------------------------------------------------------------

function CharacterListCard({
  character,
  isSelected,
  onSelect,
}: {
  character: Character
  isSelected: boolean
  onSelect: (id: string) => void
}): ReactElement {
  const preview = useSpritePreview(character.skin)

  return (
    <button
      type="button"
      onClick={() => onSelect(character.id)}
      className={`flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors hover:bg-accent/50 ${
        isSelected ? 'border-primary bg-accent/30' : 'border-border'
      }`}
    >
      {/* Sprite thumbnail 48x48 */}
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
        {preview ? (
          <img
            src={preview}
            alt={character.name}
            className="h-full w-full object-contain"
            style={{ imageRendering: 'pixelated' }}
          />
        ) : (
          <span className="text-xs text-muted-foreground">?</span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-sm truncate">{character.name}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs text-muted-foreground">{character.engine}</span>
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${STATUS_COLORS[character.status] ?? STATUS_COLORS.idle}`}
            title={character.status}
          />
          <span className="text-[10px] text-muted-foreground">{character.status}</span>
        </div>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// DeleteConfirmDialog
// ---------------------------------------------------------------------------

function DeleteConfirmDialog({
  characterId,
  onClose,
  onDeleted,
}: {
  characterId: string
  onClose: () => void
  onDeleted: () => void
}): ReactElement | null {
  const character = useCharacterStore((s) =>
    s.characters.find((c) => c.id === characterId)
  )
  const loadCharacters = useCharacterStore((s) => s.loadFromMain)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async (): Promise<void> => {
    setIsDeleting(true)
    try {
      await window.api.invoke(IPC_COMMANDS.CHARACTER_DELETE, characterId)
      await loadCharacters()
      onDeleted()
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

// ---------------------------------------------------------------------------
// EditDetailPanel (right panel inline form)
// ---------------------------------------------------------------------------

function EditDetailPanel({
  characterId,
  onDeselect,
}: {
  characterId: string
  onDeselect: () => void
}): ReactElement | null {
  const character = useCharacterStore((s) =>
    s.characters.find((c) => c.id === characterId)
  )
  const loadCharacters = useCharacterStore((s) => s.loadFromMain)

  // Local form state
  const [name, setName] = useState('')
  const [engine, setEngine] = useState<EngineType>('claude-code')
  const [soulFiles, setSoulFiles] = useState<string[]>([])
  const [selectedSoulFile, setSelectedSoulFile] = useState('')
  const [spritePath, setSpritePath] = useState('')
  const [spritePreview, setSpritePreview] = useState<string | null>(null)
  const [showSpriteLibrary, setShowSpriteLibrary] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteCharacterId, setDeleteCharacterId] = useState<string | null>(null)

  // Reset form when character changes
  useEffect(() => {
    if (!character) return
    setName(character.name)
    setEngine(character.engine)
    setSpritePath(character.skin)
    setShowSpriteLibrary(false)
    setError(null)
    setIsSubmitting(false)

    // Determine soul file from character.soul path
    if (character.soul) {
      const filename = character.soul.split('/').pop() ?? ''
      setSelectedSoulFile(filename)
    } else {
      setSelectedSoulFile('')
    }
  }, [character?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load soul files list
  useEffect(() => {
    window.api.invoke<string[]>(IPC_COMMANDS.SOUL_LIST).then(setSoulFiles)
  }, [])

  // Load sprite preview
  useEffect(() => {
    if (spritePath) {
      const relPath = spritePath.startsWith('assets/')
        ? spritePath.slice(7)
        : spritePath
      if (relPath) {
        window.api
          .invoke<string | null>(IPC_COMMANDS.ASSET_READ_BASE64, relPath)
          .then(setSpritePreview)
      } else {
        setSpritePreview(null)
      }
    } else {
      setSpritePreview(null)
    }
  }, [spritePath])

  const handleCancel = useCallback(() => {
    if (!character) return
    setName(character.name)
    setEngine(character.engine)
    setSpritePath(character.skin)
    setShowSpriteLibrary(false)
    setError(null)

    if (character.soul) {
      const filename = character.soul.split('/').pop() ?? ''
      setSelectedSoulFile(filename)
    } else {
      setSelectedSoulFile('')
    }
  }, [character])

  const handleSave = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Name is required.')
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      const soulPath = selectedSoulFile ? `souls/${selectedSoulFile}` : ''
      await window.api.invoke(IPC_COMMANDS.CHARACTER_UPDATE, characterId, {
        name: trimmed,
        engine,
        soul: soulPath,
        skin: spritePath,
      })
      await loadCharacters()
      setIsSubmitting(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update character.')
      setIsSubmitting(false)
    }
  }

  if (!character) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Character not found.
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Header */}
      <div className="border-b border-border p-4">
        <h2 className="text-base font-semibold">Edit: {character.name}</h2>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cp-edit-name">Name</Label>
          <Input
            id="cp-edit-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isSubmitting}
          />
        </div>

        {/* Engine */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cp-edit-engine">Engine</Label>
          <select
            id="cp-edit-engine"
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

        {/* Soul File */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cp-edit-soul-file">Soul File</Label>
          <select
            id="cp-edit-soul-file"
            value={selectedSoulFile}
            onChange={(e) => setSelectedSoulFile(e.target.value)}
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

        {/* Sprite */}
        <div className="flex flex-col gap-1.5">
          <Label>Sprite</Label>
          <div className="flex items-center gap-3">
            {spritePreview ? (
              <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border bg-muted">
                <img
                  src={spritePreview}
                  alt="Current sprite"
                  className="h-full w-full object-contain"
                  style={{ imageRendering: 'pixelated' }}
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
                  const relativePath = await window.api.invoke<string | null>(IPC_COMMANDS.ASSET_UPLOAD, 'skin')
                  if (relativePath) setSpritePath(`assets/${relativePath}`)
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
      </div>

      {/* Footer buttons */}
      <div className="flex items-center border-t border-border p-4">
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setDeleteCharacterId(characterId)}
          disabled={isSubmitting}
        >
          Delete
        </Button>
        <div className="flex-1" />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="default" size="sm" onClick={handleSave} disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {deleteCharacterId && (
        <DeleteConfirmDialog
          characterId={deleteCharacterId}
          onClose={() => setDeleteCharacterId(null)}
          onDeleted={onDeselect}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CharactersPanel (main export)
// ---------------------------------------------------------------------------

export function CharactersPanel(): ReactElement {
  const characters = useCharacterStore((s) => s.characters)
  const loadCharacters = useCharacterStore((s) => s.loadFromMain)

  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Refresh character list on mount
  useEffect(() => {
    loadCharacters()
  }, [loadCharacters])

  return (
    <div className="absolute inset-0 z-[40] bg-background flex">
      {/* Left panel - Character list */}
      <div className="flex w-[280px] shrink-0 flex-col border-r border-border">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-border">
          <h2 className="text-sm font-semibold">Characters</h2>
          <Button variant="outline" size="sm" onClick={() => setShowCreateDialog(true)}>
            + New
          </Button>
        </div>

        {/* Character list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {characters.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              No characters yet. Click &quot;+ New&quot; to create one.
            </p>
          ) : (
            characters.map((character) => (
              <CharacterListCard
                key={character.id}
                character={character}
                isSelected={selectedId === character.id}
                onSelect={setSelectedId}
              />
            ))
          )}
        </div>
      </div>

      {/* Right panel - Detail/Edit */}
      {selectedId ? (
        <EditDetailPanel
          key={selectedId}
          characterId={selectedId}
          onDeselect={() => setSelectedId(null)}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Select a character to edit
        </div>
      )}

      {/* Create dialog */}
      {showCreateDialog && (
        <CreateCharacterDialog onClose={() => setShowCreateDialog(false)} />
      )}
    </div>
  )
}
