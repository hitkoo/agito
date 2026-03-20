import type { GenerateJob } from '../../../shared/types'

export function isGenerateJobRecoverable(job: GenerateJob, now: Date = new Date()): boolean {
  if (job.status !== 'running') return false
  if (!job.leaseExpiresAt) return false
  const leaseExpiry = new Date(job.leaseExpiresAt)
  if (Number.isNaN(leaseExpiry.getTime())) return false
  return leaseExpiry.getTime() < now.getTime()
}
