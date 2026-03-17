import { describe, expect, test } from 'bun:test'
import {
  getOverlayScrollbarMetrics,
  getScrollLeftForThumbDrag,
} from '../src/renderer/src/panel/terminal-dock-scroll'

describe('getOverlayScrollbarMetrics', () => {
  test('hides the overlay scrollbar when content fits', () => {
    expect(
      getOverlayScrollbarMetrics({
        clientWidth: 240,
        scrollWidth: 240,
        scrollLeft: 0,
      })
    ).toEqual({
      visible: false,
      thumbWidth: 0,
      thumbOffset: 0,
    })
  })

  test('returns proportional thumb metrics when content overflows', () => {
    expect(
      getOverlayScrollbarMetrics({
        clientWidth: 240,
        scrollWidth: 480,
        scrollLeft: 120,
      })
    ).toEqual({
      visible: true,
      thumbWidth: 120,
      thumbOffset: 60,
    })
  })

  test('clamps the thumb to a minimum size', () => {
    expect(
      getOverlayScrollbarMetrics({
        clientWidth: 120,
        scrollWidth: 2400,
        scrollLeft: 1140,
      })
    ).toEqual({
      visible: true,
      thumbWidth: 18,
      thumbOffset: 51,
    })
  })
})

describe('getScrollLeftForThumbDrag', () => {
  test('maps thumb drag distance back to scrollLeft', () => {
    expect(
      getScrollLeftForThumbDrag({
        clientWidth: 240,
        scrollWidth: 480,
        thumbWidth: 120,
        startScrollLeft: 60,
        deltaX: 30,
      })
    ).toBe(120)
  })

  test('clamps thumb drag within the scrollable range', () => {
    expect(
      getScrollLeftForThumbDrag({
        clientWidth: 120,
        scrollWidth: 2400,
        thumbWidth: 18,
        startScrollLeft: 1140,
        deltaX: 1000,
      })
    ).toBe(2280)
  })
})
