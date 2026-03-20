import { describe, expect, test } from 'bun:test'
import { isGenerateJobRecoverable } from '../src/renderer/src/lib/generate-job-recovery'
import type { GenerateJob } from '../src/shared/types'

function makeJob(overrides: Partial<GenerateJob>): GenerateJob {
  return {
    id: 'job-1',
    category: 'skin',
    prompt: 'test',
    status: 'running',
    reservedCredits: 50,
    chargedCredits: 0,
    uploadedCount: 0,
    expectedCount: 16,
    createdAt: '2026-03-20T00:00:00.000Z',
    startedAt: '2026-03-20T00:00:00.000Z',
    completedAt: null,
    leaseExpiresAt: null,
    results: [],
    ...overrides,
  }
}

describe('isGenerateJobRecoverable', () => {
  test('returns true only for running jobs whose lease has expired', () => {
    expect(
      isGenerateJobRecoverable(
        makeJob({ status: 'running', leaseExpiresAt: '2026-03-20T00:00:00.000Z' }),
        new Date('2026-03-20T00:00:01.000Z')
      )
    ).toBe(true)

    expect(
      isGenerateJobRecoverable(
        makeJob({ status: 'running', leaseExpiresAt: '2026-03-20T00:10:00.000Z' }),
        new Date('2026-03-20T00:00:01.000Z')
      )
    ).toBe(false)

    expect(
      isGenerateJobRecoverable(
        makeJob({ status: 'succeeded', leaseExpiresAt: '2026-03-20T00:00:00.000Z' }),
        new Date('2026-03-20T00:00:01.000Z')
      )
    ).toBe(false)
  })
})
