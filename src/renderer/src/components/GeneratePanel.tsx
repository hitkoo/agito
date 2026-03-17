import { useState, useCallback } from 'react'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import { canAccessGenerate } from '../../../shared/auth'
import { Button } from './ui/button'
import { Label } from './ui/label'
import type { AssetCategory } from '../../../shared/types'
import { useAuthStore } from '../stores/auth-store'

interface GenerateResultItem {
  image_base64: string
  filename: string
  relativePath?: string
}

export function GeneratePanel(): JSX.Element {
  const authSession = useAuthStore((s) => s.session)
  const openAuthDialog = useAuthStore((s) => s.openDialog)
  const [category, setCategory] = useState<AssetCategory>('skin')
  const [prompt, setPrompt] = useState('')
  const [view, setView] = useState<'3/4' | 'iso'>('3/4')
  const [boost, setBoost] = useState(false)
  const [sourceImage, setSourceImage] = useState<string | null>(null)
  const [sourcePreview, setSourcePreview] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<GenerateResultItem[]>([])

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      setError('Please enter a prompt')
      return
    }

    setGenerating(true)
    setError(null)
    setResults([])
    const batchCount = category === 'background'
      ? (boost ? 20 : 4)
      : (boost ? 80 : 16)
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
        view: (category === 'skin' || category === 'furniture') ? view : undefined,
        source_image: category === 'skin' ? sourceImage : undefined,
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
  }, [category, prompt, view, boost, sourceImage])

  const handleSave = useCallback(
    async (item: GenerateResultItem) => {
      if (!item.relativePath) return
      setStatusText(`Saved: ${item.filename}`)
    },
    []
  )

  if (!canAccessGenerate(authSession.status)) {
    const isPendingVerification = authSession.status === 'pending_verification'

    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
        <div className="w-full max-w-md rounded-xl border border-border bg-muted/20 p-8 text-center shadow-lg">
          <h2 className="text-xl font-semibold">
            {isPendingVerification ? 'Verify your email' : 'Sign in to use Generate'}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {isPendingVerification
              ? 'Your account exists, but Generate stays locked until your email is verified.'
              : 'Local workspace features stay available, but image generation requires an account.'}
          </p>

          <div className="mt-6 flex justify-center gap-3">
            {!isPendingVerification && (
              <>
                <Button onClick={() => openAuthDialog('sign_in')}>Sign in</Button>
                <Button variant="outline" onClick={() => openAuthDialog('sign_up')}>
                  Create account
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 z-10 flex bg-background">
      {/* Left: Controls */}
      <div className="w-[360px] h-full border-r border-border flex flex-col shrink-0">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Generate</h2>
        </div>

        <div className="flex-1 overflow-y-auto styled-scroll p-4 space-y-4">
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
                  onClick={() => setCategory(cat)}
                >
                  {cat === 'skin' ? 'Skin' : cat === 'furniture' ? 'Furniture' : 'Background'}
                </button>
              ))}
            </div>
          </div>

          {/* View (skin and furniture) */}
          {(category === 'skin' || category === 'furniture') && (
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

          {/* Prompt */}
          <div className="space-y-1.5">
            <Label className="text-sm">Prompt</Label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
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
      <div className="flex-1 h-full overflow-y-auto styled-scroll p-6">
        {results.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Generated images will appear here
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-3">
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
