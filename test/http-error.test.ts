import { describe, expect, test } from 'bun:test'
import { normalizeApiError } from '../src/main/http-error'

describe('normalizeApiError', () => {
  test('preserves structured insufficient-credit details', async () => {
    const response = new Response(
      JSON.stringify({
        detail: {
          code: 'insufficient_credits',
          required_credits: 50,
          remaining_credits: 0,
        },
      }),
      {
        status: 402,
        headers: { 'content-type': 'application/json' },
      }
    )

    await expect(normalizeApiError(response)).resolves.toMatchObject({
      status: 402,
      code: 'insufficient_credits',
      message: 'Need 50 Gito. Current balance is 0 Gito.',
      detail: {
        code: 'insufficient_credits',
        required_credits: 50,
        remaining_credits: 0,
      },
    })
  })

  test('keeps plain string detail readable', async () => {
    const response = new Response(
      JSON.stringify({ detail: 'Polar checkout creation failed' }),
      {
        status: 502,
        headers: { 'content-type': 'application/json' },
      }
    )

    await expect(normalizeApiError(response)).resolves.toMatchObject({
      status: 502,
      message: 'Polar checkout creation failed',
      detail: 'Polar checkout creation failed',
    })
  })

  test('maps invalid auth responses to a re-sign-in message', async () => {
    const response = new Response(
      JSON.stringify({ detail: 'Invalid auth token' }),
      {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }
    )

    await expect(normalizeApiError(response)).resolves.toMatchObject({
      status: 401,
      message: 'Invalid auth token',
      detail: 'Invalid auth token',
    })
  })
})
