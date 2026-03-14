import { useEffect } from 'react'
import { useUIStore } from '../stores/ui-store'

export function useTheme(): void {
  const theme = useUIStore((s) => s.theme)

  useEffect(() => {
    const root = document.documentElement

    function applyTheme(mode: 'light' | 'dark'): void {
      if (mode === 'dark') {
        root.classList.add('dark')
      } else {
        root.classList.remove('dark')
      }
    }

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      applyTheme(mq.matches ? 'dark' : 'light')
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches ? 'dark' : 'light')
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    } else {
      applyTheme(theme)
    }
  }, [theme])

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem('agito-theme', theme)
  }, [theme])
}

// Call on app init to restore persisted theme
export function getPersistedTheme(): 'system' | 'light' | 'dark' {
  const saved = localStorage.getItem('agito-theme')
  if (saved === 'system' || saved === 'light' || saved === 'dark') return saved
  return 'dark'
}
