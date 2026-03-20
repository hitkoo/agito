import type { AssetCategory, GenerateJob, GenerateJobResultItem } from '../shared/types'

export interface GeneratedJobApiPayload {
  id: string
  category: AssetCategory
  prompt: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'partial_success'
  reserved_credits: number
  charged_credits: number
  uploaded_count?: number
  expected_count?: number
  error?: string | null
  storage_prefix?: string | null
  original_prompt?: string | null
  has_source_image?: boolean
  has_reference_image?: boolean
  created_at: string
  started_at?: string | null
  completed_at?: string | null
  lease_expires_at?: string | null
  results?: Array<{
    id: number
    filename: string
    storage_path: string
    sort_index: number
    mime_type: string
  }>
}

export function mapGeneratedJob(job: GeneratedJobApiPayload): GenerateJob {
  const results = job.results ?? []
  return {
    id: job.id,
    category: job.category,
    prompt: job.prompt,
    status: job.status,
    reservedCredits: job.reserved_credits,
    chargedCredits: job.charged_credits,
    uploadedCount: job.uploaded_count ?? results.length,
    expectedCount: job.expected_count ?? results.length,
    error: job.error ?? null,
    storagePrefix: job.storage_prefix ?? null,
    originalPrompt: job.original_prompt ?? null,
    hasSourceImage: job.has_source_image ?? false,
    hasReferenceImage: job.has_reference_image ?? false,
    createdAt: job.created_at,
    startedAt: job.started_at ?? null,
    completedAt: job.completed_at ?? null,
    leaseExpiresAt: job.lease_expires_at ?? null,
    results: results.map((result): GenerateJobResultItem => ({
      id: result.id,
      filename: result.filename,
      storagePath: result.storage_path,
      sortIndex: result.sort_index,
      mimeType: result.mime_type,
    })),
  }
}
