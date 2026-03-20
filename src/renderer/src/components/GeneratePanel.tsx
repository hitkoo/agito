import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCcw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import { canAccessGenerate } from '../../../shared/auth'
import { canAffordGenerate, getGenerateCreditCost } from '../../../shared/billing'
import type { AssetCategory, AssetGenerateRequest, GenerateJob, GenerateJobPreviewUrls, GenerateJobResultItem } from '../../../shared/types'
import { Button } from './ui/button'
import { Label } from './ui/label'
import { BuyCreditsPanel } from './BuyCreditsPanel'
import { GitoTokenIcon } from './GitoTokenIcon'
import { useAuthStore } from '../stores/auth-store'
import { useBillingStore } from '../stores/billing-store'
import { useUIStore } from '../stores/ui-store'
import { isGenerateJobRecoverable } from '../lib/generate-job-recovery'
import { shouldHydrateSelectedGenerateJobDetail } from '../lib/generate-job-detail'
import {
  GENERATED_PREVIEW_RETRY_COOLDOWN_MS,
  shouldRequestGeneratedPreview,
} from '../lib/generated-preview-retry'

function buildResultPreviewKey(jobId: string, resultId: number): string {
  return `result:${jobId}:${resultId}`
}

function buildInputPreviewKey(jobId: string, kind: 'source' | 'reference'): string {
  return `input:${jobId}:${kind}`
}

const ACTIVE_JOB_POLL_INTERVAL_MS = 5000

function formatJobStatus(status: GenerateJob['status']): string {
  return {
    queued: 'Queued',
    running: 'Running',
    succeeded: 'Completed',
    partial_success: 'Partial',
    failed: 'Failed',
  }[status]
}

function statusClassName(status: GenerateJob['status']): string {
  return {
    queued: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    running: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
    succeeded: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    partial_success: 'bg-orange-500/10 text-orange-300 border-orange-500/20',
    failed: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
  }[status]
}

function getGitoHistoryLabel(job: GenerateJob): string {
  if (job.status === 'queued' || job.status === 'running') {
    return `${job.reservedCredits} Gito reserved`
  }
  if (job.status === 'succeeded') {
    return `${job.chargedCredits || job.reservedCredits} Gito charged`
  }
  if (job.status === 'partial_success' || job.status === 'failed') {
    return `${job.reservedCredits} Gito refunded`
  }
  return `${job.reservedCredits} Gito`
}

export function GeneratePanel(): JSX.Element {
  const authSession = useAuthStore((s) => s.session)
  const openAuthDialog = useAuthStore((s) => s.openDialog)
  const balanceCredits = useBillingStore((s) => s.balanceCredits)
  const billingLoading = useBillingStore((s) => s.loading)
  const loadBilling = useBillingStore((s) => s.loadFromMain)
  const setBalanceCredits = useBillingStore((s) => s.setBalanceCredits)
  const generateView = useUIStore((s) => s.generateView)
  const preferredGenerateCategory = useUIStore((s) => s.preferredGenerateCategory)
  const consumePreferredGenerateCategory = useUIStore((s) => s.consumePreferredGenerateCategory)
  const openBuyCredits = useUIStore((s) => s.openBuyCredits)
  const [category, setCategory] = useState<AssetCategory>('skin')
  const [prompt, setPrompt] = useState('')
  const [view, setView] = useState<'3/4' | 'iso'>('3/4')
  const [sourceImage, setSourceImage] = useState<string | null>(null)
  const [sourcePreview, setSourcePreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [jobsLoading, setJobsLoading] = useState(false)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [jobs, setJobs] = useState<GenerateJob[]>([])
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [detailLoadingByJobId, setDetailLoadingByJobId] = useState<Record<string, boolean>>({})
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const [previewLoading, setPreviewLoading] = useState<Record<string, boolean>>({})
  const [previewFailedAt, setPreviewFailedAt] = useState<Record<string, number | null>>({})
  const previewRequestVersionRef = useRef(0)
  const jobsLoadPromiseRef = useRef<Promise<GenerateJob[]> | null>(null)
  const detailLoadPromisesRef = useRef<Record<string, Promise<GenerateJob> | undefined>>({})

  const costCredits = getGenerateCreditCost()
  const hasEnoughCredits = canAffordGenerate({ balanceCredits })
  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null,
    [jobs, selectedJobId]
  )
  const activeJobs = useMemo(
    () => jobs.filter((job) => job.status === 'queued' || job.status === 'running'),
    [jobs]
  )
  const previousActiveJobCountRef = useRef(0)
  const selectedJobDetailLoading = selectedJob ? Boolean(detailLoadingByJobId[selectedJob.id]) : false

  const handleRefreshBalance = useCallback(async () => {
    try {
      await loadBilling()
      toast.success('Balance refreshed')
    } catch (refreshError) {
      toast.error(refreshError instanceof Error ? refreshError.message : 'Failed to refresh balance')
    }
  }, [loadBilling])

  const mergeJobs = useCallback((incoming: GenerateJob[]) => {
    setJobs((previous) => {
      const previousById = new Map(previous.map((job) => [job.id, job]))
      return incoming.map((job) => {
        const old = previousById.get(job.id)
        if (!old) return job
        return {
          ...old,
          ...job,
          results: job.results.length > 0 ? job.results : old.results,
        }
      })
    })
  }, [])

  const loadJobs = useCallback(async () => {
    if (jobsLoadPromiseRef.current) return jobsLoadPromiseRef.current
    setJobsLoading(true)
    const request = (async () => {
      const nextJobs = await window.api.invoke<GenerateJob[]>(IPC_COMMANDS.ASSET_GENERATE_JOB_LIST)
      mergeJobs(nextJobs)
      setSelectedJobId((previous) => {
        if (previous && nextJobs.some((job) => job.id === previous)) return previous
        return nextJobs[0]?.id ?? null
      })
      return nextJobs
    })()
    jobsLoadPromiseRef.current = request
    try {
      return await request
    } finally {
      jobsLoadPromiseRef.current = null
      setJobsLoading(false)
    }
  }, [mergeJobs])

  const loadJobDetail = useCallback(async (jobId: string) => {
    const existingRequest = detailLoadPromisesRef.current[jobId]
    if (existingRequest) return existingRequest

    setDetailLoadingByJobId((previous) => ({ ...previous, [jobId]: true }))
    const request = (async () => {
      const detail = await window.api.invoke<GenerateJob>(IPC_COMMANDS.ASSET_GENERATE_JOB_DETAIL, jobId)
      setJobs((previous) => {
        const exists = previous.some((job) => job.id === detail.id)
        if (!exists) return [detail, ...previous]
        return previous.map((job) => (job.id === detail.id ? detail : job))
      })
      return detail
    })()
    detailLoadPromisesRef.current[jobId] = request
    try {
      return await request
    } finally {
      delete detailLoadPromisesRef.current[jobId]
      setDetailLoadingByJobId((previous) => ({ ...previous, [jobId]: false }))
    }
  }, [])

  useEffect(() => {
    if (generateView !== 'generator' || !preferredGenerateCategory) {
      return
    }
    setCategory(preferredGenerateCategory)
    if (preferredGenerateCategory !== 'skin') {
      setSourceImage(null)
      setSourcePreview(null)
    }
    consumePreferredGenerateCategory()
  }, [consumePreferredGenerateCategory, generateView, preferredGenerateCategory])

  useEffect(() => {
    if (!canAccessGenerate(authSession.status) || generateView === 'buy_credits') {
      return
    }
    void loadJobs().catch((loadError) => {
      console.error('[GENERATE] Failed to load jobs', loadError)
    })
  }, [authSession.status, generateView, loadJobs])

  useEffect(() => {
    if (generateView === 'buy_credits') return
    if (!selectedJob) return
    if (!shouldHydrateSelectedGenerateJobDetail(selectedJob)) return

    void loadJobDetail(selectedJob.id).catch((loadError) => {
      console.error('[GENERATE] Failed to load selected job detail', loadError)
    })
  }, [generateView, loadJobDetail, selectedJob])

  useEffect(() => {
    if (generateView === 'buy_credits') return
    if (activeJobs.length === 0) return

    const interval = window.setInterval(() => {
      void loadJobs()
        .then(() => {})
        .catch((pollError) => {
          console.error('[GENERATE] Failed to poll jobs', pollError)
        })
      if (selectedJob?.id && (selectedJob.status === 'queued' || selectedJob.status === 'running')) {
        void loadJobDetail(selectedJob.id).catch((pollError) => {
          console.error('[GENERATE] Failed to poll selected job detail', pollError)
        })
      }
    }, ACTIVE_JOB_POLL_INTERVAL_MS)

    return () => window.clearInterval(interval)
  }, [activeJobs.length, generateView, loadJobDetail, loadJobs, selectedJob?.id, selectedJob?.status])

  useEffect(() => {
    if (generateView === 'buy_credits') return
    const previousCount = previousActiveJobCountRef.current
    if (previousCount > activeJobs.length) {
      void loadBilling().catch((loadError) => {
        console.error('[GENERATE] Failed to refresh billing after job completion', loadError)
      })
    }
    previousActiveJobCountRef.current = activeJobs.length
  }, [activeJobs.length, generateView, loadBilling])

  useEffect(() => {
    if (!selectedJob) {
      setPreviewUrls({})
      setPreviewLoading({})
      setPreviewFailedAt({})
      return
    }

    const allowedKeys = new Set<string>()
    if (selectedJob.hasSourceImage) {
      allowedKeys.add(buildInputPreviewKey(selectedJob.id, 'source'))
    }
    if (selectedJob.hasReferenceImage) {
      allowedKeys.add(buildInputPreviewKey(selectedJob.id, 'reference'))
    }
    for (const result of selectedJob.results) {
      allowedKeys.add(buildResultPreviewKey(selectedJob.id, result.id))
    }

    const filterState = <T extends Record<string, unknown>>(state: T): T =>
      Object.fromEntries(Object.entries(state).filter(([key]) => allowedKeys.has(key))) as T

    setPreviewUrls((previous) => filterState(previous))
    setPreviewLoading((previous) => filterState(previous))
    setPreviewFailedAt((previous) => filterState(previous))
  }, [selectedJob])

  useEffect(() => {
    if (!selectedJob || generateView === 'buy_credits') return

    const pendingKeys: string[] = []
    const now = Date.now()

    if (selectedJob.hasSourceImage) {
      const key = buildInputPreviewKey(selectedJob.id, 'source')
      if (shouldRequestGeneratedPreview({
        url: previewUrls[key],
        isLoading: Boolean(previewLoading[key]),
        failedAt: previewFailedAt[key],
        now,
        retryCooldownMs: GENERATED_PREVIEW_RETRY_COOLDOWN_MS,
      })) {
        pendingKeys.push(key)
      }
    }
    if (selectedJob.hasReferenceImage) {
      const key = buildInputPreviewKey(selectedJob.id, 'reference')
      if (shouldRequestGeneratedPreview({
        url: previewUrls[key],
        isLoading: Boolean(previewLoading[key]),
        failedAt: previewFailedAt[key],
        now,
        retryCooldownMs: GENERATED_PREVIEW_RETRY_COOLDOWN_MS,
      })) {
        pendingKeys.push(key)
      }
    }
    for (const result of selectedJob.results) {
      const key = buildResultPreviewKey(selectedJob.id, result.id)
      if (shouldRequestGeneratedPreview({
        url: previewUrls[key],
        isLoading: Boolean(previewLoading[key]),
        failedAt: previewFailedAt[key],
        now,
        retryCooldownMs: GENERATED_PREVIEW_RETRY_COOLDOWN_MS,
      })) {
        pendingKeys.push(key)
      }
    }
    if (pendingKeys.length === 0) return

    const requestVersion = ++previewRequestVersionRef.current
    setPreviewLoading((previous) => ({
      ...previous,
      ...Object.fromEntries(pendingKeys.map((key) => [key, true])),
    }))
    setPreviewFailedAt((previous) => ({
      ...previous,
      ...Object.fromEntries(pendingKeys.map((key) => [key, null])),
    }))

    void window.api.invoke<GenerateJobPreviewUrls>(
      IPC_COMMANDS.ASSET_GENERATE_JOB_GET_PREVIEW_URLS,
      selectedJob.id
    ).then((batch) => {
      if (previewRequestVersionRef.current !== requestVersion) return
      const nextUrls: Record<string, string> = {}
      if (batch.sourceImageUrl) {
        nextUrls[buildInputPreviewKey(selectedJob.id, 'source')] = batch.sourceImageUrl
      }
      if (batch.referenceImageUrl) {
        nextUrls[buildInputPreviewKey(selectedJob.id, 'reference')] = batch.referenceImageUrl
      }
      for (const result of batch.results) {
        nextUrls[buildResultPreviewKey(selectedJob.id, result.resultId)] = result.signedUrl
      }
      setPreviewUrls((previous) => ({ ...previous, ...nextUrls }))
      const failedAt = Date.now()
      setPreviewFailedAt((previous) => ({
        ...previous,
        ...Object.fromEntries(
          pendingKeys.map((key) => [key, nextUrls[key] ? null : failedAt])
        ),
      }))
    }).catch((previewError) => {
      if (previewRequestVersionRef.current !== requestVersion) return
      console.error('[GENERATE] Failed to load preview urls', previewError)
      const failedAt = Date.now()
      setPreviewFailedAt((previous) => ({
        ...previous,
        ...Object.fromEntries(pendingKeys.map((key) => [key, failedAt])),
      }))
    }).finally(() => {
      if (previewRequestVersionRef.current !== requestVersion) return
      setPreviewLoading((previous) => ({
        ...previous,
        ...Object.fromEntries(pendingKeys.map((key) => [key, false])),
      }))
    })
  }, [generateView, previewFailedAt, previewLoading, previewUrls, selectedJob])

  const resetPreviewStateForJob = useCallback((job: GenerateJob) => {
    const resultPrefix = `result:${job.id}:`
    const sourceKey = buildInputPreviewKey(job.id, 'source')
    const referenceKey = buildInputPreviewKey(job.id, 'reference')

    const dropJobKeys = <T extends Record<string, unknown>>(state: T): T =>
      Object.fromEntries(
        Object.entries(state).filter(([key]) => (
          key !== sourceKey &&
          key !== referenceKey &&
          !key.startsWith(resultPrefix)
        ))
      ) as T

    setPreviewUrls((previous) => dropJobKeys(previous))
    setPreviewLoading((previous) => dropJobKeys(previous))
    setPreviewFailedAt((previous) => dropJobKeys(previous))
  }, [])

  const handleRefreshDetails = useCallback(async (job: GenerateJob) => {
    resetPreviewStateForJob(job)
    await loadJobDetail(job.id)
  }, [loadJobDetail, resetPreviewStateForJob])

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      setError('Please enter a prompt')
      return
    }

    if (!hasEnoughCredits) {
      setError(`You need ${costCredits} Gito to queue this generation.`)
      return
    }

    setSubmitting(true)
    setError(null)
    setStatusText('Queueing generation...')

    const batchCount = category === 'background' ? 4 : 16

    try {
      const job = await window.api.invoke<GenerateJob>(IPC_COMMANDS.ASSET_GENERATE_JOB_SUBMIT, {
        category,
        prompt: prompt.trim(),
        width: 512,
        height: 512,
        view: (category === 'skin' || category === 'furniture') ? view : undefined,
        source_image: category === 'skin' ? sourceImage : undefined,
        batch_count: batchCount,
      } satisfies AssetGenerateRequest)

      setJobs((previous) => [job, ...previous.filter((item) => item.id !== job.id)])
      setSelectedJobId(job.id)
      void loadJobDetail(job.id).catch((loadError) => {
        console.error('[GENERATE] Failed to load queued job detail', loadError)
      })
      setBalanceCredits((current) => Math.max(0, current - job.reservedCredits))
      setStatusText(`Queued · -${job.reservedCredits} Gito reserved`)
      toast.success('Generation queued')
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Failed to queue generation'
      setError(message)
      setStatusText(null)
    } finally {
      setSubmitting(false)
    }
  }, [
    category,
    costCredits,
    hasEnoughCredits,
    loadJobDetail,
    prompt,
    setBalanceCredits,
    sourceImage,
    view,
  ])

  const handleSave = useCallback(async (job: GenerateJob, result: GenerateJobResultItem) => {
    try {
      const saved = await window.api.invoke<{ relativePath: string }>(
        IPC_COMMANDS.ASSET_GENERATE_JOB_SAVE_RESULT,
        {
          category: job.category,
          jobId: job.id,
          resultId: result.id,
          filename: result.filename,
        }
      )
      setStatusText(`Saved: ${saved.relativePath}`)
      toast.success('Saved to library')
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Failed to save result')
    }
  }, [])

  const handleRecover = useCallback(async (jobId: string) => {
    try {
      const recovered = await window.api.invoke<GenerateJob>(IPC_COMMANDS.ASSET_GENERATE_JOB_RECOVER, jobId)
      setJobs((previous) => previous.map((job) => (job.id === recovered.id ? recovered : job)))
      await loadBilling()
      toast.success('Recovered stuck job')
    } catch (recoverError) {
      toast.error(recoverError instanceof Error ? recoverError.message : 'Failed to recover job')
    }
  }, [loadBilling])

  if (!canAccessGenerate(authSession.status)) {
    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
        <div className="w-full max-w-md rounded-xl border border-border bg-muted/20 p-8 text-center shadow-lg">
          <h2 className="text-xl font-semibold">Sign in to use Generate</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Local workspace features stay available, but image generation requires an account.
          </p>

          <div className="mt-6 flex justify-center gap-3">
            <Button onClick={() => openAuthDialog('sign_in')}>Sign in</Button>
            <Button variant="outline" onClick={() => openAuthDialog('sign_up')}>
              Create account
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (generateView === 'buy_credits') {
    return <BuyCreditsPanel />
  }

  return (
    <div className="absolute inset-0 z-10 flex bg-background">
      <div className="flex h-full w-[360px] shrink-0 flex-col border-r border-border">
        <div className="border-b border-border p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Generate</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Generate: 50 Gito
              </p>
            </div>

            <Button variant="outline" size="sm" onClick={openBuyCredits}>
              Buy Gito
            </Button>
          </div>

          <div className="mt-3 rounded-lg border border-border/80 bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <GitoTokenIcon size={14} className="h-3.5 w-3.5" />
                <span>Current balance</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{balanceCredits.toLocaleString()} Gito</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => void handleRefreshBalance()}
                  disabled={billingLoading}
                  title="Refresh balance"
                >
                  <RefreshCcw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto styled-scroll p-4">
          <div className="space-y-1.5">
            <Label className="text-sm">Category</Label>
            <div className="flex gap-1.5">
              {(['skin', 'furniture', 'background'] as AssetCategory[]).map((nextCategory) => (
                <button
                  key={nextCategory}
                  className={`flex-1 rounded-md py-2 text-xs font-medium transition-colors ${
                    category === nextCategory
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setCategory(nextCategory)}
                >
                  {nextCategory === 'skin' ? 'Skin' : nextCategory === 'furniture' ? 'Furniture' : 'Background'}
                </button>
              ))}
            </div>
          </div>

          {(category === 'skin' || category === 'furniture') && (
            <div className="space-y-1.5">
              <Label className="text-sm">View</Label>
              <div className="flex gap-1.5">
                {([['3/4', '3/4 View'], ['iso', 'Isometric']] as const).map(([nextView, label]) => (
                  <button
                    key={nextView}
                    className={`flex-1 rounded-md py-2 text-xs font-medium transition-colors ${
                      view === nextView
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() => setView(nextView)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

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
              className="w-full resize-none rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
            />
          </div>

          {category === 'skin' && (
            <div className="space-y-1.5">
              <Label className="text-sm">Source Image (optional)</Label>
              {sourcePreview ? (
                <div className="flex items-center gap-2">
                  <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded border bg-muted/50">
                    <img
                      src={sourcePreview}
                      alt="Source"
                      className="h-full w-full object-contain"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSourceImage(null)
                      setSourcePreview(null)
                    }}
                  >
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
                    if (!relPath) return

                    const dataUrl = await window.api.invoke<string | null>(IPC_COMMANDS.ASSET_READ_BASE64, relPath)
                    if (!dataUrl) return

                    setSourceImage(dataUrl.split(',')[1] || '')
                    setSourcePreview(dataUrl)
                  }}
                >
                  Upload source image
                </Button>
              )}
              <p className="text-[10px] text-muted-foreground">
                Converts a source character into chibi pixel art while keeping identity cues.
              </p>
            </div>
          )}

          <div className="rounded-lg border border-border/80 bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">This run costs</span>
              <span className="font-semibold">{costCredits} Gito</span>
            </div>
            {!hasEnoughCredits && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-md bg-background/80 px-3 py-2 text-xs">
                <span className="text-muted-foreground">Need more Gito?</span>
                <Button variant="outline" size="sm" onClick={openBuyCredits}>
                  Buy Gito
                </Button>
              </div>
            )}
          </div>

          <Button
            className="w-full"
            onClick={() => void handleGenerate()}
            disabled={submitting || !prompt.trim() || !hasEnoughCredits}
          >
            {submitting ? 'Queueing...' : 'Queue Generate'}
          </Button>

          {statusText && <p className="text-center text-xs text-muted-foreground">{statusText}</p>}
          {error && <p className="text-center text-xs text-red-500">{error}</p>}
        </div>
      </div>

      <div className="flex h-full w-[320px] shrink-0 flex-col border-r border-border bg-muted/10">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">Run History</h3>
            <p className="text-[11px] text-muted-foreground">Queued and completed generations</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => void loadJobs()}
            disabled={jobsLoading}
            title="Refresh jobs"
          >
            {jobsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto styled-scroll p-3">
          {jobs.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <Sparkles className="h-5 w-5" />
              <p>Your queued jobs will appear here</p>
            </div>
          ) : (
            <div className="space-y-2">
              {jobs.map((job) => (
                <button
                  key={job.id}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    selectedJob?.id === job.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-background hover:bg-muted/20'
                  }`}
                  onClick={() => setSelectedJobId(job.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{job.prompt}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {new Date(job.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${statusClassName(job.status)}`}>
                      {formatJobStatus(job.status)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{job.category}</span>
                    <span>{getGitoHistoryLabel(job)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 h-full overflow-y-auto styled-scroll p-6">
        {!selectedJob ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <Sparkles className="h-5 w-5" />
            <p>Select a run to inspect its results</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold">{selectedJob.prompt}</h3>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${statusClassName(selectedJob.status)}`}>
                    {formatJobStatus(selectedJob.status)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedJob.category} · reserved {selectedJob.reservedCredits} Gito
                  {selectedJob.chargedCredits > 0 ? ` · charged ${selectedJob.chargedCredits} Gito` : ''}
                  {selectedJob.status === 'partial_success' ? ' · refunded' : ''}
                  {selectedJob.expectedCount > 0 ? ` · ${selectedJob.uploadedCount}/${selectedJob.expectedCount} uploaded` : ''}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {isGenerateJobRecoverable(selectedJob) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleRecover(selectedJob.id)}
                  >
                    Recover
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleRefreshDetails(selectedJob)}
                >
                  Refresh details
                </Button>
              </div>
            </div>

            {selectedJob.status === 'failed' && (
              <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">
                {selectedJob.error || 'Generation failed'}
              </div>
            )}

            {selectedJob.status === 'partial_success' && (
              <div className="rounded-lg border border-orange-500/20 bg-orange-500/10 p-4 text-sm text-orange-100">
                {selectedJob.error || 'Partially completed. Uploaded results are kept and Gito was refunded.'}
              </div>
            )}

            {(selectedJob.status === 'queued' || selectedJob.status === 'running') && (
              <div className="rounded-lg border border-border bg-muted/20 p-6 text-sm text-muted-foreground">
                {selectedJob.status === 'queued'
                  ? 'This request is queued and waiting for the worker.'
                  : selectedJob.results.length > 0
                    ? 'This request is still running. Uploaded results so far are shown below.'
                    : 'This request is currently being processed.'}
              </div>
            )}

            {(selectedJob.originalPrompt || selectedJob.hasSourceImage || selectedJob.hasReferenceImage) && (
              <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
                <h4 className="text-sm font-semibold">Input Trace</h4>
                {(selectedJob.hasSourceImage || selectedJob.hasReferenceImage) && (
                  <div className="flex flex-wrap gap-3">
                    {selectedJob.hasSourceImage && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Source image</p>
                        <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded border border-border bg-background/60 p-2">
                          {previewUrls[buildInputPreviewKey(selectedJob.id, 'source')] ? (
                            <img
                              src={previewUrls[buildInputPreviewKey(selectedJob.id, 'source')]}
                              alt="Source"
                              className="max-h-full max-w-full object-contain"
                              style={{ imageRendering: 'pixelated' }}
                            />
                          ) : previewLoading[buildInputPreviewKey(selectedJob.id, 'source')] ? (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          ) : (
                            <div className="text-center text-[10px] text-muted-foreground">Preview unavailable</div>
                          )}
                        </div>
                      </div>
                    )}
                    {selectedJob.hasReferenceImage && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Reference image</p>
                        <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded border border-border bg-background/60 p-2">
                          {previewUrls[buildInputPreviewKey(selectedJob.id, 'reference')] ? (
                            <img
                              src={previewUrls[buildInputPreviewKey(selectedJob.id, 'reference')]}
                              alt="Reference"
                              className="max-h-full max-w-full object-contain"
                              style={{ imageRendering: 'pixelated' }}
                            />
                          ) : previewLoading[buildInputPreviewKey(selectedJob.id, 'reference')] ? (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          ) : (
                            <div className="text-center text-[10px] text-muted-foreground">Preview unavailable</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-2 text-sm">
                  {selectedJob.originalPrompt && (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Original prompt</p>
                      <p className="mt-1 whitespace-pre-wrap rounded-md bg-background/60 px-3 py-2">{selectedJob.originalPrompt}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {(selectedJob.status === 'succeeded' || selectedJob.status === 'partial_success' || selectedJob.results.length > 0) && selectedJob.results.length > 0 && (
              <div className="grid grid-cols-4 gap-3">
                {selectedJob.results.map((result) => (
                  <div
                    key={result.id}
                    className="overflow-hidden rounded-lg border border-border bg-muted/20"
                  >
                    <div className="flex aspect-square items-center justify-center bg-muted/30 p-2">
                      {previewUrls[buildResultPreviewKey(selectedJob.id, result.id)] ? (
                        <img
                          src={previewUrls[buildResultPreviewKey(selectedJob.id, result.id)]}
                          alt={result.filename}
                          className="max-h-full max-w-full object-contain"
                          style={{ imageRendering: 'pixelated' }}
                        />
                      ) : previewLoading[buildResultPreviewKey(selectedJob.id, result.id)] ? (
                        <div className="flex items-center justify-center text-xs text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">Preview unavailable</div>
                      )}
                    </div>
                    <div className="flex items-center justify-between border-t border-border p-2">
                      <span className="truncate text-xs text-muted-foreground">{result.filename}</span>
                      <Button variant="outline" size="sm" onClick={() => void handleSave(selectedJob, result)}>
                        Save
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
