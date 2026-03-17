import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { normalizePublicConfig } from './src/shared/public-config'

export default defineConfig(({ mode }) => {
  const worktreeRoot = process.cwd()
  const repoRoot = resolve(worktreeRoot, '../..')
  const repoEnv = loadEnv(mode, repoRoot, 'AGITO_PUBLIC_')
  const worktreeEnv = loadEnv(mode, worktreeRoot, 'AGITO_PUBLIC_')
  const publicConfig = normalizePublicConfig({
    ...repoEnv,
    ...worktreeEnv,
    AGITO_PUBLIC_API_URL: process.env.AGITO_PUBLIC_API_URL ?? worktreeEnv.AGITO_PUBLIC_API_URL ?? repoEnv.AGITO_PUBLIC_API_URL,
    AGITO_PUBLIC_SUPABASE_URL: process.env.AGITO_PUBLIC_SUPABASE_URL ?? worktreeEnv.AGITO_PUBLIC_SUPABASE_URL ?? repoEnv.AGITO_PUBLIC_SUPABASE_URL,
    AGITO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.AGITO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      worktreeEnv.AGITO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      repoEnv.AGITO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    AGITO_PUBLIC_AUTH_RESET_REDIRECT_URL:
      process.env.AGITO_PUBLIC_AUTH_RESET_REDIRECT_URL ??
      worktreeEnv.AGITO_PUBLIC_AUTH_RESET_REDIRECT_URL ??
      repoEnv.AGITO_PUBLIC_AUTH_RESET_REDIRECT_URL,
  })
  const definePublicConfig = {
    __AGITO_PUBLIC_CONFIG__: JSON.stringify(publicConfig),
  }

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      resolve: {
        alias: {
          '@shared': resolve('src/shared')
        }
      },
      define: definePublicConfig,
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      resolve: {
        alias: {
          '@shared': resolve('src/shared')
        }
      },
      define: definePublicConfig,
    },
    renderer: {
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src'),
          '@shared': resolve('src/shared')
        }
      },
      plugins: [react()],
      define: definePublicConfig,
    }
  }
})
