import { useState, useCallback, useEffect } from 'react'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import { Button } from './ui/button'
import { Label } from './ui/label'
import type { AssetCategory, AssetGenerateResult } from '../../../shared/types'

interface TemplateInfo {
  id: string
  label: string
  category: string
  prompt: string
}

interface GenerateResultItem {
  image_base64: string
  filename: string
  relativePath?: string
}

export function GeneratePanel(): JSX.Element {
  const [category, setCategory] = useState<AssetCategory>('skin')
  const [prompt, setPrompt] = useState('')
  const [view, setView] = useState<'3/4' | 'iso'>('3/4')
  const [boost, setBoost] = useState(false)
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [sourceImage, setSourceImage] = useState<string | null>(null)
  const [sourcePreview, setSourcePreview] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<GenerateResultItem[]>([])

  // Load templates from server via IPC
  useEffect(() => {
    window.api
      .invoke<TemplateInfo[]>(IPC_COMMANDS.ASSET_LIST_TEMPLATES)
      .then((data) => setTemplates(data ?? []))
      .catch(() => {})
  }, [])

  const filteredTemplates = templates.filter((t) => t.category === category)

  const handleTemplateSelect = useCallback(
    (id: string) => {
      const tmpl = templates.find((t) => t.id === id)
      if (tmpl) {
        setTemplateId(id)
        setPrompt(tmpl.prompt)
      }
    },
    [templates]
  )

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      setError('Please enter a prompt')
      return
    }

    setGenerating(true)
    setError(null)
    setResults([])
    const batchCount = boost ? 20 : 4
    setStatusText(boost ? 'Generating ×5 boost...' : 'Generating...')

    try {
      const result = await window.api.invoke<{
        success: boolean
        results: GenerateResultItem[]
        error?: string
        duration_ms?: number
      }>(IPC_COMMANDS.ASSET_GENERATE, {
        category,
        prompt: prompt.trim(),
        width: 512,
        height: 512,
        view: category === 'skin' ? view : undefined,
        source_image: category === 'skin' ? sourceImage : undefined,
        template_id: templateId,
        batch_count: batchCount,
      })

      if (result.success && result.results?.length > 0) {
        setResults(result.results)
        setStatusText(
          `Done! ${result.results.length} image${result.results.length > 1 ? 's' : ''} in ${result.duration_ms ?? 0}ms`
        )
      } else {
        setError(result.error || 'Generation failed')
        setStatusText(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
      setStatusText(null)
    } finally {
      setGenerating(false)
    }
  }, [category, prompt, view, boost, templateId])

  const handleSave = useCallback(
    async (item: GenerateResultItem) => {
      if (!item.relativePath) return
      // Already saved by server, just notify
      setStatusText(`Saved: ${item.filename}`)
    },
    []
  )

  return (
    <div className="absolute inset-0 z-10 flex bg-background">
      {/* Left: Controls */}
      <div className="w-[360px] h-full border-r border-border flex flex-col shrink-0">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Generate</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Category */}
          <div className="space-y-1.5">
            <Label className="text-sm">Category</Label>
            <div className="flex gap-1.5">
              {(['skin', 'furniture', 'background'] as AssetCategory[]).map((cat) => (
                <button
                  key={cat}
                  className={`flex-1 rounded-md py-2 text-xs font-medium transition-colors ${
                    category === cat
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => {
                    setCategory(cat)
                    setTemplateId(null)
                  }}
                >
                  {cat === 'skin' ? 'Skin' : cat === 'furniture' ? 'Furniture' : 'Background'}
                </button>
              ))}
            </div>
          </div>

          {/* View (skin only) */}
          {category === 'skin' && (
            <div className="space-y-1.5">
              <Label className="text-sm">View</Label>
              <div className="flex gap-1.5">
                {([['3/4', '3/4 View'], ['iso', 'Isometric']] as const).map(([v, label]) => (
                  <button
                    key={v}
                    className={`flex-1 rounded-md py-2 text-xs font-medium transition-colors ${
                      view === v
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() => setView(v)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Template */}
          {filteredTemplates.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-sm">Template</Label>
              <select
                value={templateId || ''}
                onChange={(e) =>
                  e.target.value ? handleTemplateSelect(e.target.value) : setTemplateId(null)
                }
                className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
              >
                <option value="">Custom prompt</option>
                {filteredTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Prompt */}
          <div className="space-y-1.5">
            <Label className="text-sm">Prompt</Label>
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value)
                setTemplateId(null)
              }}
              placeholder={
                category === 'background'
                  ? 'e.g., cozy office with warm lighting'
                  : category === 'furniture'
                    ? 'e.g., a standing desk with dual monitors'
                    : 'e.g., a developer wearing a hoodie'
              }
              rows={4}
              className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm resize-none"
            />
          </div>

          {/* Source Image (skin only) */}
          {category === 'skin' && (
            <div className="space-y-1.5">
              <Label className="text-sm">Source Image (optional)</Label>
              {sourcePreview ? (
                <div className="flex items-center gap-2">
                  <div className="w-16 h-16 rounded border bg-muted/50 flex items-center justify-center overflow-hidden">
                    <img src={sourcePreview} alt="Source" className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => { setSourceImage(null); setSourcePreview(null) }}>
                    Remove
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={async () => {
                    const relPath = await window.api.invoke<string | null>(IPC_COMMANDS.ASSET_UPLOAD, 'skin')
                    if (relPath) {
                      const dataUrl = await window.api.invoke<string | null>(IPC_COMMANDS.ASSET_READ_BASE64, relPath)
                      if (dataUrl) {
                        setSourceImage(dataUrl.split(',')[1] || '')
                        setSourcePreview(dataUrl)
                      }
                    }
                  }}
                >
                  Upload source image
                </Button>
              )}
              <p className="text-[10px] text-muted-foreground">Converts source character to chibi pixel art, keeping identity.</p>
            </div>
          )}

          {/* Boost toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={boost}
              onChange={(e) => setBoost(e.target.checked)}
              className="accent-primary"
            />
            <span className="text-sm">Boost mode (×5)</span>
          </label>

          {/* Generate Button */}
          <Button
            className="w-full"
            onClick={handleGenerate}
            disabled={generating || !prompt.trim()}
          >
            {generating ? 'Generating...' : boost ? 'Generate (×5)' : 'Generate'}
          </Button>

          {/* Status / Error */}
          {statusText && <p className="text-xs text-muted-foreground text-center">{statusText}</p>}
          {error && <p className="text-xs text-red-500 text-center">{error}</p>}
        </div>
      </div>

      {/* Right: Results Grid */}
      <div className="flex-1 h-full overflow-y-auto p-6">
        {results.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Generated images will appear here
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {results.map((item, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-border bg-muted/20 overflow-hidden"
              >
                <div className="aspect-square flex items-center justify-center bg-muted/30 p-2">
                  <img
                    src={`data:image/png;base64,${item.image_base64}`}
                    alt={item.filename}
                    className="max-w-full max-h-full object-contain"
                    style={{ imageRendering: 'pixelated' }}
                  />
                </div>
                <div className="flex items-center justify-between p-2 border-t border-border">
                  <span className="text-xs text-muted-foreground truncate">{item.filename}</span>
                  <Button variant="outline" size="sm" onClick={() => handleSave(item)}>
                    Save
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
