import { useEffect, useState, useCallback } from 'react'
import { useCharacterStore } from './stores/character-store'
import { useRoomStore } from './stores/room-store'
import { useUIStore } from './stores/ui-store'
import { useIPCSync } from './hooks/useIPC'
import { useTheme, getPersistedTheme } from './hooks/useTheme'
import { OfficeCanvas } from './world/OfficeCanvas'
import { CharacterPanel } from './panel/CharacterPanel'
import { CreateCharacterDialog } from './components/CreateCharacterDialog'
import { CharacterContextMenu } from './components/CharacterContextMenu'
import { Sidebar } from './components/Sidebar'
import { ItemPalette } from './components/ItemPalette'
import { LayoutContextMenu } from './components/LayoutContextMenu'
import { SettingsPanel } from './components/SettingsPanel'
import { getManifestById, loadCustomManifests } from '../../shared/item-manifests'
import type { ItemManifest } from '../../shared/types'
import { GRID_COLS, GRID_ROWS } from '../../shared/constants'
import { IPC_COMMANDS } from '../../shared/ipc-channels'

export default function App(): JSX.Element {
  const selectedCharacterId = useUIStore((s) => s.selectedCharacterId)
  const selectCharacter = useUIStore((s) => s.selectCharacter)
  const activeTab = useUIStore((s) => s.activeTab)
  const setTheme = useUIStore((s) => s.setTheme)
  const loadCharacters = useCharacterStore((s) => s.loadFromMain)
  const loadRoom = useRoomStore((s) => s.loadFromMain)
  const [showCreateDialog, setShowCreateDialog] = useState(false)

  useIPCSync()
  useTheme()

  useEffect(() => {
    setTheme(getPersistedTheme())
  }, [])

  useEffect(() => {
    // Load custom manifests before loading room (so placed items can resolve their manifests)
    window.api.invoke<ItemManifest[]>(IPC_COMMANDS.MANIFEST_LIST).then((custom) => {
      if (custom && custom.length > 0) loadCustomManifests(custom)
      loadCharacters()
      loadRoom()
    })
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

      const manifestId = e.dataTransfer.getData('text/plain')
      const manifest = getManifestById(manifestId)
      if (!manifest) return

      const rect = e.currentTarget.getBoundingClientRect()
      const cellSize = Math.min(
        Math.floor(rect.width / GRID_COLS),
        Math.floor(rect.height / GRID_ROWS)
      )

      const gridX = Math.max(
        0,
        Math.min(
          GRID_COLS - manifest.footprint.w,
          Math.floor((e.clientX - rect.left) / cellSize)
        )
      )
      const gridY = Math.max(
        0,
        Math.min(
          GRID_ROWS - manifest.footprint.h,
          Math.floor((e.clientY - rect.top) / cellSize)
        )
      )

      const id = crypto.randomUUID()
      useRoomStore.getState().addItem({
        id,
        manifestId,
        position: { x: gridX, y: gridY },
        footprint: manifest.footprint,
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
            <button
              onClick={() => setShowCreateDialog(true)}
              style={{
                position: 'fixed',
                bottom: '24px',
                right: '24px',
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: '#0f3460',
                border: '1px solid #1a4a80',
                color: '#e0e0e0',
                fontSize: '24px',
                lineHeight: '1',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 200,
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
              }}
              title="Create new character"
            >
              +
            </button>
            {showCreateDialog && (
              <CreateCharacterDialog onClose={() => setShowCreateDialog(false)} />
            )}
          </>
        )}

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
