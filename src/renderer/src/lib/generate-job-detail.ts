import type { GenerateJob } from '../../../shared/types'

export function shouldHydrateSelectedGenerateJobDetail(job: GenerateJob | null): boolean {
  if (!job) return false
  if (job.status === 'queued' || job.status === 'running') return true
  if (job.results.length > 0) return false
  return job.uploadedCount > 0 || job.hasSourceImage === true || job.hasReferenceImage === true
}
