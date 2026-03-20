import { describe, expect, test } from 'bun:test'
import { buildGeneratedResultDownloadRequest } from '../src/main/generated-result-save'

describe('buildGeneratedResultDownloadRequest', () => {
  test('builds an authenticated server download path instead of relying on signed URLs', () => {
    expect(
      buildGeneratedResultDownloadRequest({
        category: 'skin',
        jobId: 'job-1',
        resultId: 7,
      })
    ).toEqual({
      filename: null,
      path: '/api/generate/jobs/job-1/results/7/download',
    })
  })
})
