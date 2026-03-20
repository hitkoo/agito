import type { AssetCategory } from '../shared/types'

export interface GeneratedResultDownloadArgs {
  category: AssetCategory
  jobId: string
  resultId: number
}

export interface GeneratedResultDownloadRequest {
  filename: string | null
  path: string
}

export function buildGeneratedResultDownloadRequest(
  args: GeneratedResultDownloadArgs
): GeneratedResultDownloadRequest {
  return {
    filename: null,
    path: `/api/generate/jobs/${args.jobId}/results/${args.resultId}/download`,
  }
}
