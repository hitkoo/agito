import { useEffect, useCallback } from 'react'
import { useCharacterStore } from './stores/character-store'
import { useRoomStore } from './stores/room-store'
import { useUIStore } from './stores/ui-store'
import { IPC_COMMANDS } from '../../shared/ipc-channels'
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
    async (e: React.DragEvent<HTMLDivElement>) => {
      if (activeTab !== 'layout') return
      e.preventDefault()

      const dragData = e.dataTransfer.getData('text/plain')
      if (!dragData) return

      const { gridCols, gridRows } = useRoomStore.getState()
      const rect = e.currentTarget.getBoundingClientRect()
      const cellSize = Math.min(
        Math.floor(rect.width / gridCols),
        Math.floor(rect.height / gridRows)
      )

      const calcGridPos = (fw: number, fh: number) => ({
        x: Math.max(0, Math.min(gridCols - fw, Math.floor((e.clientX - rect.left) / cellSize))),
        y: Math.max(0, Math.min(gridRows - fh, Math.floor((e.clientY - rect.top) / cellSize))),
      })

      // Character drag-and-drop placement
      if (dragData.startsWith('__character__:')) {
        const characterId = dragData.slice('__character__:'.length)
        const fw = 2, fh = 2 // default character footprint
        const pos = calcGridPos(fw, fh)
        await window.api.invoke(IPC_COMMANDS.CHARACTER_UPDATE, characterId, { gridPosition: pos })
        useCharacterStore.getState().loadFromMain()
        setDraggingManifestId(null)
        return
      }

      // Furniture/background drag-and-drop
      const parts = dragData.split('/')
      const theme = parts[0] ?? 'custom'
      const footprint = theme === 'office' ? { w: 2, h: 3 } : { w: 2, h: 2 }
      const pos = calcGridPos(footprint.w, footprint.h)

      const id = crypto.randomUUID()
      useRoomStore.getState().addItem({
        id,
        manifestId: dragData,
        position: pos,
        footprint,
      })
      setDraggingManifestId(null)
    },
    [activeTab, setDraggingManifestId]
  )

  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <main className="flex-1 flex h-full overflow-hidden relative">
        <div
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className="flex-1 h-full relative"
        >
          <OfficeCanvas />

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

          {activeTab === 'layout' && <LayoutContextMenu />}
        </div>

        {activeTab === 'layout' && <ItemPalette />}

        {activeTab === 'characters' && <CharactersPanel />}

        {activeTab === 'settings' && <SettingsPanel />}
      </main>
    </div>
  )
}
