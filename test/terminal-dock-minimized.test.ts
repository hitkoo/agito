import { describe, expect, test } from 'bun:test'
import {
  clampMinimizedDockHeight,
  getFittedMinimizedDockWidth,
  getResizedMinimizedDockHeight,
  resolveMinimizedDockHeight,
} from '../src/shared/terminal-dock-minimized'
import { getAnchoredDockBounds } from '../src/shared/terminal-dock-bar'

describe('resolveMinimizedDockHeight', () => {
  test('falls back to the default height when no saved value exists', () => {
    expect(resolveMinimizedDockHeight(null)).toBe(40)
    expect(resolveMinimizedDockHeight(undefined)).toBe(40)
    expect(resolveMinimizedDockHeight('')).toBe(40)
    expect(resolveMinimizedDockHeight('NaN')).toBe(40)
  })

  test('clamps saved values into the supported range', () => {
    expect(resolveMinimizedDockHeight('24')).toBe(40)
    expect(resolveMinimizedDockHeight('72')).toBe(72)
    expect(resolveMinimizedDockHeight('200')).toBe(128)
  })
})

describe('clampMinimizedDockHeight', () => {
  test('keeps the float dock between 40px and 128px tall', () => {
    expect(clampMinimizedDockHeight(24)).toBe(40)
    expect(clampMinimizedDockHeight(80)).toBe(80)
    expect(clampMinimizedDockHeight(999)).toBe(128)
  })
})

describe('getResizedMinimizedDockHeight', () => {
  test('grows upward and shrinks downward within the clamp range', () => {
    expect(getResizedMinimizedDockHeight(40, -24)).toBe(64)
    expect(getResizedMinimizedDockHeight(40, 4)).toBe(40)
    expect(getResizedMinimizedDockHeight(40, 20)).toBe(40)
  })
})

describe('getFittedMinimizedDockWidth', () => {
  test('fits the float dock width to character count and current height', () => {
    expect(
      getFittedMinimizedDockWidth({
        characterCount: 3,
        height: 40,
        maxWidth: 999,
      }),
    ).toBe(156)
  })

  test('clamps the fitted width to the available screen width', () => {
    expect(
      getFittedMinimizedDockWidth({
        characterCount: 20,
        height: 40,
        maxWidth: 320,
      }),
    ).toBe(320)
  })
})

describe('getAnchoredDockBounds', () => {
  test('preserves horizontal center and bottom edge when minimizing', () => {
    expect(
      getAnchoredDockBounds({
        anchorBounds: { x: 100, y: 200, width: 400, height: 300 },
        nextWidth: 156,
        nextHeight: 40,
        workArea: { x: 0, y: 0, width: 1440, height: 900 },
      }),
    ).toEqual({
      x: 222,
      y: 460,
      width: 156,
      height: 40,
    })
  })

  test('preserves horizontal center and bottom edge when restoring', () => {
    expect(
      getAnchoredDockBounds({
        anchorBounds: { x: 222, y: 460, width: 156, height: 40 },
        nextWidth: 400,
        nextHeight: 300,
        workArea: { x: 0, y: 0, width: 1440, height: 900 },
      }),
    ).toEqual({
      x: 100,
      y: 200,
      width: 400,
      height: 300,
    })
  })

  test('clamps anchored bounds into the available work area', () => {
    expect(
      getAnchoredDockBounds({
        anchorBounds: { x: 20, y: 50, width: 100, height: 40 },
        nextWidth: 400,
        nextHeight: 300,
        workArea: { x: 0, y: 0, width: 800, height: 600 },
      }),
    ).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    })
  })
})
