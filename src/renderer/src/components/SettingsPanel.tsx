import { useEffect, useState } from 'react'
import { GripVertical } from 'lucide-react'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import { AGITO_DIR_NAME, MIN_GRID_COLS, MAX_GRID_COLS, MIN_GRID_ROWS, MAX_GRID_ROWS } from '../../../shared/constants'
import {
  getTerminalFontFamilySource,
  moveTerminalFontFamily,
  TERMINAL_FONT_SIZE_OPTIONS,
} from '../../../shared/settings'
import { Label } from './ui/label'
import { useUIStore, type ThemeMode } from '../stores/ui-store'
import { useRoomStore } from '../stores/room-store'
import { useSettingsStore } from '../stores/settings-store'

interface EngineDetectResult {
  found: boolean
  path?: string
  version?: string
}

interface EngineStatus {
  name: string
  key: string
  result: EngineDetectResult | null
  loading: boolean
}

const ENGINE_DISPLAY: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
}

const FONT_SOURCE_LABEL: Record<NonNullable<ReturnType<typeof getTerminalFontFamilySource>>, string> = {
  bundled: 'Bundled',
  system: 'System',
  fallback: 'Fallback',
}

export function SettingsPanel(): JSX.Element {
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const gridCols = useRoomStore((s) => s.gridCols)
  const gridRows = useRoomStore((s) => s.gridRows)
  const settings = useSettingsStore((s) => s.settings)
  const setTerminalFontSize = useSettingsStore((s) => s.setTerminalFontSize)
  const setTerminalFontFamilies = useSettingsStore((s) => s.setTerminalFontFamilies)
  const [draggingFamily, setDraggingFamily] = useState<string | null>(null)

  const [engines, setEngines] = useState<EngineStatus[]>([
    { name: 'Claude Code', key: 'claude-code', result: null, loading: true },
    { name: 'Codex', key: 'codex', result: null, loading: true },
  ])

  useEffect(() => {
    const keys = ['claude-code', 'codex'] as const

    keys.forEach(async (key) => {
      try {
        const result = await window.api.invoke<EngineDetectResult>(
          IPC_COMMANDS.ENGINE_DETECT_CLI,
          key
        )
        setEngines((prev) =>
          prev.map((e) => (e.key === key ? { ...e, result, loading: false } : e))
        )
      } catch {
        setEngines((prev) =>
          prev.map((e) =>
            e.key === key ? { ...e, result: { found: false }, loading: false } : e
          )
        )
      }
    })
  }, [])

  return (
    <div className="absolute inset-0 z-10 flex items-start justify-center overflow-y-auto styled-scroll bg-black/40 p-8">
      <div className="w-full max-w-2xl rounded-lg border border-border bg-background p-6 space-y-6">
        <h2 className="text-lg font-semibold">Settings</h2>

        {/* Engine CLI Status */}
        <section className="space-y-3">
          <Label className="text-base font-semibold">Engine CLI Status</Label>
          <div className="space-y-3">
            {engines.map((engine) => (
              <div
                key={engine.key}
                className="rounded-md border border-border bg-muted/30 p-3 space-y-1"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {ENGINE_DISPLAY[engine.key] ?? engine.name}
                  </span>
                  {engine.loading ? (
                    <span className="text-xs text-muted-foreground">Detecting...</span>
                  ) : engine.result?.found ? (
                    <span className="flex items-center gap-1 text-xs text-green-500">
                      <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                      Found
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-red-500">
                      <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                      Not Found
                    </span>
                  )}
                </div>
                {!engine.loading && engine.result?.found && (
                  <div className="space-y-0.5">
                    {engine.result.path && (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground/70">Path: </span>
                        {engine.result.path}
                      </p>
                    )}
                    {engine.result.version && (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground/70">Version: </span>
                        {engine.result.version}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Data Directory */}
        <section className="space-y-2">
          <Label className="text-base font-semibold">Data Directory</Label>
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
            <p className="text-sm font-mono text-muted-foreground">~/{AGITO_DIR_NAME}/</p>
          </div>
        </section>

        {/* Theme */}
        <section className="space-y-2">
          <Label className="text-base font-semibold">Theme</Label>
          <div className="flex flex-col gap-2">
            {(['system', 'light', 'dark'] as ThemeMode[]).map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="theme"
                  className="accent-primary"
                  checked={theme === option}
                  onChange={() => setTheme(option)}
                />
                <span className="capitalize">{option}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Terminal Font */}
        <section className="space-y-3">
          <Label className="text-base font-semibold">Terminal Font</Label>

          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Font Size</Label>
            <select
              value={settings.terminalFontSize}
              onChange={(event) => {
                void setTerminalFontSize(Number(event.target.value))
              }}
              className="h-10 w-full rounded-md border border-border bg-muted/30 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {TERMINAL_FONT_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Font Family Order</Label>
            <div className="rounded-md border border-border bg-muted/20">
              {settings.terminalFontFamilies.map((family, index) => (
                <div
                  key={family}
                  draggable
                  onDragStart={() => setDraggingFamily(family)}
                  onDragEnd={() => setDraggingFamily(null)}
                  onDragOver={(event) => {
                    event.preventDefault()
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (!draggingFamily || draggingFamily === family) return
                    void setTerminalFontFamilies(
                      moveTerminalFontFamily(
                        settings.terminalFontFamilies,
                        draggingFamily,
                        index,
                      ),
                    )
                    setDraggingFamily(null)
                  }}
                  className={`flex cursor-grab items-center gap-3 border-b border-border/70 px-3 py-2 text-sm last:border-b-0 ${
                    draggingFamily === family ? 'bg-muted/60' : 'bg-transparent'
                  }`}
                >
                  <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{family}</span>
                  <span className="ml-auto rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {FONT_SOURCE_LABEL[getTerminalFontFamilySource(family) ?? 'fallback']}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Drag to reorder the fallback stack used by terminal panes.
            </p>
          </div>
        </section>

        {/* Grid Size */}
        <section className="space-y-2">
          <Label className="text-base font-semibold">Grid Size</Label>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Width</span>
              <input
                type="number"
                min={MIN_GRID_COLS}
                max={MAX_GRID_COLS}
                value={gridCols}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (!isNaN(val)) useRoomStore.getState().setGridSize(val, gridRows)
                }}
                className="w-20 rounded-md border border-border bg-muted/30 px-2 py-1 text-sm"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Height</span>
              <input
                type="number"
                min={MIN_GRID_ROWS}
                max={MAX_GRID_ROWS}
                value={gridRows}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (!isNaN(val)) useRoomStore.getState().setGridSize(gridCols, val)
                }}
                className="w-20 rounded-md border border-border bg-muted/30 px-2 py-1 text-sm"
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Min {MIN_GRID_COLS}x{MIN_GRID_ROWS}, Max {MAX_GRID_COLS}x{MAX_GRID_ROWS}
          </p>
        </section>
      </div>
    </div>
  )
}
