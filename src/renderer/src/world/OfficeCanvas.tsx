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
  CropRect,
} from '../../../shared/types'
import { getEffectiveFootprint } from '../../../shared/types'
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

function HoverBorder({ w, h, crop, cellSize }: { w: number; h: number; crop?: CropRect | null; cellSize?: number }): ReactElement {
  const draw = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      g.lineStyle(1.5, 0xffffff, 0.35)
      if (crop && cellSize) {
        const cx = crop.left * cellSize
        const cy = crop.top * cellSize
        const cw = w - (crop.left + crop.right) * cellSize
        const ch = h - (crop.top + crop.bottom) * cellSize
        g.drawRoundedRect(cx - 1, cy - 1, cw + 2, ch + 2, 4)
      } else {
        g.drawRoundedRect(-1, -1, w + 2, h + 2, 4)
      }
    },
    [w, h, crop, cellSize]
  )

  return <Graphics draw={draw} />
}

// ---------------------------------------------------------------------------
// SelectionBorder — dashed border around selected item
// ---------------------------------------------------------------------------

function SelectionBorder({ w, h, crop, cellSize }: { w: number; h: number; crop?: CropRect | null; cellSize?: number }): ReactElement {
  const draw = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      const dashLen = 6
      const gapLen = 4
      const lineW = 2
      g.lineStyle(lineW, 0xffffff, 0.9)

      const bx = crop && cellSize ? crop.left * cellSize : 0
      const by = crop && cellSize ? crop.top * cellSize : 0
      const bw = crop && cellSize ? w - (crop.left + crop.right) * cellSize : w
      const bh = crop && cellSize ? h - (crop.top + crop.bottom) * cellSize : h

      // Top edge
      for (let x = 0; x < bw; x += dashLen + gapLen) {
        g.moveTo(bx + x, by)
        g.lineTo(bx + Math.min(x + dashLen, bw), by)
      }
      // Bottom edge
      for (let x = 0; x < bw; x += dashLen + gapLen) {
        g.moveTo(bx + x, by + bh)
        g.lineTo(bx + Math.min(x + dashLen, bw), by + bh)
      }
      // Left edge
      for (let y = 0; y < bh; y += dashLen + gapLen) {
        g.moveTo(bx, by + y)
        g.lineTo(bx, by + Math.min(y + dashLen, bh))
      }
      // Right edge
      for (let y = 0; y < bh; y += dashLen + gapLen) {
        g.moveTo(bx + bw, by + y)
        g.lineTo(bx + bw, by + Math.min(y + dashLen, bh))
      }
    },
    [w, h, crop, cellSize]
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
      // Resize icon — rendered via Pixi (lucide not available in canvas)
      // Top-left arrow
      g.lineStyle(1.5, 0xcccccc, 0.9)
      g.moveTo(4, 9)
      g.lineTo(4, 4)
      g.lineTo(9, 4)
      g.moveTo(4, 4)
      g.lineTo(8, 8)
      // Bottom-right arrow
      g.moveTo(14, 9)
      g.lineTo(14, 14)
      g.lineTo(9, 14)
      g.moveTo(14, 14)
      g.lineTo(10, 10)
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
// SelectionControls — 2×2 grid of buttons at top-right of selected item
// [ChevronUp] [Crop]
// [ChevronDown] [Menu]
// ---------------------------------------------------------------------------

function SelectionControls({
  parentW,
  onZUp,
  onZDown,
  onCropToggle,
  onMenu,
  isCropping,
}: {
  parentW: number
  parentH: number
  onZUp: () => void
  onZDown: () => void
  onCropToggle: () => void
  onMenu: (x: number, y: number) => void
  isCropping: boolean
}): ReactElement {
  const btnSize = 18
  const gap = 2
  const xPos = parentW + 4
  const yPos = -4

  const drawBtn = useCallback(
    (g: PixiGraphics, highlighted = false) => {
      g.clear()
      g.beginFill(highlighted ? 0x2255cc : 0x4a4a4a, 0.9)
      g.drawRoundedRect(0, 0, btnSize, btnSize, 4)
      g.endFill()
    },
    []
  )

  const drawBtnNormal = useCallback((g: PixiGraphics) => drawBtn(g, false), [drawBtn])
  const drawBtnHighlight = useCallback((g: PixiGraphics) => drawBtn(g, true), [drawBtn])

  const drawChevronUp = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      g.lineStyle(2, 0xffffff, 0.9)
      g.moveTo(4, 12)
      g.lineTo(9, 6)
      g.lineTo(14, 12)
    },
    []
  )

  const drawChevronDown = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      g.lineStyle(2, 0xffffff, 0.9)
      g.moveTo(4, 6)
      g.lineTo(9, 12)
      g.lineTo(14, 6)
    },
    []
  )

  // Crop icon: rectangle with dashed inner rect
  const drawCropIcon = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      g.lineStyle(1.5, 0xffffff, 0.9)
      g.drawRect(3, 3, 12, 12)
      g.lineStyle(1, 0xffffff, 0.5)
      g.drawRect(6, 6, 6, 6)
    },
    []
  )

  // Menu icon: three horizontal dots
  const drawMenuIcon = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      g.beginFill(0xffffff, 0.9)
      g.drawCircle(5, 9, 1.5)
      g.drawCircle(9, 9, 1.5)
      g.drawCircle(13, 9, 1.5)
      g.endFill()
    },
    []
  )

  const onZUpDown = useCallback(
    (e: import('pixi.js').FederatedPointerEvent) => { e.stopPropagation(); onZUp() },
    [onZUp]
  )

  const onZDownDown = useCallback(
    (e: import('pixi.js').FederatedPointerEvent) => { e.stopPropagation(); onZDown() },
    [onZDown]
  )

  const onCropDown = useCallback(
    (e: import('pixi.js').FederatedPointerEvent) => { e.stopPropagation(); onCropToggle() },
    [onCropToggle]
  )

  const onMenuDown = useCallback(
    (e: import('pixi.js').FederatedPointerEvent) => {
      e.stopPropagation()
      const native = e.nativeEvent as MouseEvent
      onMenu(native.clientX, native.clientY)
    },
    [onMenu]
  )

  const row2Y = btnSize + gap

  return (
    <Container x={xPos} y={yPos} interactive>
      {/* Top-left: chevron up */}
      <Container interactive cursor="pointer" pointerdown={onZUpDown}>
        <Graphics draw={drawBtnNormal} />
        <Graphics draw={drawChevronUp} />
      </Container>
      {/* Top-right: crop */}
      <Container x={btnSize + gap} interactive cursor="pointer" pointerdown={onCropDown}>
        <Graphics draw={isCropping ? drawBtnHighlight : drawBtnNormal} />
        <Graphics draw={drawCropIcon} />
      </Container>
      {/* Bottom-left: chevron down */}
      <Container y={row2Y} interactive cursor="pointer" pointerdown={onZDownDown}>
        <Graphics draw={drawBtnNormal} />
        <Graphics draw={drawChevronDown} />
      </Container>
      {/* Bottom-right: menu */}
      <Container x={btnSize + gap} y={row2Y} interactive cursor="pointer" pointerdown={onMenuDown}>
        <Graphics draw={drawBtnNormal} />
        <Graphics draw={drawMenuIcon} />
      </Container>
    </Container>
  )
}

// ---------------------------------------------------------------------------
// CropEditor — 4 draggable edge handles for adjusting crop
// ---------------------------------------------------------------------------

function CropEditor({
  w,
  h,
  crop,
  cellSize,
  efpW,
  efpH,
  onCropChange,
}: {
  w: number
  h: number
  crop: CropRect
  cellSize: number
  efpW: number
  efpH: number
  onCropChange: (newCrop: CropRect) => void
}): ReactElement {
  const draggingEdge = useRef<'top' | 'bottom' | 'left' | 'right' | null>(null)
  const cropStart = useRef<CropRect>(crop)
  const dragStartGlobal = useRef({ x: 0, y: 0 })

  const handleSize = 10

  // Crop pixel bounds
  const cx = crop.left * cellSize
  const cy = crop.top * cellSize
  const cw = w - (crop.left + crop.right) * cellSize
  const ch = h - (crop.top + crop.bottom) * cellSize

  const drawOverlay = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      // Dark overlay on cropped-away areas
      g.beginFill(0x000000, 0.45)
      if (crop.top > 0) g.drawRect(0, 0, w, crop.top * cellSize)
      if (crop.bottom > 0) g.drawRect(0, h - crop.bottom * cellSize, w, crop.bottom * cellSize)
      const midY = crop.top * cellSize
      const midH = h - (crop.top + crop.bottom) * cellSize
      if (crop.left > 0) g.drawRect(0, midY, crop.left * cellSize, midH)
      if (crop.right > 0) g.drawRect(w - crop.right * cellSize, midY, crop.right * cellSize, midH)
      g.endFill()
      // Bright border around crop area
      g.lineStyle(1.5, 0xffdd44, 0.9)
      g.drawRect(cx, cy, cw, ch)
    },
    [crop, w, h, cellSize, cx, cy, cw, ch]
  )

  const drawHandle = useCallback(
    (g: PixiGraphics) => {
      g.clear()
      g.beginFill(0xffdd44, 1)
      g.drawRoundedRect(0, 0, handleSize, handleSize, 2)
      g.endFill()
    },
    []
  )

  const makePointerDown = (edge: 'top' | 'bottom' | 'left' | 'right') =>
    (e: import('pixi.js').FederatedPointerEvent) => {
      e.stopPropagation()
      draggingEdge.current = edge
      cropStart.current = { ...crop }
      dragStartGlobal.current = { x: e.global.x, y: e.global.y }
    }

  const onGlobalMove = useCallback(
    (e: import('pixi.js').FederatedPointerEvent) => {
      if (!draggingEdge.current) return
      const edge = draggingEdge.current
      const start = cropStart.current
      const dx = e.global.x - dragStartGlobal.current.x
      const dy = e.global.y - dragStartGlobal.current.y

      if (edge === 'top') {
        const delta = Math.round(dy / cellSize)
        const newTop = Math.max(0, Math.min(efpH - start.bottom - 1, start.top + delta))
        onCropChange({ ...start, top: newTop })
      } else if (edge === 'bottom') {
        const delta = Math.round(dy / cellSize)
        const newBottom = Math.max(0, Math.min(efpH - start.top - 1, start.bottom - delta))
        onCropChange({ ...start, bottom: newBottom })
      } else if (edge === 'left') {
        const delta = Math.round(dx / cellSize)
        const newLeft = Math.max(0, Math.min(efpW - start.right - 1, start.left + delta))
        onCropChange({ ...start, left: newLeft })
      } else if (edge === 'right') {
        const delta = Math.round(dx / cellSize)
        const newRight = Math.max(0, Math.min(efpW - start.left - 1, start.right - delta))
        onCropChange({ ...start, right: newRight })
      }
    },
    [cellSize, efpW, efpH, onCropChange]
  )

  const onGlobalUp = useCallback(() => {
    draggingEdge.current = null
  }, [])

  // Handle midpoints
  const topHandleX = cx + cw / 2 - handleSize / 2
  const topHandleY = cy - handleSize / 2
  const bottomHandleX = cx + cw / 2 - handleSize / 2
  const bottomHandleY = cy + ch - handleSize / 2
  const leftHandleX = cx - handleSize / 2
  const leftHandleY = cy + ch / 2 - handleSize / 2
  const rightHandleX = cx + cw - handleSize / 2
  const rightHandleY = cy + ch / 2 - handleSize / 2

  return (
    <Container interactive onglobalpointermove={onGlobalMove} pointerup={onGlobalUp} pointerupoutside={onGlobalUp}>
      <Graphics draw={drawOverlay} />
      {/* Top handle */}
      <Graphics
        draw={drawHandle}
        x={topHandleX}
        y={topHandleY}
        interactive
        cursor="ns-resize"
        pointerdown={makePointerDown('top')}
      />
      {/* Bottom handle */}
      <Graphics
        draw={drawHandle}
        x={bottomHandleX}
        y={bottomHandleY}
        interactive
        cursor="ns-resize"
        pointerdown={makePointerDown('bottom')}
      />
      {/* Left handle */}
      <Graphics
        draw={drawHandle}
        x={leftHandleX}
        y={leftHandleY}
        interactive
        cursor="ew-resize"
        pointerdown={makePointerDown('left')}
      />
      {/* Right handle */}
      <Graphics
        draw={drawHandle}
        x={rightHandleX}
        y={rightHandleY}
        interactive
        cursor="ew-resize"
        pointerdown={makePointerDown('right')}
      />
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
  isCropping,
  onCropToggle,
}: {
  item: PlacedItem
  cellSize: number
  manifest: ItemManifest
  zIndex?: number
  activeTab: AppTab
  isSelected: boolean
  isCropping: boolean
  onCropToggle: (id: string) => void
}): ReactElement {
  const rotation = item.rotation ?? 0
  const flipX = item.flipX ?? false
  const flipY = item.flipY ?? false
  const crop = item.crop ?? null

  const efp = getEffectiveFootprint(item.footprint, rotation)
  const w = efp.w * cellSize
  const h = efp.h * cellSize
  // Sprite raw pixel dims (pre-rotation)
  const sw = item.footprint.w * cellSize
  const sh = item.footprint.h * cellSize

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
      g.drawRect(0, 0, sw, sh)
      g.endFill()
      g.lineStyle(2, borderColor, 1)
      g.drawRect(0, 0, sw, sh)
    },
    [sw, sh, fillColor, borderColor]
  )

  // Rotation pivot so sprite stays at container top-left after rotation
  const rotRad = (rotation * Math.PI) / 180
  const spritePivot = useMemo(() => {
    if (rotation === 90) return { x: 0, y: sh }
    if (rotation === 180) return { x: sw, y: sh }
    if (rotation === 270) return { x: sw, y: 0 }
    return { x: 0, y: 0 }
  }, [rotation, sw, sh])

  // Flip anchor

  // Crop overlay draw (layout mode)
  const drawCropOverlay = useCallback(
    (g: PixiGraphics) => {
      if (!crop) return
      g.clear()
      g.beginFill(0x000000, 0.45)
      if (crop.top > 0) g.drawRect(0, 0, w, crop.top * cellSize)
      if (crop.bottom > 0) g.drawRect(0, h - crop.bottom * cellSize, w, crop.bottom * cellSize)
      const midY = crop.top * cellSize
      const midH = h - (crop.top + crop.bottom) * cellSize
      if (crop.left > 0) g.drawRect(0, midY, crop.left * cellSize, midH)
      if (crop.right > 0) g.drawRect(w - crop.right * cellSize, midY, crop.right * cellSize, midH)
      g.endFill()
    },
    [crop, w, h, cellSize]
  )

  const onPointerDown = useCallback(
    (e: import('pixi.js').FederatedPointerEvent) => {
      if (!isLayout) return
      if (e.button === 2) return
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
      const gridX = Math.max(0, Math.min(gridCols - efp.w, Math.round(newPixelX / cellSize)))
      const gridY = Math.max(0, Math.min(gridRows - efp.h, Math.round(newPixelY / cellSize)))
      containerRef.current.x = gridX * cellSize
      containerRef.current.y = gridY * cellSize
    },
    [cellSize, efp.w, efp.h]
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

  const onCropChange = useCallback(
    (newCrop: CropRect) => {
      useRoomStore.getState().cropItem(item.id, newCrop)
    },
    [item.id]
  )

  // Crop mask — applied to sprite wrapper (hidden in runtime + layout when not selected)
  const spriteWrapRef = useRef<PixiContainer | null>(null)
  const cropMaskRef = useRef<PixiGraphics | null>(null)
  const hasCrop = crop && (crop.top > 0 || crop.bottom > 0 || crop.left > 0 || crop.right > 0)
  const shouldMask = hasCrop && !(isLayout && isSelected)
  useEffect(() => {
    const wrap = spriteWrapRef.current
    if (!wrap || !shouldMask) {
      if (cropMaskRef.current) {
        if (wrap) wrap.mask = null
        cropMaskRef.current.destroy()
        cropMaskRef.current = null
      }
      return
    }
    // Apply crop mask
    const g = new PixiGraphics()
    g.beginFill(0xffffff)
    g.drawRect(
      crop!.left * cellSize,
      crop!.top * cellSize,
      (efp.w - crop!.left - crop!.right) * cellSize,
      (efp.h - crop!.top - crop!.bottom) * cellSize
    )
    g.endFill()
    wrap.addChild(g)
    wrap.mask = g
    cropMaskRef.current = g
    return () => {
      wrap.mask = null
      g.destroy()
      cropMaskRef.current = null
    }
  }, [shouldMask, crop?.top, crop?.bottom, crop?.left, crop?.right, cellSize, efp.w, efp.h])

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
      {/* Sprite wrapper — crop mask applied here only */}
      <Container ref={spriteWrapRef}>
        {texture ? (
          <Container
            scale={{ x: flipX ? -1 : 1, y: flipY ? -1 : 1 }}
            x={flipX ? w : 0}
            y={flipY ? h : 0}
          >
            <Container rotation={rotRad} pivot={spritePivot}>
              <Sprite texture={texture} width={sw} height={sh} />
            </Container>
          </Container>
        ) : (
          <Container
            scale={{ x: flipX ? -1 : 1, y: flipY ? -1 : 1 }}
            x={flipX ? w : 0}
            y={flipY ? h : 0}
          >
            <Container rotation={rotRad} pivot={spritePivot}>
              <Graphics draw={draw} />
            </Container>
          </Container>
        )}
      </Container>
      {/* Crop overlay in layout mode */}
      {isLayout && isSelected && crop && !isCropping && (
        <Graphics draw={drawCropOverlay} />
      )}
      {/* Hover border (runtime) */}
      {!isLayout && isHovered && <HoverBorder w={w} h={h} crop={crop} cellSize={cellSize} />}
      {showHandles && (
        <>
          <SelectionBorder w={w} h={h} crop={crop} cellSize={cellSize} />
          <ResizeHandle
            parentW={w}
            parentH={h}
            cellSize={cellSize}
            itemPixelX={item.position.x * cellSize}
            itemPixelY={item.position.y * cellSize}
            onResize={onResizeFurniture}
            onDragStateChange={(d) => { isResizingFurn.current = d }}
          />
          <SelectionControls
            parentW={w}
            parentH={h}
            onZUp={() => useRoomStore.getState().updateItemZOrder(item.id, (item.zOrder ?? 0) + 1)}
            onZDown={() => useRoomStore.getState().updateItemZOrder(item.id, (item.zOrder ?? 0) - 1)}
            onCropToggle={() => onCropToggle(item.id)}
            onMenu={(x, y) => useUIStore.getState().openLayoutContextMenu('furniture', item.id, x, y)}
            isCropping={isCropping}
          />
        </>
      )}
      {/* Crop editor handles */}
      {isLayout && isCropping && isSelected && (
        <CropEditor
          w={w}
          h={h}
          crop={crop ?? { top: 0, bottom: 0, left: 0, right: 0 }}
          cellSize={cellSize}
          efpW={efp.w}
          efpH={efp.h}
          onCropChange={onCropChange}
        />
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
  isCropping,
  onCropToggle,
}: {
  character: Character & { gridPosition: GridPosition }
  runtimeState?: CharacterRuntimeState
  cellSize: number
  onSelect: (id: string | null) => void
  onRightClick: (characterId: string, x: number, y: number) => void
  activeTab: AppTab
  isSelected: boolean
  isCropping: boolean
  onCropToggle: (id: string) => void
}): ReactElement {
  const fp = character.footprint ?? { w: 2, h: 2 }
  const rotation = character.rotation ?? 0
  const flipX = character.flipX ?? false
  const flipY = character.flipY ?? false
  const crop = character.crop ?? null

  const efp = getEffectiveFootprint(fp, rotation)
  const x = character.gridPosition.x * cellSize
  const y = character.gridPosition.y * cellSize
  const w = efp.w * cellSize
  const h = efp.h * cellSize
  // Sprite raw pixel dims (pre-rotation)
  const sw = fp.w * cellSize
  const sh = fp.h * cellSize

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
      const gridX = Math.max(0, Math.min(gridCols - efp.w, Math.round(newPixelX / cellSize)))
      const gridY = Math.max(0, Math.min(gridRows - efp.h, Math.round(newPixelY / cellSize)))
      containerRef.current.x = gridX * cellSize
      containerRef.current.y = gridY * cellSize
    },
    [cellSize, efp.w, efp.h]
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

  const onCropChangeChar = useCallback(
    (newCrop: CropRect) => {
      window.api.invoke(IPC_COMMANDS.CHARACTER_UPDATE, character.id, { crop: newCrop })
    },
    [character.id]
  )

  // Rotation + flip transform
  const rotRad = (rotation * Math.PI) / 180
  const spritePivot = useMemo(() => {
    if (rotation === 90) return { x: 0, y: sh }
    if (rotation === 180) return { x: sw, y: sh }
    if (rotation === 270) return { x: sw, y: 0 }
    return { x: 0, y: 0 }
  }, [rotation, sw, sh])

  // Crop overlay draw (layout mode)
  const drawCropOverlay = useCallback(
    (g: PixiGraphics) => {
      if (!crop) return
      g.clear()
      g.beginFill(0x000000, 0.45)
      if (crop.top > 0) g.drawRect(0, 0, w, crop.top * cellSize)
      if (crop.bottom > 0) g.drawRect(0, h - crop.bottom * cellSize, w, crop.bottom * cellSize)
      const midY = crop.top * cellSize
      const midH = h - (crop.top + crop.bottom) * cellSize
      if (crop.left > 0) g.drawRect(0, midY, crop.left * cellSize, midH)
      if (crop.right > 0) g.drawRect(w - crop.right * cellSize, midY, crop.right * cellSize, midH)
      g.endFill()
    },
    [crop, w, h, cellSize]
  )

  // Crop mask — applied to sprite wrapper only (hidden in runtime + layout when not selected)
  const spriteWrapRef = useRef<PixiContainer | null>(null)
  const cropMaskRef = useRef<PixiGraphics | null>(null)
  const hasCrop = crop && (crop.top > 0 || crop.bottom > 0 || crop.left > 0 || crop.right > 0)
  const shouldMask = hasCrop && !(isLayout && isSelected)
  useEffect(() => {
    const wrap = spriteWrapRef.current
    if (!wrap || !shouldMask) {
      if (cropMaskRef.current) {
        if (wrap) wrap.mask = null
        cropMaskRef.current.destroy()
        cropMaskRef.current = null
      }
      return
    }
    const g = new PixiGraphics()
    g.beginFill(0xffffff)
    g.drawRect(
      crop!.left * cellSize,
      crop!.top * cellSize,
      (efp.w - crop!.left - crop!.right) * cellSize,
      (efp.h - crop!.top - crop!.bottom) * cellSize
    )
    g.endFill()
    wrap.addChild(g)
    wrap.mask = g
    cropMaskRef.current = g
    return () => {
      wrap.mask = null
      g.destroy()
      cropMaskRef.current = null
    }
  }, [shouldMask, crop?.top, crop?.bottom, crop?.left, crop?.right, cellSize, efp.w, efp.h])

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
      <Container ref={spriteWrapRef}>
        {texture ? (
          <>
            <Container
              scale={{ x: flipX ? -1 : 1, y: flipY ? -1 : 1 }}
              x={flipX ? w : 0}
              y={flipY ? h : 0}
            >
              <Container rotation={rotRad} pivot={spritePivot}>
                <Sprite texture={texture} width={sw} height={sh} />
              </Container>
            </Container>
            <StatusBadge status={character.status} w={w} runtimeState={runtimeState} />
          </>
        ) : (
          statusEffect
        )}
      </Container>
      {/* Crop overlay in layout mode */}
      {isLayout && isSelected && crop && !isCropping && (
        <Graphics draw={drawCropOverlay} />
      )}
      {!isLayout && isHoveredChar && <HoverBorder w={w} h={h} crop={crop} cellSize={cellSize} />}
      <Text
        text={character.name}
        x={w / 2}
        y={h + 4}
        anchor={{ x: 0.5, y: 0 }}
        style={labelStyle}
      />
      {showHandlesChar && (
        <>
          <SelectionBorder w={w} h={h} crop={crop} cellSize={cellSize} />
          <ResizeHandle
            parentW={w}
            parentH={h}
            cellSize={cellSize}
            itemPixelX={character.gridPosition.x * cellSize}
            itemPixelY={character.gridPosition.y * cellSize}
            onResize={onResizeCharacter}
            onDragStateChange={(d) => { isResizingChar.current = d }}
          />
          <SelectionControls
            parentW={w}
            parentH={h}
            onZUp={() => window.api.invoke(IPC_COMMANDS.CHARACTER_UPDATE, character.id, { zOrder: (character.zOrder ?? 0) + 1 })}
            onZDown={() => window.api.invoke(IPC_COMMANDS.CHARACTER_UPDATE, character.id, { zOrder: (character.zOrder ?? 0) - 1 })}
            onCropToggle={() => onCropToggle(character.id)}
            onMenu={(mx, my) => useUIStore.getState().openLayoutContextMenu('character', character.id, mx, my)}
            isCropping={isCropping}
          />
        </>
      )}
      {/* Crop editor handles */}
      {isLayout && isCropping && isSelected && (
        <CropEditor
          w={w}
          h={h}
          crop={crop ?? { top: 0, bottom: 0, left: 0, right: 0 }}
          cellSize={cellSize}
          efpW={efp.w}
          efpH={efp.h}
          onCropChange={onCropChangeChar}
        />
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

  // Track which item is in crop editing mode
  const [croppingItemId, setCroppingItemId] = useState<string | null>(null)

  const handleCropToggle = useCallback((id: string) => {
    setCroppingItemId((prev) => (prev === id ? null : id))
  }, [])

  // ESC to deselect / close context menu / exit crop mode, Ctrl+C / Ctrl+V copy-paste
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setCroppingItemId(null)
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
    setCroppingItemId(null)
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
              isCropping={croppingItemId === item.id}
              onCropToggle={handleCropToggle}
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
              isCropping={croppingItemId === item.id}
              onCropToggle={handleCropToggle}
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
              isCropping={croppingItemId === char.id}
              onCropToggle={handleCropToggle}
            />
          ))}
        </Container>
      </Container>
    </Stage>
    </div>
    </div>
  )
}
