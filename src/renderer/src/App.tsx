import { useEffect, useCallback } from 'react'
import { useCharacterStore } from './stores/character-store'
import { useRoomStore } from './stores/room-store'
import { useUIStore } from './stores/ui-store'
import { useIPCSync } from './hooks/useIPC'
import { useTheme, getPersistedTheme } from './hooks/useTheme'
import { OfficeCanvas } from './world/OfficeCanvas'
import { CharacterPanel } from './panel/CharacterPanel'
import { CharacterContextMenu } from './components/CharacterContextMenu'
import { CharactersPanel } from './components/CharactersPanel'
import { Sidebar } from './components/Sidebar'
import { ItemPalette } from './components/ItemPalette'
import { LayoutContextMenu } from './components/LayoutContextMenu'
import { SettingsPanel } from './components/SettingsPanel'

export default function App(): JSX.Element {
  const selectedCharacterId = useUIStore((s) => s.selectedCharacterId)
  const selectCharacter = useUIStore((s) => s.selectCharacter)
  const activeTab = useUIStore((s) => s.activeTab)
  const setTheme = useUIStore((s) => s.setTheme)
  const loadCharacters = useCharacterStore((s) => s.loadFromMain)
  const loadRoom = useRoomStore((s) => s.loadFromMain)

  useIPCSync()
  useTheme()

  useEffect(() => {
    setTheme(getPersistedTheme())
  }, [])

  useEffect(() => {
    loadCharacters()
    loadRoom()
  }, [loadCharacters, loadRoom])

  useEffect(() => {
    if (activeTab !== 'runtime') return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && selectedCharacterId !== null) {
        selectCharacter(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeTab, selectedCharacterId, selectCharacter])

  const setDraggingManifestId = useUIStore((s) => s.setDraggingManifestId)

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (activeTab !== 'layout') return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    [activeTab]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (activeTab !== 'layout') return
      e.preventDefault()

      const relativePath = e.dataTransfer.getData('text/plain')
      if (!relativePath) return

      // Derive category from path: "{theme}/{category}/{filename}"
      const parts = relativePath.split('/')
      const theme = parts[0] ?? 'custom'
      const category = parts.length >= 2 ? parts[1] : 'furniture'

      // Default footprints: office pack = 2x3, custom = 2x2
      const footprint = theme === 'office' ? { w: 2, h: 3 } : { w: 2, h: 2 }

      const { gridCols, gridRows } = useRoomStore.getState()
      const rect = e.currentTarget.getBoundingClientRect()
      const cellSize = Math.min(
        Math.floor(rect.width / gridCols),
        Math.floor(rect.height / gridRows)
      )

      const gridX = Math.max(
        0,
        Math.min(
          gridCols - footprint.w,
          Math.floor((e.clientX - rect.left) / cellSize)
        )
      )
      const gridY = Math.max(
        0,
        Math.min(
          gridRows - footprint.h,
          Math.floor((e.clientY - rect.top) / cellSize)
        )
      )

      const id = crypto.randomUUID()
      useRoomStore.getState().addItem({
        id,
        manifestId: relativePath,
        position: { x: gridX, y: gridY },
        footprint,
      })
      setDraggingManifestId(null)
    },
    [activeTab, setDraggingManifestId]
  )

  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <main className="flex-1 relative h-full overflow-hidden">
        <div
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className="w-full h-full"
        >
          <OfficeCanvas />
        </div>

        {activeTab === 'runtime' && (
          <>
            {selectedCharacterId !== null && (
              <div
                onClick={() => selectCharacter(null)}
                className="absolute inset-0 bg-black/40 z-[50]"
              />
            )}
            {selectedCharacterId && (
              <CharacterPanel characterId={selectedCharacterId} />
            )}
            <CharacterContextMenu />
          </>
        )}

        {activeTab === 'characters' && <CharactersPanel />}

        {activeTab === 'layout' && (
          <>
            <ItemPalette />
            <LayoutContextMenu />
          </>
        )}

        {activeTab === 'settings' && <SettingsPanel />}
      </main>
    </div>
  )
}
