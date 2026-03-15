import { useState, useCallback, useEffect } from 'react'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import { ASSET_SIZES } from '../../../shared/constants'
import { Button } from './ui/button'
import { Label } from './ui/label'
import type { AssetCategory, AssetGenerateRequest, AssetGenerateResult } from '../../../shared/types'

interface TemplateInfo {
  id: string
  label: string
  category: string
  prompt: string
  default_width: number
  default_height: number
}

interface GenerateDialogProps {
  defaultCategory: AssetCategory
  onClose: () => void
  onGenerated: (relativePath: string) => void
}

export function GenerateDialog({ defaultCategory, onClose, onGenerated }: GenerateDialogProps): JSX.Element {
  const [category, setCategory] = useState<AssetCategory>(defaultCategory)
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState(64)
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [lastRelativePath, setLastRelativePath] = useState<string | null>(null)
  const [statusText, setStatusText] = useState<string | null>(null)

  // Load templates from server
  useEffect(() => {
    const settings = window.api.invoke<{ apiBaseUrl?: string }>(IPC_COMMANDS.SETTINGS_READ)
    settings.then((s) => {
      const baseUrl = s?.apiBaseUrl || 'http://localhost:8000'
      fetch(`${baseUrl}/api/templates`)
        .then((res) => res.json())
        .then((data) => setTemplates(data))
        .catch(() => {/* server not running, templates empty */})
    })
  }, [])

  const filteredTemplates = templates.filter((t) => t.category === category)

  const handleTemplateSelect = useCallback((id: string) => {
    const tmpl = templates.find((t) => t.id === id)
    if (tmpl) {
      setTemplateId(id)
      setPrompt(tmpl.prompt)
      setSize(tmpl.default_width)
    }
  }, [templates])

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      setError('Please enter a prompt')
      return
    }

    setGenerating(true)
    setError(null)
    setPreviewUrl(null)
    setStatusText('Connecting to server...')

    const req: AssetGenerateRequest = {
      category,
      prompt: prompt.trim(),
      width: size,
      height: size,
      template_id: templateId,
    }

    try {
      setStatusText('Generating sprite...')
      const result = await window.api.invoke<AssetGenerateResult>(IPC_COMMANDS.ASSET_GENERATE, req)

      if (result.success && result.relativePath) {
        // Load preview
        const dataUrl = await window.api.invoke<string | null>(
          IPC_COMMANDS.ASSET_READ_BASE64,
          result.relativePath
        )
        setPreviewUrl(dataUrl)
        setLastRelativePath(result.relativePath)
        setStatusText(`Done in ${result.duration_ms ?? 0}ms`)
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
  }, [category, prompt, size, templateId])

  const handleUse = useCallback(() => {
    if (lastRelativePath) {
      onGenerated(lastRelativePath)
    }
  }, [lastRelativePath, onGenerated])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-border bg-background p-5 space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold">Generate Sprite</h3>

        {/* Category */}
        <div className="space-y-1.5">
          <Label className="text-sm">Category</Label>
          <div className="flex gap-2">
            {(['skin', 'furniture', 'background'] as AssetCategory[]).map((cat) => (
              <button
                key={cat}
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                  category === cat
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => { setCategory(cat); setTemplateId(null) }}
              >
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Template */}
        {filteredTemplates.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-sm">Template (optional)</Label>
            <select
              value={templateId || ''}
              onChange={(e) => e.target.value ? handleTemplateSelect(e.target.value) : setTemplateId(null)}
              className="w-full rounded-md border border-border bg-muted/30 px-3 py-1.5 text-sm"
            >
              <option value="">Custom prompt</option>
              {filteredTemplates.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Prompt */}
        <div className="space-y-1.5">
          <Label className="text-sm">Prompt</Label>
          <textarea
            value={prompt}
            onChange={(e) => { setPrompt(e.target.value); setTemplateId(null) }}
            placeholder={
              category === 'background'
                ? 'e.g., warm wooden plank floor with subtle grain'
                : category === 'furniture'
                  ? 'e.g., a standing desk with dual monitors'
                  : 'e.g., a developer wearing a hoodie'
            }
            rows={3}
            className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm resize-none"
          />
        </div>

        {/* Size */}
        <div className="space-y-1.5">
          <Label className="text-sm">Size</Label>
          <div className="flex gap-3">
            {ASSET_SIZES.map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="sprite-size"
                  checked={size === s}
                  onChange={() => setSize(s)}
                  className="accent-primary"
                />
                {s}x{s}
              </label>
            ))}
          </div>
        </div>

        {/* Preview */}
        {previewUrl && (
          <div className="flex justify-center">
            <div className="rounded-lg bg-muted/50 p-3 border border-border">
              <img
                src={previewUrl}
                alt="Generated sprite"
                className="w-32 h-32 object-contain"
                style={{ imageRendering: 'pixelated' }}
              />
            </div>
          </div>
        )}

        {/* Status / Error */}
        {generating && statusText && (
          <p className="text-xs text-muted-foreground text-center">{statusText}</p>
        )}
        {error && (
          <p className="text-xs text-red-500 text-center">{error}</p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          {previewUrl ? (
            <>
              <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generating}>
                Regenerate
              </Button>
              <Button size="sm" onClick={handleUse}>
                Use
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={handleGenerate} disabled={generating || !prompt.trim()}>
              {generating ? 'Generating...' : 'Generate'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
