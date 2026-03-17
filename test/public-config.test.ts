import { describe, expect, test } from 'bun:test'
import { hasSupabasePublicConfig, normalizePublicConfig } from '../src/shared/public-config'

describe('normalizePublicConfig', () => {
  test('uses localhost API default and empty auth config when env is missing', () => {
    const config = normalizePublicConfig({})

    expect(config).toEqual({
      apiUrl: 'http://localhost:8000',
      supabaseUrl: '',
      supabasePublishableKey: '',
      authResetRedirectUrl: null,
    })
    expect(hasSupabasePublicConfig(config)).toBe(false)
  })

  test('normalizes build-time public auth config values', () => {
    const config = normalizePublicConfig({
      AGITO_PUBLIC_API_URL: 'https://api.agito.app',
      AGITO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      AGITO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_123',
      AGITO_PUBLIC_AUTH_RESET_REDIRECT_URL: 'agito://auth/reset',
    })

    expect(config).toEqual({
      apiUrl: 'https://api.agito.app',
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: 'sb_publishable_123',
      authResetRedirectUrl: 'agito://auth/reset',
    })
    expect(hasSupabasePublicConfig(config)).toBe(true)
  })
})
