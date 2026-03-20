import { describe, expect, test } from 'bun:test'
import { shouldRequestGeneratedPreview } from '../src/renderer/src/lib/generated-preview-retry'

describe('generated preview retry', () => {
  test('retries failed previews after cooldown', () => {
    expect(
      shouldRequestGeneratedPreview({
        url: null,
        isLoading: false,
        failedAt: null,
        now: 10_000,
        retryCooldownMs: 3_000,
      })
    ).toBe(true)

    expect(
      shouldRequestGeneratedPreview({
        url: null,
        isLoading: false,
        failedAt: 9_000,
        now: 10_000,
        retryCooldownMs: 3_000,
      })
    ).toBe(false)

    expect(
      shouldRequestGeneratedPreview({
        url: null,
        isLoading: false,
        failedAt: 6_500,
        now: 10_000,
        retryCooldownMs: 3_000,
      })
    ).toBe(true)
  })
})
