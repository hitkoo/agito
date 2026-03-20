export interface GeneratedJobPreviewUrlsRequest {
  cacheKey: string
  path: string
}

export function buildGeneratedJobPreviewUrlsRequest(args: { jobId: string }): GeneratedJobPreviewUrlsRequest {
  return {
    cacheKey: `job-preview-urls:${args.jobId}`,
    path: `/api/generate/jobs/${args.jobId}/preview-urls`,
  }
}
