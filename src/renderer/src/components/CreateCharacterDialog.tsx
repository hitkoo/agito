import { useState } from 'react'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import { useCharacterStore } from '../stores/character-store'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'

interface CreateCharacterDialogProps {
  onClose: () => void
}

export function CreateCharacterDialog({ onClose }: CreateCharacterDialogProps): JSX.Element {
  const [name, setName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadCharacters = useCharacterStore((s) => s.loadFromMain)

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
      await window.api.invoke(IPC_COMMANDS.CHARACTER_CREATE, { name: trimmed })
      await loadCharacters()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create character.')
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle>New Character</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="char-name">Name</Label>
            <Input
              id="char-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alice"
              autoFocus
              disabled={isSubmitting}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" variant="default" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
