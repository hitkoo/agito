export type PersistedThemeMode = 'system' | 'light' | 'dark'

export function resolveInitialThemeClass(
  savedTheme: string | null | undefined,
  prefersDark: boolean
): 'light' | 'dark' {
  if (savedTheme === 'light') return 'light'
  if (savedTheme === 'dark') return 'dark'
  if (savedTheme === 'system') {
    return prefersDark ? 'dark' : 'light'
  }
  return 'dark'
}

export function applyInitialThemeClass(win: Window): void {
  const theme = resolveInitialThemeClass(
    win.localStorage.getItem('agito-theme'),
    win.matchMedia('(prefers-color-scheme: dark)').matches
  )

  if (theme === 'dark') {
    win.document.documentElement.classList.add('dark')
  } else {
    win.document.documentElement.classList.remove('dark')
  }
}
