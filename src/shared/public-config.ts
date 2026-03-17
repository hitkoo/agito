export interface AgitoPublicConfig {
  apiUrl: string
  supabaseUrl: string
  supabasePublishableKey: string
  authResetRedirectUrl: string | null
}

export function normalizePublicConfig(
  env: Record<string, string | undefined>
): AgitoPublicConfig {
  return {
    apiUrl: env.AGITO_PUBLIC_API_URL?.trim() || 'http://localhost:8000',
    supabaseUrl: env.AGITO_PUBLIC_SUPABASE_URL?.trim() || '',
    supabasePublishableKey: env.AGITO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || '',
    authResetRedirectUrl: env.AGITO_PUBLIC_AUTH_RESET_REDIRECT_URL?.trim() || null,
  }
}

export function hasSupabasePublicConfig(config: AgitoPublicConfig): boolean {
  return Boolean(config.supabaseUrl && config.supabasePublishableKey)
}

declare const __AGITO_PUBLIC_CONFIG__: AgitoPublicConfig

export const publicConfig: AgitoPublicConfig =
  typeof __AGITO_PUBLIC_CONFIG__ === 'undefined'
    ? normalizePublicConfig({})
    : __AGITO_PUBLIC_CONFIG__
