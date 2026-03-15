import { useEffect, useState, useCallback } from 'react'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import { AGITO_DIR_NAME, MIN_GRID_COLS, MAX_GRID_COLS, MIN_GRID_ROWS, MAX_GRID_ROWS, DEFAULT_SETTINGS } from '../../../shared/constants'
import { Label } from './ui/label'
import { Button } from './ui/button'
import { useUIStore, type ThemeMode } from '../stores/ui-store'
import { useRoomStore } from '../stores/room-store'
import type { AgitoSettings } from '../../../shared/types'

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

export function SettingsPanel(): JSX.Element {
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const gridCols = useRoomStore((s) => s.gridCols)
  const gridRows = useRoomStore((s) => s.gridRows)

  // --- AI Settings ---
  const [geminiApiKey, setGeminiApiKey] = useState<string>('')
  const [geminiModel, setGeminiModel] = useState<string>(DEFAULT_SETTINGS.geminiModel)
  const [apiBaseUrl, setApiBaseUrl] = useState<string>(DEFAULT_SETTINGS.apiBaseUrl)
  const [settingsSaved, setSettingsSaved] = useState(false)

  useEffect(() => {
    window.api.invoke<AgitoSettings>(IPC_COMMANDS.SETTINGS_READ).then((s) => {
      if (s) {
        setGeminiApiKey(s.geminiApiKey || '')
        setGeminiModel(s.geminiModel || DEFAULT_SETTINGS.geminiModel)
        setApiBaseUrl(s.apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl)
      }
    })
  }, [])

  const saveAiSettings = useCallback(async () => {
    const settings: AgitoSettings = {
      geminiApiKey,
      geminiModel,
      apiBaseUrl,
      defaultSpriteSize: DEFAULT_SETTINGS.defaultSpriteSize,
    }
    await window.api.invoke(IPC_COMMANDS.SETTINGS_WRITE, settings)
    setSettingsSaved(true)
    setTimeout(() => setSettingsSaved(false), 2000)
  }, [geminiApiKey, geminiModel, apiBaseUrl])

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
    <div className="absolute inset-0 z-10 flex items-start justify-center overflow-y-auto bg-black/40 p-8">
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
                    <span className="text-xs text-muted-foreground">Detecting…</span>
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

        {/* AI Sprite Generation */}
        <section className="space-y-3">
          <Label className="text-base font-semibold">AI Sprite Generation</Label>
          <div className="space-y-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="api-base-url" className="text-sm">Server URL</Label>
              <input
                id="api-base-url"
                type="text"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                placeholder="http://localhost:8000"
                className="rounded-md border border-border bg-muted/30 px-3 py-1.5 text-sm font-mono"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gemini-key" className="text-sm">Gemini API Key</Label>
              <input
                id="gemini-key"
                type="password"
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
                placeholder="AIza..."
                className="rounded-md border border-border bg-muted/30 px-3 py-1.5 text-sm font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Get a key from aistudio.google.com. Configured on the server via AGITO_GEMINI_API_KEY env var.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gemini-model" className="text-sm">Model</Label>
              <select
                id="gemini-model"
                value={geminiModel}
                onChange={(e) => setGeminiModel(e.target.value)}
                className="rounded-md border border-border bg-muted/30 px-3 py-1.5 text-sm"
              >
                <option value="gemini-3.1-flash-image-preview">Nano Banana 2 (gemini-3.1-flash)</option>
                <option value="gemini-3-pro-image-preview">Nano Banana Pro (gemini-3-pro)</option>
                <option value="gemini-2.5-flash-image">Nano Banana (gemini-2.5-flash, budget)</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={saveAiSettings}>
                Save
              </Button>
              {settingsSaved && <span className="text-xs text-green-500">Saved</span>}
            </div>
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
