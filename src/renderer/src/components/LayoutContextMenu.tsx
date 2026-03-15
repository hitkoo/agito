import { type ReactElement, useEffect, useCallback } from 'react'
import { useUIStore } from '../stores/ui-store'
import { useRoomStore } from '../stores/room-store'
import { useCharacterStore } from '../stores/character-store'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'

export function LayoutContextMenu(): ReactElement | null {
  const ctx = useUIStore((s) => s.layoutContextMenu)
  const close = useUIStore((s) => s.closeLayoutContextMenu)
  const items = useRoomStore((s) => s.layout.items)
  const characters = useCharacterStore((s) => s.characters)

  // Close on ESC
  useEffect(() => {
    if (!ctx) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [ctx, close])

  // Close on click outside
  useEffect(() => {
    if (!ctx) return
    const handleClick = (): void => close()
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', handleClick)
    }, 0)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousedown', handleClick)
    }
  }, [ctx, close])

  const handleCopy = useCallback(() => {
    if (!ctx) return
    if (ctx.type === 'furniture') {
      const item = items.find((i) => i.id === ctx.id)
      if (item) {
        useUIStore.getState().setLayoutClipboard({
          type: 'furniture',
          manifestId: item.manifestId,
          footprint: { w: item.footprint.w, h: item.footprint.h },
        })
      }
    } else {
      const char = characters.find((c) => c.id === ctx.id)
      if (char) {
        useUIStore.getState().setLayoutClipboard({
          type: 'character',
          id: char.id,
          name: char.name,
        })
      }
    }
    close()
  }, [ctx, items, characters, close])

  const handleDelete = useCallback(async () => {
    if (!ctx) return
    if (ctx.type === 'furniture') {
      useRoomStore.getState().removeItem(ctx.id)
    } else {
      // Unplace character (set gridPosition to null), don't delete it
      await window.api.invoke(IPC_COMMANDS.CHARACTER_UPDATE, ctx.id, { gridPosition: null })
      useCharacterStore.getState().loadFromMain()
    }
    useUIStore.getState().selectLayoutItem(null)
    close()
  }, [ctx, close])

  if (!ctx) return null

  return (
    <div
      className="fixed z-[200] bg-popover border border-border rounded-md shadow-lg p-1 min-w-[140px]"
      style={{ left: ctx.x, top: ctx.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        className="flex w-full cursor-default select-none items-center rounded-sm px-3 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
        onClick={handleCopy}
      >
        Copy
      </button>
      <button
        className="flex w-full cursor-default select-none items-center rounded-sm px-3 py-1.5 text-sm text-destructive outline-none hover:bg-accent hover:text-accent-foreground"
        onClick={handleDelete}
      >
        Delete
      </button>
    </div>
  )
}
