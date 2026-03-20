import { describe, expect, test } from 'bun:test'
import { resolveInitialThemeClass } from '../src/renderer/src/lib/theme-boot'

describe('resolveInitialThemeClass', () => {
  test('defaults to dark when no persisted theme exists', () => {
    expect(resolveInitialThemeClass(null, false)).toBe('dark')
    expect(resolveInitialThemeClass(undefined, true)).toBe('dark')
  })

  test('honors explicit light and dark theme preferences', () => {
    expect(resolveInitialThemeClass('light', true)).toBe('light')
    expect(resolveInitialThemeClass('dark', false)).toBe('dark')
  })

  test('resolves system theme using the current OS preference', () => {
    expect(resolveInitialThemeClass('system', true)).toBe('dark')
    expect(resolveInitialThemeClass('system', false)).toBe('light')
  })
})
