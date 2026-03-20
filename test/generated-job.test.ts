import { describe, expect, test } from 'bun:test'
import { mapGeneratedJob } from '../src/main/generated-job'

describe('generated job mapping', () => {
  test('maps summary payloads without results into empty result lists', () => {
    const job = mapGeneratedJob({
      id: 'job-1',
      category: 'skin',
      prompt: 'hero',
      status: 'queued',
      reserved_credits: 50,
      charged_credits: 0,
      uploaded_count: 0,
      expected_count: 16,
      error: null,
      storage_prefix: null,
      original_prompt: 'hero',
      has_source_image: false,
      has_reference_image: false,
      created_at: '2026-03-20T00:00:00Z',
      started_at: null,
      completed_at: null,
      lease_expires_at: null,
    })

    expect(job.results).toEqual([])
    expect(job.uploadedCount).toBe(0)
    expect(job.expectedCount).toBe(16)
  })
})
