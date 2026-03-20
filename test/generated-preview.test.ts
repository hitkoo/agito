import { describe, expect, test } from 'bun:test'
import {
  buildGeneratedJobPreviewUrlsRequest,
} from '../src/main/generated-preview'

describe('generated preview requests', () => {
  test('builds authenticated batch preview url requests', () => {
    expect(buildGeneratedJobPreviewUrlsRequest({ jobId: 'job-1' })).toEqual({
      cacheKey: 'job-preview-urls:job-1',
      path: '/api/generate/jobs/job-1/preview-urls',
    })
  })
})
