import { useEffect, useCallback } from 'react'
import { useCharacterStore } from './stores/character-store'
import { useRoomStore } from './stores/room-store'
import { useUIStore } from './stores/ui-store'
import { IPC_COMMANDS } from '../../shared/ipc-channels'

/**
 * Calculate footprint from image aspect ratio.
 * Formula: n = max(w,h)/min(w,h), m = floor(sqrt(threshold/n)), footprint = round(n*m) × m
 * Threshold: background=144, furniture/skin=36
 */
async function calcFootprintFromAsset(
  dragData: string,
  category: string
): Promise<{ w: number; h: number }> {
  const fallback = { w: 2, h: 2 }
  try {
    // For characters, extract skin path from character data
    let relativePath = dragData
    if (dragData.startsWith('__character__:')) {
      // Load character to get skin path
      const charId = dragData.slice('__character__:'.length)
      const data = await window.api.invoke<{ characters: { id: string; skin: string }[] }>(IPC_COMMANDS.STORE_READ)
      const char = data?.characters?.find((c) => c.id === charId)
      if (!char?.skin) return fallback
      relativePath = char.skin.startsWith('assets/') ? char.skin.slice(7) : char.skin
    }

    const dataUrl = await window.api.invoke<string | null>(IPC_COMMANDS.ASSET_READ_BASE64, relativePath)
    if (!dataUrl) return fallback

    // Get image dimensions
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject()
      img.src = dataUrl
    })

    const imgW = img.naturalWidth
    const imgH = img.naturalHeight
    if (!imgW || !imgH) return fallback

    const isLandscape = imgW >= imgH
    const n = isLandscape ? imgW / imgH : imgH / imgW
    const threshold = category === 'background' ? 144 : 36
    const m = Math.max(1, Math.floor(Math.sqrt(threshold / n)))
    const long = Math.max(1, Math.round(n * m))

    return isLandscape ? { w: long, h: m } : { w: m, h: long }
  } catch {
    return fallback
  }
}
import { useIPCSync } from './hooks/useIPC'
import { useTerminalDockSync } from './hooks/useTerminalDockSync'
import { useTheme, getPersistedTheme } from './hooks/useTheme'
import { OfficeCanvas } from './world/OfficeCanvas'
import { TerminalDock } from './panel/TerminalDock'
import { CharacterContextMenu } from './components/CharacterContextMenu'
import { CharactersPanel } from './components/CharactersPanel'
import { Sidebar } from './components/Sidebar'
import { ItemPalette } from './components/ItemPalette'
import { LayoutContextMenu } from './components/LayoutContextMenu'
import { SettingsPanel } from './components/SettingsPanel'
import { GeneratePanel } from './components/GeneratePanel'
import { Toaster } from 'sonner'

export default function App(): JSX.Element {
  const activeTab = useUIStore((s) => s.activeTab)
  const setTheme = useUIStore((s) => s.setTheme)
  const loadCharacters = useCharacterStore((s) => s.loadFromMain)
  const loadRoom = useRoomStore((s) => s.loadFromMain)

  useIPCSync()
  useTerminalDockSync()
  useTheme()

  useEffect(() => {
    setTheme(getPersistedTheme())
  }, [])

  useEffect(() => {
    loadCharacters()
    loadRoom()
  }, [loadCharacters, loadRoom])

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

      // Find the actual canvas element inside the container for accurate positioning
      const containerRect = e.currentTarget.getBoundingClientRect()
      const canvas = e.currentTarget.querySelector('canvas')
      const rect = canvas ? canvas.getBoundingClientRect() : containerRect

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
        const footprint = await calcFootprintFromAsset(dragData, 'skin')
        const pos = calcGridPos(footprint.w, footprint.h)
        await window.api.invoke(IPC_COMMANDS.CHARACTER_UPDATE, characterId, {
          gridPosition: pos,
          footprint,
        })
        useCharacterStore.getState().loadFromMain()
        setDraggingManifestId(null)
        return
      }

      // Furniture/background drag-and-drop — calculate footprint from image ratio
      const parts = dragData.split('/')
      const category = parts.length >= 2 ? parts[1] : 'furniture'
      const footprint = await calcFootprintFromAsset(dragData, category)
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
      <Toaster position="top-center" richColors theme="dark" />
      <Sidebar />
      <main className="flex-1 flex h-full overflow-hidden relative">
        <div
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className="flex-1 h-full relative"
        >
          <OfficeCanvas />

          {activeTab === 'runtime' && <CharacterContextMenu />}

          {/* Terminal dock — overlay on canvas, visible in any tab */}
          <TerminalDock />

          {activeTab === 'layout' && <LayoutContextMenu />}
        </div>

        {activeTab === 'layout' && <ItemPalette />}

        {activeTab === 'generate' && <GeneratePanel />}

        {activeTab === 'characters' && <CharactersPanel />}

        {activeTab === 'settings' && <SettingsPanel />}
      </main>
    </div>
  )
}
