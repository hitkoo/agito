import { describe, expect, test } from 'bun:test'
import {
  clampTerminalDockBarHeight,
  getFittedMinimizedDockWidth,
  getResizedTerminalDockBarHeight,
  resolveTerminalDockBarHeight,
} from '../src/shared/terminal-dock-bar'
import {
  FLOAT_TERMINAL_DOCK_GAP,
  getAnchoredDockBounds,
  getFloatBarCharacterCount,
  getFloatBarBoundsFromTerminalBounds,
  getFloatTerminalBoundsFromBarBounds,
} from '../src/shared/terminal-dock-bar'

describe('resolveTerminalDockBarHeight', () => {
  test('falls back to the default height when no saved value exists', () => {
    expect(resolveTerminalDockBarHeight(null)).toBe(40)
    expect(resolveTerminalDockBarHeight(undefined)).toBe(40)
    expect(resolveTerminalDockBarHeight('')).toBe(40)
    expect(resolveTerminalDockBarHeight('NaN')).toBe(40)
  })

  test('clamps saved values into the supported range', () => {
    expect(resolveTerminalDockBarHeight('24')).toBe(40)
    expect(resolveTerminalDockBarHeight('72')).toBe(72)
    expect(resolveTerminalDockBarHeight('200')).toBe(128)
  })
})

describe('clampTerminalDockBarHeight', () => {
  test('keeps the float dock between 40px and 128px tall', () => {
    expect(clampTerminalDockBarHeight(24)).toBe(40)
    expect(clampTerminalDockBarHeight(80)).toBe(80)
    expect(clampTerminalDockBarHeight(999)).toBe(128)
  })
})

describe('getResizedTerminalDockBarHeight', () => {
  test('grows upward and shrinks downward within the clamp range', () => {
    expect(getResizedTerminalDockBarHeight(40, -24)).toBe(64)
    expect(getResizedTerminalDockBarHeight(40, 4)).toBe(40)
    expect(getResizedTerminalDockBarHeight(40, 20)).toBe(40)
  })
})

describe('getFittedMinimizedDockWidth', () => {
  test('fits the float dock width to the centered home|characters|grab cluster', () => {
    expect(
      getFittedMinimizedDockWidth({
        characterCount: 3,
        height: 40,
        maxWidth: 999,
      }),
    ).toBe(192)
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

describe('getFloatBarCharacterCount', () => {
  test('always uses the total character count when at least one pane is open', () => {
    expect(
      getFloatBarCharacterCount({
        openCharacterCount: 3,
        totalCharacterCount: 5,
      }),
    ).toBe(5)
  })

  test('falls back to the total character count when nothing is open', () => {
    expect(
      getFloatBarCharacterCount({
        openCharacterCount: 0,
        totalCharacterCount: 5,
      }),
    ).toBe(5)
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

describe('float pair bounds helpers', () => {
  test('positions the float bar below the large terminal with a fixed gap', () => {
    expect(
      getFloatBarBoundsFromTerminalBounds({
        terminalBounds: { x: 100, y: 200, width: 400, height: 300 },
        barHeight: 40,
        characterCount: 3,
        workArea: { x: 0, y: 0, width: 1440, height: 900 },
      }),
    ).toEqual({
      x: 204,
      y: 512,
      width: 192,
      height: 40,
    })
  })

  test('reconstructs the large terminal above the bar with the shared gap', () => {
    expect(
      getFloatTerminalBoundsFromBarBounds({
        barBounds: { x: 204, y: 512, width: 192, height: 40 },
        terminalWidth: 400,
        terminalHeight: 300,
        workArea: { x: 0, y: 0, width: 1440, height: 900 },
      }),
    ).toEqual({
      x: 100,
      y: 200,
      width: 400,
      height: 300,
    })
  })

  test('documents the fixed float pair gap', () => {
    expect(FLOAT_TERMINAL_DOCK_GAP).toBe(12)
  })
})
