import { describe, expect, test } from 'bun:test'
import {
  resolveAgitoSettings,
  buildTerminalFontFamily,
  clampTerminalFontSize,
  getTerminalFontFamilySource,
  isBundledTerminalFontFamily,
  moveTerminalFontFamily,
  TERMINAL_FONT_FAMILY_OPTIONS,
  TERMINAL_FONT_SIZE_OPTIONS,
} from '../src/shared/settings'

describe('resolveAgitoSettings', () => {
  test('fills in missing terminal font settings for legacy settings payloads', () => {
    expect(
      resolveAgitoSettings({
        defaultSpriteSize: 96,
      }),
    ).toEqual({
      defaultSpriteSize: 96,
      skipPermissionPrompts: false,
      terminalFontFamilies: [...TERMINAL_FONT_FAMILY_OPTIONS],
      terminalFontSize: 13,
    })
  })

  test('normalizes duplicate and unknown terminal font families', () => {
    expect(
      resolveAgitoSettings({
        defaultSpriteSize: 64,
        skipPermissionPrompts: true,
        terminalFontFamilies: ['JetBrains Mono', 'Commit Mono', 'JetBrains Mono', 'unknown', 'SF Mono'],
        terminalFontSize: 12,
      }),
    ).toMatchObject({
      skipPermissionPrompts: true,
      terminalFontFamilies: [
      'JetBrains Mono',
      'SF Mono',
      'Hack',
      'Iosevka',
      'Monaspace Neon',
      'Maple Mono',
      'monospace',
      ],
    })
  })
})

describe('terminal font settings helpers', () => {
  test('clamps font size into the supported dropdown range', () => {
    expect(clampTerminalFontSize(8)).toBe(10)
    expect(clampTerminalFontSize(13)).toBe(13)
    expect(clampTerminalFontSize(20)).toBe(16)
  })

  test('exposes font size options from 10 to 16', () => {
    expect(TERMINAL_FONT_SIZE_OPTIONS).toEqual([10, 11, 12, 13, 14, 15, 16])
  })

  test('builds a CSS font family stack from the normalized order', () => {
    expect(buildTerminalFontFamily(['SF Mono', 'JetBrains Mono', 'monospace'])).toBe(
      'SF Mono, JetBrains Mono, monospace',
    )
  })

  test('moves a font family to a new index while preserving the remaining order', () => {
    expect(
      moveTerminalFontFamily(
        ['SF Mono', 'Hack', 'JetBrains Mono', 'monospace'],
        'Hack',
        1,
      ),
    ).toEqual(['SF Mono', 'Hack', 'JetBrains Mono', 'monospace'])
  })

  test('classifies bundled, system, and fallback terminal fonts', () => {
    expect(getTerminalFontFamilySource('SF Mono')).toBe('system')
    expect(getTerminalFontFamilySource('Hack')).toBe('bundled')
    expect(getTerminalFontFamilySource('monospace')).toBe('fallback')
    expect(getTerminalFontFamilySource('unknown')).toBeNull()
    expect(isBundledTerminalFontFamily('Hack')).toBe(true)
    expect(isBundledTerminalFontFamily('SF Mono')).toBe(false)
  })
})
