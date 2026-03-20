import { DEFAULT_SETTINGS, TERMINAL_FONT_FAMILY_OPTIONS, TERMINAL_FONT_SIZE_OPTIONS } from './constants'
import type { AgitoSettings } from './types'

export { TERMINAL_FONT_FAMILY_OPTIONS, TERMINAL_FONT_SIZE_OPTIONS }

export type TerminalFontFamilyOption = (typeof TERMINAL_FONT_FAMILY_OPTIONS)[number]
export type TerminalFontFamilySource = 'bundled' | 'system' | 'fallback'

const TERMINAL_FONT_FAMILY_SOURCE: Record<TerminalFontFamilyOption, TerminalFontFamilySource> = {
  'SF Mono': 'system',
  Hack: 'bundled',
  'JetBrains Mono': 'bundled',
  Iosevka: 'bundled',
  'Monaspace Neon': 'bundled',
  'Maple Mono': 'bundled',
  monospace: 'fallback',
}

export function clampTerminalFontSize(size: number): number {
  const min = TERMINAL_FONT_SIZE_OPTIONS[0]
  const max = TERMINAL_FONT_SIZE_OPTIONS[TERMINAL_FONT_SIZE_OPTIONS.length - 1]
  return Math.max(min, Math.min(max, Math.round(size)))
}

export function normalizeTerminalFontFamilies(families: string[] | null | undefined): string[] {
  const requested = Array.isArray(families) ? families : []
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const family of requested) {
    if (!TERMINAL_FONT_FAMILY_OPTIONS.includes(family as (typeof TERMINAL_FONT_FAMILY_OPTIONS)[number])) {
      continue
    }
    if (seen.has(family)) continue
    seen.add(family)
    normalized.push(family)
  }

  for (const family of TERMINAL_FONT_FAMILY_OPTIONS) {
    if (!seen.has(family)) {
      normalized.push(family)
    }
  }

  return normalized
}

export function buildTerminalFontFamily(families: string[]): string {
  return families.join(', ')
}

export function getTerminalFontFamilySource(
  family: string
): TerminalFontFamilySource | null {
  if (!(family in TERMINAL_FONT_FAMILY_SOURCE)) return null
  return TERMINAL_FONT_FAMILY_SOURCE[family as TerminalFontFamilyOption]
}

export function isBundledTerminalFontFamily(family: string): boolean {
  return getTerminalFontFamilySource(family) === 'bundled'
}

export function moveTerminalFontFamily(
  families: string[],
  family: string,
  nextIndex: number
): string[] {
  const currentIndex = families.indexOf(family)
  if (currentIndex === -1) return families

  const clampedIndex = Math.max(0, Math.min(families.length - 1, nextIndex))
  if (currentIndex === clampedIndex) return families

  const next = [...families]
  next.splice(currentIndex, 1)
  next.splice(clampedIndex, 0, family)
  return next
}

export function resolveAgitoSettings(settings: Partial<AgitoSettings> | null | undefined): AgitoSettings {
  return {
    defaultSpriteSize:
      typeof settings?.defaultSpriteSize === 'number'
        ? settings.defaultSpriteSize
        : DEFAULT_SETTINGS.defaultSpriteSize,
    skipPermissionPrompts:
      typeof settings?.skipPermissionPrompts === 'boolean'
        ? settings.skipPermissionPrompts
        : DEFAULT_SETTINGS.skipPermissionPrompts,
    terminalFontFamilies: normalizeTerminalFontFamilies(settings?.terminalFontFamilies),
    terminalFontSize: clampTerminalFontSize(
      typeof settings?.terminalFontSize === 'number'
        ? settings.terminalFontSize
        : DEFAULT_SETTINGS.terminalFontSize
    ),
  }
}
