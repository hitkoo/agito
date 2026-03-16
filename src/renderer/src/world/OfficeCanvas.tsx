import { Stage, Container, Graphics, Text, Sprite, useTick } from '@pixi/react'
import { type ReactElement, useCallback, useMemo, useState, useEffect, useRef } from 'react'
import { Graphics as PixiGraphics, TextStyle, Container as PixiContainer, Texture } from 'pixi.js'
import { loadTexture } from './AssetLoader'
import { useCharacterStore } from '../stores/character-store'
import { useRuntimeStore } from '../stores/runtime-store'
import { useUIStore, type AppTab, type ThemeMode } from '../stores/ui-store'
import { useRoomStore } from '../stores/room-store'
import type {
  Character,
  CharacterStatus,
  PlacedItem,
  ItemManifest,
  GridPosition,
  ItemFootprint,
} from '../../../shared/types'
import type { CharacterRuntimeState } from '../../../shared/character-runtime-state'
import { getManifestById } from '../../../shared/item-manifests'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

interface ColorPalette {
  canvasBg: number
  wall: number
  floorA: number
  floorB: number
  grid: number
}

const DARK_PALETTE: ColorPalette = {
  canvasBg: 0x302f33,
  wall: 0x272629,
  floorA: 0x363539,
  floorB: 0x333236,
  grid: 0x454449,
}

const LIGHT_PALETTE: ColorPalette = {
  canvasBg: 0xf0f0f0,
  wall: 0xe0e0e0,
  floorA: 0xe8e8ec,
  floorB: 0xe2e2e6,
  grid: 0xd0d0d8,
}

function getEffectiveMode(theme: ThemeMode): 'dark' | 'light' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

const STATUS_COLORS: Record<CharacterStatus, number> = {
  no_session: 0x6c757d,
  idle: 0x7c8591,
  running: 0x4ecdc4,
  need_input: 0xffd93d,
  need_approval: 0xffb347,
  done: 0x51cf66,
  error: 0xff6b6b,
}

// ---------------------------------------------------------------------------
// Collision helper
// ---------------------------------------------------------------------------

function checkCollision(
  position: GridPosition,
  footprint: ItemFootprint,
  occupiedCells: Set<string>,
  excludeItemId?: string,
  allItems?: PlacedItem[]
): boolean {
  // Build a set of cells to exclude (belonging to the item being moved)
  const excludeCells = new Set<string>()
  if (excludeItemId && allItems) {
    const excluded = allItems.find((i) => i.id === excludeItemId)
    if (excluded) {
      for (let dy = 0; dy < excluded.footprint.h; dy++) {
        for (let dx = 0; dx < excluded.footprint.w; dx++) {
          excludeCells.add(`${excluded.position.x + dx},${excluded.position.y + dy}`)
        }
      }
    }
  }

  for (let dy = 0; dy < footprint.h; dy++) {
    for (let dx = 0; dx < footprint.w; dx++) {
      const key = `${position.x + dx},${position.y + dy}`
      if (occupiedCells.has(key) && !excludeCells.has(key)) {
        return true
      }
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// useWindowSize
// ---------------------------------------------------------------------------

function useContainerSize(ref: React.RefObject<HTMLDivElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 800, height: 600 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
      }
    })
    ro.observe(el)
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [ref])

  return size
}

// ---------------------------------------------------------------------------
// BackgroundLayer
// ---------------------------------------------------------------------------

function BackgroundLayer({
  cellSize,
  palette,
  activeTab,
  gridCols,
  gridRows,
}: {
  cellSize: number
  palette: ColorPalette
  activeTab: AppTab
  gridCols: number
  gridRows: number
}): ReactElement {
  const draw = useCallback(
    (g: PixiGraphics) => {
      g.clear()

      if (activeTab === 'runtime') {
        // Runtime mode: solid background only — no grid lines
        return
      }

      // Layout mode: checkerboard grid for placement guide
      for (let row = 0; row < gridRows; row++) {
        for (let col = 0; col < gridCols; col++) {
          const isEven = (row + col) % 2 === 0
          g.beginFill(isEven ? palette.floorA : palette.floorB, 1)
          g.drawRect(col * cellSize, row * cellSize, cellSize, cellSize)
          g.endFill()
        }
      }
      // Grid lines on top
      g.lineStyle(1, palette.grid, 0.2)
      for (let x = 0; x <= gridCols; x++) {
        g.moveTo(x * cellSize, 0)
        g.lineTo(x * cellSize, gridRows * cellSize)
      }
      for (let y = 0; y <= gridRows; y++) {
        g.moveTo(0, y * cellSize)
        g.lineTo(gridCols * cellSize, y * cellSize)
      }
    },
    [cellSize, palette, activeTab, gridCols, gridRows]
  )

  return <Graphics draw={draw} />
}

// ---------------------------------------------------------------------------
// Status effect sub-components (animated)
// ---------------------------------------------------------------------------

// Idle: breathing scale animation applied via parent Container ref
function IdleEffect({
  w,
  h,
  color,
}: {
  w: number
  h: number
  color: number
}): ReactElement {
  const elapsed = useRef(0)
  const containerRef = useRef<import('pixi.js').Container | null>(null)

  useTick((delta) => {
    elapsed.current += delta
    if (containerRef.current) {
      const scale = 1 + 0.02 * Math.sin((elapsed.current / 60) * Math.PI)
      containerRef.current.scale.set(scale)
      containerRef.current.pivot.set(w / 2, h / 2)
      containerRef.current.position.set(w / 2, h / 2)
    }
  })

  const draw = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      g.beginFill(color, 0.8)
      g.drawRoundedRect(4, 4, w - 8, h - 8, 8)
      g.endFill()
      g.lineStyle(2, 0xffffff, 0.4)
      g.drawRoundedRect(4, 4, w - 8, h - 8, 8)
    },
    [w, h, color]
  )

  return (
    <Container ref={containerRef}>
      <Graphics draw={draw} />
    </Container>
  )
}

// Working: pulsing glow + blinking activity dot
function WorkingEffect({ w, h, color }: { w: number; h: number; color: number }): ReactElement {
  const elapsed = useRef(0)
  const glowRef = useRef<PixiGraphics | null>(null)
  const dotRef = useRef<PixiGraphics | null>(null)

  useTick((delta) => {
    elapsed.current += delta
    const t = elapsed.current / 60

    if (glowRef.current) {
      const alpha = 0.2 + 0.4 * ((Math.sin(t * Math.PI * 2) + 1) / 2)
      glowRef.current.alpha = alpha
    }
    if (dotRef.current) {
      const blinkAlpha = Math.sin(t * Math.PI * 3) > 0 ? 1 : 0.1
      dotRef.current.alpha = blinkAlpha
    }
  })

  const drawGlow = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      g.beginFill(color, 1)
      g.drawRoundedRect(-4, -4, w + 8, h + 8, 12)
      g.endFill()
    },
    [w, h, color]
  )

  const drawShape = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      g.beginFill(color, 0.9)
      g.drawRoundedRect(4, 4, w - 8, h - 8, 8)
      g.endFill()
      g.lineStyle(2, 0xffffff, 0.6)
      g.drawRoundedRect(4, 4, w - 8, h - 8, 8)
    },
    [w, h, color]
  )

  const drawDot = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      g.beginFill(0xffffff, 1)
      g.drawCircle(0, 0, 3)
      g.endFill()
    },
    []
  )

  return (
    <>
      <Graphics ref={glowRef} draw={drawGlow} />
      <Graphics draw={drawShape} />
      <Graphics ref={dotRef} draw={drawDot} x={w - 10} y={10} />
    </>
  )
}

// Error: static red glow + "!" badge
function ErrorEffect({ w, h, color }: { w: number; h: number; color: number }): ReactElement {
  const drawGlow = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      g.beginFill(color, 0.4)
      g.drawRoundedRect(-6, -6, w + 12, h + 12, 14)
      g.endFill()
    },
    [w, h, color]
  )

  const drawShape = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      g.beginFill(color, 0.9)
      g.drawRoundedRect(4, 4, w - 8, h - 8, 8)
      g.endFill()
      g.lineStyle(2, 0xffffff, 0.6)
      g.drawRoundedRect(4, 4, w - 8, h - 8, 8)
    },
    [w, h, color]
  )

  const badgeStyle = useMemo(
    () =>
      new TextStyle({
        fontSize: Math.max(10, w * 0.25),
        fill: 0xffffff,
        fontFamily: 'monospace',
        fontWeight: 'bold',
      }),
    [w]
  )

  return (
    <>
      <Graphics draw={drawGlow} />
      <Graphics draw={drawShape} />
      <Text text="!" x={w - 6} y={2} anchor={{ x: 0.5, y: 0 }} style={badgeStyle} />
    </>
  )
}

// Done: green shape + "✓" badge, visual transitions to idle after 3s
function DoneEffect({ w, h, color }: { w: number; h: number; color: number }): ReactElement {
  const [showCheck, setShowCheck] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setShowCheck(false), 3000)
    return () => clearTimeout(timer)
  }, [])

  const drawShape = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      const c = showCheck ? color : STATUS_COLORS.idle
      g.beginFill(c, 0.8)
      g.drawRoundedRect(4, 4, w - 8, h - 8, 8)
      g.endFill()
      g.lineStyle(2, 0xffffff, 0.4)
      g.drawRoundedRect(4, 4, w - 8, h - 8, 8)
    },
    [w, h, color, showCheck]
  )

  const badgeStyle = useMemo(
    () =>
      new TextStyle({
        fontSize: Math.max(10, w * 0.25),
        fill: 0xffffff,
        fontFamily: 'monospace',
        fontWeight: 'bold',
      }),
    [w]
  )

  return (
    <>
      <Graphics draw={drawShape} />
      {showCheck && (
        <Text text="✓" x={w - 6} y={2} anchor={{ x: 0.5, y: 0 }} style={badgeStyle} />
      )}
    </>
  )
}

// Waiting: speech bubble with "..." above the character
function WaitingEffect({ w, h, color }: { w: number; h: number; color: number }): ReactElement {
  const drawShape = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      g.beginFill(color, 0.8)
      g.drawRoundedRect(4, 4, w - 8, h - 8, 8)
      g.endFill()
      g.lineStyle(2, 0xffffff, 0.4)
      g.drawRoundedRect(4, 4, w - 8, h - 8, 8)
    },
    [w, h, color]
  )

  const drawBubble = useCallback(
    (g: PixiGraphics) => {
      const bw = w * 0.7
      const bh = 18
      const bx = (w - bw) / 2
      const by = -bh - 8
      g.clear()
      g.beginFill(0xffffff, 0.9)
      g.drawRoundedRect(bx, by, bw, bh, 4)
      g.endFill()
      // Tail triangle
      g.beginFill(0xffffff, 0.9)
      g.drawPolygon([w / 2 - 4, by + bh, w / 2 + 4, by + bh, w / 2, by + bh + 6])
      g.endFill()
    },
    [w]
  )

  const dotStyle = useMemo(
    () =>
      new TextStyle({
        fontSize: Math.max(8, w * 0.2),
        fill: 0x333333,
        fontFamily: 'monospace',
        fontWeight: 'bold',
      }),
    [w]
  )

  const bh = 18
  const by = -bh - 8

  return (
    <>
      <Graphics draw={drawShape} />
      <Graphics draw={drawBubble} />
      <Text
        text="..."
        x={w / 2}
        y={by + bh / 2}
        anchor={{ x: 0.5, y: 0.5 }}
        style={dotStyle}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// StatusBadge — pill above character showing status when skin is present
// ---------------------------------------------------------------------------

const STATUS_BADGE_EMOJI: Record<string, string> = {
  running: '\u{26A1}',
  need_input: '\u{1F4AD}',
  need_approval: '\u{1F6A7}',
  done: '\u{2705}',
  error: '\u{2757}',
}

function getStatusBadgeText(
  status: string,
  runtimeState?: CharacterRuntimeState
): string {
  if (status === 'running' && runtimeState?.activeToolName) {
    return runtimeState.activeToolName
  }
  if (status === 'need_input') return 'reply'
  if (status === 'need_approval') {
    return runtimeState?.activeToolName ? `approve ${runtimeState.activeToolName}` : 'approve'
  }
  if (status === 'error') return 'error'
  return status.replace(/_/g, ' ')
}

function StatusBadge({
  status,
  w,
  runtimeState,
}: {
  status: string
  w: number
  runtimeState?: CharacterRuntimeState
}): ReactElement | null {
  if (status === 'idle' || status === 'no_session') return null

  const emoji = STATUS_BADGE_EMOJI[status] || ''
  const color = STATUS_COLORS[status as keyof typeof STATUS_COLORS] ?? STATUS_COLORS.idle
  const label = getStatusBadgeText(status, runtimeState)

  const badgeLabelStyle = useMemo(
    () =>
      new TextStyle({
        fontSize: Math.max(8, Math.min(11, w * 0.2)),
        fill: 0xffffff,
        fontFamily: 'monospace',
        fontWeight: 'bold',
      }),
    [w]
  )

  const pillW = Math.max(40, w * 0.7)
  const pillH = 16
  const pillX = (w - pillW) / 2

  const drawPill = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      g.beginFill(color, 0.85)
      g.drawRoundedRect(pillX, -pillH - 6, pillW, pillH, pillH / 2)
      g.endFill()
    },
    [color, pillX, pillW, pillH]
  )

  return (
    <>
      <Graphics draw={drawPill} />
      <Text
        text={`${emoji} ${label}`.trim()}
        x={w / 2}
        y={-pillH / 2 - 6}
        anchor={{ x: 0.5, y: 0.5 }}
        style={badgeLabelStyle}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// HoverBorder — subtle solid border for runtime hover feedback
// ---------------------------------------------------------------------------

function HoverBorder({ w, h }: { w: number; h: number }): ReactElement {
  const draw = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      g.lineStyle(1.5, 0xffffff, 0.35)
      g.drawRoundedRect(-1, -1, w + 2, h + 2, 4)
    },
    [w, h]
  )

  return <Graphics draw={draw} />
}

// ---------------------------------------------------------------------------
// SelectionBorder — dashed border around selected item
// ---------------------------------------------------------------------------

function SelectionBorder({ w, h }: { w: number; h: number }): ReactElement {
  const draw = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      const dashLen = 6
      const gapLen = 4
      const lineW = 2
      g.lineStyle(lineW, 0xffffff, 0.9)

      // Top edge
      for (let x = 0; x < w; x += dashLen + gapLen) {
        g.moveTo(x, 0)
        g.lineTo(Math.min(x + dashLen, w), 0)
      }
      // Bottom edge
      for (let x = 0; x < w; x += dashLen + gapLen) {
        g.moveTo(x, h)
        g.lineTo(Math.min(x + dashLen, w), h)
      }
      // Left edge
      for (let y = 0; y < h; y += dashLen + gapLen) {
        g.moveTo(0, y)
        g.lineTo(0, Math.min(y + dashLen, h))
      }
      // Right edge
      for (let y = 0; y < h; y += dashLen + gapLen) {
        g.moveTo(w, y)
        g.lineTo(w, Math.min(y + dashLen, h))
      }
    },
    [w, h]
  )

  return <Graphics draw={draw} />
}

// ---------------------------------------------------------------------------
// ResizeHandle — draggable handle at bottom-right corner
// ---------------------------------------------------------------------------

function ResizeHandle({
  parentW,
  parentH,
  cellSize,
  itemPixelX,
  itemPixelY,
  onResize,
  onDragStateChange,
}: {
  parentW: number
  parentH: number
  cellSize: number
  itemPixelX: number
  itemPixelY: number
  onResize: (newW: number, newH: number) => void
  onDragStateChange?: (dragging: boolean) => void
}): ReactElement {
  const handleSize = 18
  const dragging = useRef(false)

  const draw = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      // Rounded background
      g.beginFill(0x3a3a3a, 0.9)
      g.drawRoundedRect(0, 0, handleSize, handleSize, 4)
      g.endFill()
      // Diagonal resize lines (↘ pattern)
      g.lineStyle(1.5, 0xcccccc, 0.9)
      g.moveTo(6, handleSize - 4)
      g.lineTo(handleSize - 4, 6)
      g.moveTo(10, handleSize - 4)
      g.lineTo(handleSize - 4, 10)
      g.moveTo(14, handleSize - 4)
      g.lineTo(handleSize - 4, 14)
    },
    []
  )

  const onPointerDown = useCallback(
    (e: import('pixi.js').FederatedPointerEvent) => {
      dragging.current = true
      onDragStateChange?.(true)
      e.stopPropagation()
    },
    [onDragStateChange]
  )

  const onGlobalPointerMove = useCallback(
    (e: import('pixi.js').FederatedPointerEvent) => {
      if (!dragging.current) return
      const { gridCols, gridRows } = useRoomStore.getState()
      const newGridW = Math.max(1, Math.round((e.global.x - itemPixelX) / cellSize))
      const newGridH = Math.max(1, Math.round((e.global.y - itemPixelY) / cellSize))
      const clampedW = Math.min(newGridW, gridCols - Math.round(itemPixelX / cellSize))
      const clampedH = Math.min(newGridH, gridRows - Math.round(itemPixelY / cellSize))
      onResize(Math.max(1, clampedW), Math.max(1, clampedH))
    },
    [cellSize, itemPixelX, itemPixelY, onResize]
  )

  const onPointerUp = useCallback(() => {
    dragging.current = false
    onDragStateChange?.(false)
  }, [onDragStateChange])

  return (
    <Graphics
      draw={draw}
      x={parentW - handleSize - 2}
      y={parentH - handleSize - 2}
      interactive
      cursor="nwse-resize"
      pointerdown={onPointerDown}
      onglobalpointermove={onGlobalPointerMove}
      pointerup={onPointerUp}
      pointerupoutside={onPointerUp}
    />
  )
}

// ---------------------------------------------------------------------------
// ZOrderControls — up/down buttons for manual z-index adjustment
// ---------------------------------------------------------------------------

function ZOrderControls({
  parentW,
  parentH,
  onUp,
  onDown,
}: {
  parentW: number
  parentH: number
  onUp: () => void
  onDown: () => void
}): ReactElement {
  const btnW = 24
  const btnH = 22
  const gap = 2
  const totalH = btnH * 2 + gap
  const xPos = parentW
  const yPos = (parentH - totalH) / 2

  // Invisible hit area covering the gap between item and buttons to prevent hover loss
  const drawHitArea = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      g.beginFill(0x000000, 0.001)
      g.drawRect(-8, -4, btnW + 12, totalH + 8)
      g.endFill()
    },
    [totalH]
  )

  const drawBtn = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      g.beginFill(0x4a4a4a, 0.9)
      g.drawRoundedRect(0, 0, btnW, btnH, 6)
      g.endFill()
    },
    []
  )

  const drawChevronUp = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      g.lineStyle(2.5, 0xffffff, 0.9)
      // ^ chevron shape
      g.moveTo(7, 14)
      g.lineTo(12, 8)
      g.lineTo(17, 14)
    },
    []
  )

  const drawChevronDown = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      g.lineStyle(2.5, 0xffffff, 0.9)
      // v chevron shape
      g.moveTo(7, 8)
      g.lineTo(12, 14)
      g.lineTo(17, 8)
    },
    []
  )

  const onUpDown = useCallback(
    (e: import('pixi.js').FederatedPointerEvent) => {
      e.stopPropagation()
      onUp()
    },
    [onUp]
  )

  const onDownDown = useCallback(
    (e: import('pixi.js').FederatedPointerEvent) => {
      e.stopPropagation()
      onDown()
    },
    [onDown]
  )

  return (
    <Container x={xPos} y={yPos} interactive>
      <Graphics draw={drawHitArea} />
      <Container interactive cursor="pointer" pointerdown={onUpDown}>
        <Graphics draw={drawBtn} />
        <Graphics draw={drawChevronUp} />
      </Container>
      <Container y={btnH + gap} interactive cursor="pointer" pointerdown={onDownDown}>
        <Graphics draw={drawBtn} />
        <Graphics draw={drawChevronDown} />
      </Container>
    </Container>
  )
}

// ---------------------------------------------------------------------------
// FurnitureSprite
// ---------------------------------------------------------------------------

const FURNITURE_FILL = 0x5a4a3a
const TILE_FILL = 0x3a4a5a

function FurnitureSprite({
  item,
  cellSize,
  manifest,
  zIndex,
  activeTab,
  isSelected,
}: {
  item: PlacedItem
  cellSize: number
  manifest: ItemManifest
  zIndex?: number
  activeTab: AppTab
  isSelected: boolean
}): ReactElement {
  const w = item.footprint.w * cellSize
  const h = item.footprint.h * cellSize
  const fillColor = manifest.category === 'furniture' ? FURNITURE_FILL : TILE_FILL
  const borderColor = manifest.category === 'furniture' ? 0x7a6a5a : 0x5a6a7a
  const isLayout = activeTab === 'layout'
  const [isHovered, setIsHovered] = useState(false)
  const isResizingFurn = useRef(false)
  const showHandles = isLayout && (isSelected || isHovered)

  const [texture, setTexture] = useState<Texture | null>(null)
  useEffect(() => {
    if (manifest.texture) {
      loadTexture(manifest.texture).then(setTexture)
    } else {
      setTexture(null)
    }
  }, [manifest.texture])

  const containerRef = useRef<PixiContainer | null>(null)
  const dragging = useRef(false)
  const hasMoved = useRef(false)
  const dragStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const originalPos = useRef<GridPosition>({ x: item.position.x, y: item.position.y })

  const draw = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      g.beginFill(fillColor, 1)
      g.drawRect(0, 0, w, h)
      g.endFill()
      g.lineStyle(2, borderColor, 1)
      g.drawRect(0, 0, w, h)
    },
    [w, h, fillColor, borderColor]
  )

  const onPointerDown = useCallback(
    (e: import('pixi.js').FederatedPointerEvent) => {
      if (!isLayout) return
      if (e.button === 2) return // right-click handled separately
      dragging.current = true
      hasMoved.current = false
      originalPos.current = { x: item.position.x, y: item.position.y }
      const globalPos = e.global
      dragStart.current = { x: globalPos.x, y: globalPos.y }
      if (containerRef.current) {
        containerRef.current.cursor = 'grabbing'
      }
      e.stopPropagation()
    },
    [isLayout, item.position.x, item.position.y]
  )

  const onPointerMove = useCallback(
    (e: import('pixi.js').FederatedPointerEvent) => {
      if (!dragging.current || !containerRef.current) return
      const { gridCols, gridRows } = useRoomStore.getState()
      const globalPos = e.global
      const dx = globalPos.x - dragStart.current.x
      const dy = globalPos.y - dragStart.current.y
      if (!hasMoved.current && Math.abs(dx) < 5 && Math.abs(dy) < 5) return
      if (!hasMoved.current) useUIStore.getState().setIsDraggingItem(true)
      hasMoved.current = true
      const newPixelX = originalPos.current.x * cellSize + dx
      const newPixelY = originalPos.current.y * cellSize + dy
      const gridX = Math.max(0, Math.min(gridCols - item.footprint.w, Math.round(newPixelX / cellSize)))
      const gridY = Math.max(0, Math.min(gridRows - item.footprint.h, Math.round(newPixelY / cellSize)))
      containerRef.current.x = gridX * cellSize
      containerRef.current.y = gridY * cellSize
    },
    [cellSize, item.footprint.w, item.footprint.h]
  )

  const onPointerUp = useCallback(
    () => {
      if (!dragging.current || !containerRef.current) return
      dragging.current = false
      containerRef.current.cursor = 'grab'
      useUIStore.getState().setIsDraggingItem(false)

      if (!hasMoved.current) {
        useUIStore.getState().selectLayoutItem({ type: 'furniture', id: item.id })
        return
      }

      const newGridX = Math.round(containerRef.current.x / cellSize)
      const newGridY = Math.round(containerRef.current.y / cellSize)
      const newPos: GridPosition = { x: newGridX, y: newGridY }

      useRoomStore.getState().moveItem(item.id, newPos)
    },
    [cellSize, item.id]
  )

  const onRightClick = useCallback(
    (e: import('pixi.js').FederatedPointerEvent) => {
      if (!isLayout) return
      e.preventDefault?.()
      e.stopPropagation()
      const native = e.nativeEvent as MouseEvent
      useUIStore.getState().openLayoutContextMenu('furniture', item.id, native.clientX, native.clientY)
    },
    [isLayout, item.id]
  )

  const onResizeFurniture = useCallback(
    (newW: number, newH: number) => {
      useRoomStore.getState().resizeItem(item.id, { w: newW, h: newH })
    },
    [item.id]
  )

  return (
    <Container
      ref={containerRef}
      x={item.position.x * cellSize}
      y={item.position.y * cellSize}
      zIndex={zIndex ?? 0}
      interactive={isLayout}
      cursor={isLayout ? 'grab' : 'default'}
      pointerdown={isLayout ? onPointerDown : undefined}
      onglobalpointermove={isLayout ? onPointerMove : undefined}
      pointerup={isLayout ? onPointerUp : undefined}
      pointerupoutside={isLayout ? onPointerUp : undefined}
      rightclick={isLayout ? onRightClick : undefined}
      pointerover={isLayout ? () => { if (!useUIStore.getState().isDraggingItem) setIsHovered(true) } : undefined}
      pointerout={isLayout ? () => { if (!isResizingFurn.current) setIsHovered(false) } : undefined}
    >
      {texture ? (
        <Sprite texture={texture} width={w} height={h} />
      ) : (
        <Graphics draw={draw} />
      )}
      {/* No label for furniture/background on canvas */}
      {showHandles && (
        <>
          <SelectionBorder w={w} h={h} />
          <ResizeHandle
            parentW={w}
            parentH={h}
            cellSize={cellSize}
            itemPixelX={item.position.x * cellSize}
            itemPixelY={item.position.y * cellSize}
            onResize={onResizeFurniture}
            onDragStateChange={(d) => { isResizingFurn.current = d }}
          />
          <ZOrderControls
            parentW={w}
            parentH={h}
            onUp={() => useRoomStore.getState().updateItemZOrder(item.id, (item.zOrder ?? 0) + 1)}
            onDown={() => useRoomStore.getState().updateItemZOrder(item.id, (item.zOrder ?? 0) - 1)}
          />
        </>
      )}
    </Container>
  )
}

// ---------------------------------------------------------------------------
// CharacterSprite
// ---------------------------------------------------------------------------

function CharacterSprite({
  character,
  runtimeState,
  cellSize,
  onSelect,
  onRightClick,
  activeTab,
  isSelected,
}: {
  character: Character & { gridPosition: GridPosition }
  runtimeState?: CharacterRuntimeState
  cellSize: number
  onSelect: (id: string | null) => void
  onRightClick: (characterId: string, x: number, y: number) => void
  activeTab: AppTab
  isSelected: boolean
}): ReactElement {
  const fp = character.footprint ?? { w: 2, h: 2 }
  const x = character.gridPosition.x * cellSize
  const y = character.gridPosition.y * cellSize
  const w = fp.w * cellSize
  const h = fp.h * cellSize
  const isLayout = activeTab === 'layout'
  const [isHoveredChar, setIsHoveredChar] = useState(false)
  const isResizingChar = useRef(false)
  const showHandlesChar = isLayout && (isSelected || isHoveredChar)

  const [texture, setTexture] = useState<Texture | null>(null)
  useEffect(() => {
    if (character.skin) {
      loadTexture(character.skin).then(setTexture)
    } else {
      setTexture(null)
    }
  }, [character.skin])

  const containerRef = useRef<PixiContainer | null>(null)
  const dragging = useRef(false)
  const hasMoved = useRef(false)
  const dragStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const originalPos = useRef<GridPosition>({
    x: character.gridPosition.x,
    y: character.gridPosition.y,
  })

  const color = STATUS_COLORS[character.status] ?? STATUS_COLORS.idle

  const labelStyle = useMemo(
    () =>
      new TextStyle({
        fontSize: Math.max(10, cellSize * 0.35),
        fill: 0xe0e0e0,
        fontFamily: 'monospace',
      }),
    [cellSize]
  )

  const statusEffect = useMemo((): ReactElement => {
    switch (character.status) {
      case 'no_session':
      case 'idle':
        return <IdleEffect w={w} h={h} color={color} />
      case 'running':
        return <WorkingEffect w={w} h={h} color={color} />
      case 'error':
        return <ErrorEffect w={w} h={h} color={color} />
      case 'done':
        return <DoneEffect w={w} h={h} color={color} />
      case 'need_input':
      case 'need_approval':
        return <WaitingEffect w={w} h={h} color={color} />
      default:
        return <IdleEffect w={w} h={h} color={color} />
    }
  }, [character.status, w, h, color])

  const onPointerDown = useCallback(
    (e: import('pixi.js').FederatedPointerEvent) => {
      if (isLayout) {
        if (e.button === 2) return
        dragging.current = true
        hasMoved.current = false
        originalPos.current = {
          x: character.gridPosition.x,
          y: character.gridPosition.y,
        }
        dragStart.current = { x: e.global.x, y: e.global.y }
        if (containerRef.current) {
          containerRef.current.cursor = 'grabbing'
        }
        e.stopPropagation()
      } else {
        if (e.button === 2) {
          e.preventDefault?.()
          const native = e.nativeEvent as MouseEvent
          onRightClick(character.id, native.clientX, native.clientY)
        } else {
          onSelect(character.id)
        }
      }
    },
    [isLayout, character.gridPosition.x, character.gridPosition.y, character.id, onSelect, onRightClick]
  )

  const onPointerMove = useCallback(
    (e: import('pixi.js').FederatedPointerEvent) => {
      if (!dragging.current || !containerRef.current) return
      const { gridCols, gridRows } = useRoomStore.getState()
      const dx = e.global.x - dragStart.current.x
      const dy = e.global.y - dragStart.current.y
      if (!hasMoved.current && Math.abs(dx) < 5 && Math.abs(dy) < 5) return
      if (!hasMoved.current) useUIStore.getState().setIsDraggingItem(true)
      hasMoved.current = true
      const newPixelX = originalPos.current.x * cellSize + dx
      const newPixelY = originalPos.current.y * cellSize + dy
      const gridX = Math.max(0, Math.min(gridCols - fp.w, Math.round(newPixelX / cellSize)))
      const gridY = Math.max(0, Math.min(gridRows - fp.h, Math.round(newPixelY / cellSize)))
      containerRef.current.x = gridX * cellSize
      containerRef.current.y = gridY * cellSize
    },
    [cellSize, fp.w, fp.h]
  )

  const onPointerUp = useCallback(
    () => {
      if (!dragging.current || !containerRef.current) return
      dragging.current = false
      containerRef.current.cursor = 'grab'
      useUIStore.getState().setIsDraggingItem(false)

      if (!hasMoved.current) {
        useUIStore.getState().selectLayoutItem({ type: 'character', id: character.id })
        return
      }

      const newGridX = Math.round(containerRef.current.x / cellSize)
      const newGridY = Math.round(containerRef.current.y / cellSize)

      if (
        newGridX !== originalPos.current.x ||
        newGridY !== originalPos.current.y
      ) {
        window.api.invoke(IPC_COMMANDS.CHARACTER_UPDATE, character.id, {
          gridPosition: { x: newGridX, y: newGridY },
        })
      }
    },
    [cellSize, character.id]
  )

  const onRightClickHandler = useCallback(
    (e: import('pixi.js').FederatedPointerEvent) => {
      e.preventDefault?.()
      const native = e.nativeEvent as MouseEvent
      if (isLayout) {
        e.stopPropagation()
        useUIStore.getState().openLayoutContextMenu('character', character.id, native.clientX, native.clientY)
      } else {
        onRightClick(character.id, native.clientX, native.clientY)
      }
    },
    [isLayout, character.id, onRightClick]
  )

  const onResizeCharacter = useCallback(
    (newW: number, newH: number) => {
      window.api.invoke(IPC_COMMANDS.CHARACTER_UPDATE, character.id, {
        footprint: { w: newW, h: newH },
      })
    },
    [character.id]
  )

  return (
    <Container
      ref={containerRef}
      x={x}
      y={y}
      zIndex={character.gridPosition.y * cellSize + (character.zOrder ?? 0) * 100}
      interactive
      pointerdown={onPointerDown}
      onglobalpointermove={isLayout ? onPointerMove : undefined}
      pointerup={isLayout ? onPointerUp : undefined}
      pointerupoutside={isLayout ? onPointerUp : undefined}
      rightclick={onRightClickHandler}
      cursor={isLayout ? 'grab' : 'pointer'}
      pointerover={() => { if (!useUIStore.getState().isDraggingItem) setIsHoveredChar(true) }}
      pointerout={() => { if (!isResizingChar.current) setIsHoveredChar(false) }}
    >
      {texture ? (
        <>
          <Sprite texture={texture} width={w} height={h} />
          <StatusBadge status={character.status} w={w} runtimeState={runtimeState} />
        </>
      ) : (
        statusEffect
      )}
      {!isLayout && isHoveredChar && <HoverBorder w={w} h={h} />}
      <Text
        text={character.name}
        x={w / 2}
        y={h + 4}
        anchor={{ x: 0.5, y: 0 }}
        style={labelStyle}
      />
      {showHandlesChar && (
        <>
          <SelectionBorder w={w} h={h} />
          <ResizeHandle
            parentW={w}
            parentH={h}
            cellSize={cellSize}
            itemPixelX={character.gridPosition.x * cellSize}
            itemPixelY={character.gridPosition.y * cellSize}
            onResize={onResizeCharacter}
            onDragStateChange={(d) => { isResizingChar.current = d }}
          />
          <ZOrderControls
            parentW={w}
            parentH={h}
            onUp={() => window.api.invoke(IPC_COMMANDS.CHARACTER_UPDATE, character.id, { zOrder: (character.zOrder ?? 0) + 1 })}
            onDown={() => window.api.invoke(IPC_COMMANDS.CHARACTER_UPDATE, character.id, { zOrder: (character.zOrder ?? 0) - 1 })}
          />
        </>
      )}
    </Container>
  )
}

// ---------------------------------------------------------------------------
// OfficeCanvas
// ---------------------------------------------------------------------------

export function OfficeCanvas(): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { width: winW, height: winH } = useContainerSize(containerRef)
  const gridCols = useRoomStore((s) => s.gridCols)
  const gridRows = useRoomStore((s) => s.gridRows)
  const cellW = Math.floor(winW / gridCols)
  const cellH = Math.floor(winH / gridRows)
  const cellSize = Math.min(cellW, cellH)
  const stageW = cellSize * gridCols
  const stageH = cellSize * gridRows

  const characters = useCharacterStore((s) => s.characters)
  const runtimeStates = useRuntimeStore((s) => s.states)
  const openTerminalDock = useUIStore((s) => s.openTerminalDock)
  const openContextMenu = useUIStore((s) => s.openContextMenu)
  const activeTab = useUIStore((s) => s.activeTab)
  const theme = useUIStore((s) => s.theme)
  const selectedLayoutItem = useUIStore((s) => s.selectedLayoutItem)
  const selectLayoutItem = useUIStore((s) => s.selectLayoutItem)
  const items = useRoomStore((s) => s.layout.items)

  // ESC to deselect / close context menu, Ctrl+C / Ctrl+V copy-paste
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        useUIStore.getState().selectLayoutItem(null)
        useUIStore.getState().closeLayoutContextMenu()
      }
      const isCmd = e.ctrlKey || e.metaKey
      if (isCmd && e.key === 'c') {
        const sel = useUIStore.getState().selectedLayoutItem
        if (!sel) return
        if (sel.type === 'furniture') {
          const item = useRoomStore.getState().layout.items.find((i) => i.id === sel.id)
          if (item) {
            useUIStore.getState().setLayoutClipboard({
              type: 'furniture',
              manifestId: item.manifestId,
              footprint: { w: item.footprint.w, h: item.footprint.h },
            })
          }
        } else {
          const char = useCharacterStore.getState().characters.find((c) => c.id === sel.id)
          if (char) {
            useUIStore.getState().setLayoutClipboard({
              type: 'character',
              id: char.id,
              name: char.name,
            })
          }
        }
      }
      if (isCmd && e.key === 'v') {
        const clip = useUIStore.getState().layoutClipboard
        if (!clip || clip.type !== 'furniture') return
        const newId = crypto.randomUUID()
        const pos = useRoomStore.getState().findEmptyPosition(clip.footprint.w, clip.footprint.h)
        useRoomStore.getState().addItem({
          id: newId,
          manifestId: clip.manifestId,
          position: pos ?? { x: 0, y: 0 },
          footprint: { w: clip.footprint.w, h: clip.footprint.h },
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const palette = useMemo(
    () => (getEffectiveMode(theme) === 'dark' ? DARK_PALETTE : LIGHT_PALETTE),
    [theme]
  )

  // Derive a manifest from the PlacedItem when getManifestById returns undefined.
  // manifestId is now a relativePath like "office/furniture/desk.png"
  const resolveManifest = useCallback((item: PlacedItem): ItemManifest => {
    const existing = getManifestById(item.manifestId)
    if (existing) return existing

    // Derive from path: "{theme}/{category}/{filename}"
    const parts = item.manifestId.split('/')
    const category = parts.length >= 2 ? parts[1] : 'furniture'
    const filename = parts[parts.length - 1] ?? item.manifestId
    const displayName = filename.replace(/\.[^.]+$/, '').replace(/Modern_Office_Singles_32x32_/, '#')

    return {
      id: item.manifestId,
      name: displayName,
      category: (category === 'background' ? 'background' : 'furniture') as import('../../../shared/types').ItemCategory,
      footprint: item.footprint,
      texture: `assets/${item.manifestId}`,
      anchor: { x: 0.5, y: 1.0 },
      placementZone: 'floor',
      tags: [],
    }
  }, [])

  const floorDecorItems = useMemo(
    () =>
      items
        .map((item) => ({ item, manifest: resolveManifest(item) }))
        .filter(
          (entry): entry is { item: PlacedItem; manifest: ItemManifest } =>
            entry.manifest.category === 'background'
        ),
    [items, resolveManifest]
  )

  const furnitureItems = useMemo(
    () =>
      items
        .map((item) => ({ item, manifest: resolveManifest(item) }))
        .filter(
          (entry): entry is { item: PlacedItem; manifest: ItemManifest } =>
            entry.manifest.category === 'furniture'
        ),
    [items, resolveManifest]
  )

  // Deselect when clicking empty canvas area
  const onCanvasPointerDown = useCallback(() => {
    selectLayoutItem(null)
  }, [selectLayoutItem])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
    <Stage
      width={stageW}
      height={stageH}
      options={{ background: palette.canvasBg, antialias: false }}
    >
      <Container interactive pointerdown={activeTab === 'layout' ? onCanvasPointerDown : undefined}>
        {/* Layer 0: Background */}
        <Container name="backgroundLayer">
          <BackgroundLayer cellSize={cellSize} palette={palette} activeTab={activeTab} gridCols={gridCols} gridRows={gridRows} />
        </Container>

        {/* Layer 1: Floor decor */}
        <Container name="floorDecorLayer">
          {floorDecorItems.map(({ item, manifest }) => (
            <FurnitureSprite
              key={item.id}
              item={item}
              cellSize={cellSize}
              manifest={manifest}
              activeTab={activeTab}
              isSelected={selectedLayoutItem?.type === 'furniture' && selectedLayoutItem.id === item.id}
            />
          ))}
        </Container>

        {/* Layers 2-4: Y-sorted furniture + characters */}
        <Container name="ySortContainer" sortableChildren>
          {furnitureItems.map(({ item, manifest }) => (
            <FurnitureSprite
              key={item.id}
              item={item}
              cellSize={cellSize}
              manifest={manifest}
              zIndex={item.position.y * cellSize + (item.zOrder ?? 0) * 100}
              activeTab={activeTab}
              isSelected={selectedLayoutItem?.type === 'furniture' && selectedLayoutItem.id === item.id}
            />
          ))}
          {characters.filter((c): c is Character & { gridPosition: GridPosition } => c.gridPosition !== null).map((char) => (
            <CharacterSprite
              key={char.id}
              character={char}
              runtimeState={runtimeStates[char.id]}
              cellSize={cellSize}
              onSelect={(id) => { if (id) openTerminalDock(id) }}
              onRightClick={openContextMenu}
              activeTab={activeTab}
              isSelected={selectedLayoutItem?.type === 'character' && selectedLayoutItem.id === char.id}
            />
          ))}
        </Container>
      </Container>
    </Stage>
    </div>
    </div>
  )
}
