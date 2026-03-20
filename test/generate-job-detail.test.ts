import { describe, expect, test } from 'bun:test'
import { shouldHydrateSelectedGenerateJobDetail } from '../src/renderer/src/lib/generate-job-detail'
import type { GenerateJob } from '../src/shared/types'

function makeJob(overrides: Partial<GenerateJob>): GenerateJob {
  return {
    id: 'job-1',
    category: 'skin',
    prompt: 'test',
    status: 'succeeded',
    reservedCredits: 50,
    chargedCredits: 50,
    uploadedCount: 16,
    expectedCount: 16,
    error: null,
    storagePrefix: null,
    originalPrompt: 'test',
    hasSourceImage: false,
    hasReferenceImage: false,
    createdAt: '2026-03-20T00:00:00.000Z',
    startedAt: '2026-03-20T00:00:01.000Z',
    completedAt: '2026-03-20T00:00:02.000Z',
    leaseExpiresAt: null,
    results: [],
    ...overrides,
  }
}

describe('shouldHydrateSelectedGenerateJobDetail', () => {
  test('hydrates queued and running jobs', () => {
    expect(shouldHydrateSelectedGenerateJobDetail(makeJob({ status: 'queued', uploadedCount: 0 }))).toBe(true)
    expect(shouldHydrateSelectedGenerateJobDetail(makeJob({ status: 'running', uploadedCount: 0 }))).toBe(true)
  })

  test('hydrates completed jobs when summary payload has uploads but no results yet', () => {
    expect(
      shouldHydrateSelectedGenerateJobDetail(
        makeJob({
          status: 'succeeded',
          uploadedCount: 16,
          results: [],
        })
      )
    ).toBe(true)
  })

  test('does not hydrate completed jobs that already have detailed results', () => {
    expect(
      shouldHydrateSelectedGenerateJobDetail(
        makeJob({
          status: 'succeeded',
          results: [{ id: 1, filename: 'a.png', storagePath: 'jobs/x/results/01-a.png', sortIndex: 1, mimeType: 'image/png' }],
        })
      )
    ).toBe(false)
  })
})
