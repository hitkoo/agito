import { useEffect, useState } from 'react'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import { AGITO_DIR_NAME } from '../../../shared/constants'
import { Label } from './ui/label'
import { useUIStore, type ThemeMode } from '../stores/ui-store'

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
      </div>
    </div>
  )
}
