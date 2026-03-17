import { describe, expect, test } from 'bun:test'
import {
  canAccessGenerate,
  deriveAuthStatus,
  getAccountDisplayName,
} from '../src/shared/auth'

describe('deriveAuthStatus', () => {
  test('returns signed_out when there is no authenticated session', () => {
    expect(
      deriveAuthStatus({
        hasIdentity: false,
        hasSession: false,
        emailVerified: false,
      })
    ).toBe('signed_out')
  })

  test('returns signed_out when the session exists but email is unverified', () => {
    expect(
      deriveAuthStatus({
        hasIdentity: true,
        hasSession: true,
        emailVerified: false,
      })
    ).toBe('signed_out')
  })

  test('returns signed_out when identity exists without a verified session', () => {
    expect(
      deriveAuthStatus({
        hasIdentity: true,
        hasSession: false,
        emailVerified: false,
      })
    ).toBe('signed_out')
  })

  test('returns signed_in when session exists and email is verified', () => {
    expect(
      deriveAuthStatus({
        hasIdentity: true,
        hasSession: true,
        emailVerified: true,
      })
    ).toBe('signed_in')
  })
})

describe('canAccessGenerate', () => {
  test('allows generate only for fully signed-in accounts', () => {
    expect(canAccessGenerate('signed_out')).toBe(false)
    expect(canAccessGenerate('signed_in')).toBe(true)
  })
})

describe('getAccountDisplayName', () => {
  test('prefers the explicit display name when present', () => {
    expect(
      getAccountDisplayName({
        displayName: 'Hitkoo',
        email: 'hitkoo@example.com',
      })
    ).toBe('Hitkoo')
  })

  test('falls back to the email prefix when the display name is missing', () => {
    expect(
      getAccountDisplayName({
        displayName: null,
        email: 'hitkoo@example.com',
      })
    ).toBe('hitkoo')
  })
})
