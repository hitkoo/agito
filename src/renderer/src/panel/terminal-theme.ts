import type { ITerminalOptions, ITheme } from '@xterm/xterm'

type TerminalThemeVariables = Partial<Record<'--background' | '--foreground' | '--muted' | '--muted-foreground', string>>

const DEFAULT_THEME: ITheme = {
  background: '#1a1b26',
  foreground: '#c8c8c8',
  cursor: '#9ca3af',
  selectionBackground: '#3a3a5a',
}

export function buildTerminalTheme(variables: TerminalThemeVariables): ITheme {
  const hsl = (
    variable: keyof TerminalThemeVariables,
    fallback: string,
  ): string => {
    const value = variables[variable]?.trim()
    return value ? `hsl(${value})` : fallback
  }

  const hslWithAlpha = (
    variable: keyof TerminalThemeVariables,
    fallback: string,
    alpha: number,
  ): string => {
    const value = variables[variable]?.trim()
    return value ? `hsl(${value} / ${alpha})` : fallback
  }

  return {
    background: hsl('--background', DEFAULT_THEME.background!),
    foreground: hsl('--foreground', DEFAULT_THEME.foreground!),
    cursor: hsl('--muted-foreground', DEFAULT_THEME.cursor!),
    selectionBackground: hslWithAlpha('--muted', DEFAULT_THEME.selectionBackground!, 0.55),
  }
}

interface BuildTerminalOptionsInput {
  variables: TerminalThemeVariables
  fontFamily: string
  fontSize: number
}

export function buildTerminalOptions(input: BuildTerminalOptionsInput): ITerminalOptions {
  return {
    theme: buildTerminalTheme(input.variables),
    fontFamily: input.fontFamily,
    fontSize: input.fontSize,
    cursorBlink: true,
    cursorInactiveStyle: 'none',
    scrollback: 5000,
  }
}
