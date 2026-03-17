export interface OverlayScrollbarMetricsInput {
  clientWidth: number
  scrollWidth: number
  scrollLeft: number
  minThumbWidth?: number
}

export interface OverlayScrollbarMetrics {
  visible: boolean
  thumbWidth: number
  thumbOffset: number
}

export interface OverlayThumbDragInput {
  clientWidth: number
  scrollWidth: number
  thumbWidth: number
  startScrollLeft: number
  deltaX: number
}

export function getOverlayScrollbarMetrics({
  clientWidth,
  scrollWidth,
  scrollLeft,
  minThumbWidth = 18,
}: OverlayScrollbarMetricsInput): OverlayScrollbarMetrics {
  if (clientWidth <= 0 || scrollWidth <= clientWidth) {
    return {
      visible: false,
      thumbWidth: 0,
      thumbOffset: 0,
    }
  }

  const maxScrollLeft = scrollWidth - clientWidth
  const rawThumbWidth = (clientWidth / scrollWidth) * clientWidth
  const thumbWidth = Math.min(clientWidth, Math.max(minThumbWidth, Math.round(rawThumbWidth)))
  const maxThumbOffset = Math.max(0, clientWidth - thumbWidth)
  const thumbOffset =
    maxScrollLeft <= 0 ? 0 : Math.round((scrollLeft / maxScrollLeft) * maxThumbOffset)

  return {
    visible: true,
    thumbWidth,
    thumbOffset,
  }
}

export function getScrollLeftForThumbDrag({
  clientWidth,
  scrollWidth,
  thumbWidth,
  startScrollLeft,
  deltaX,
}: OverlayThumbDragInput): number {
  const maxScrollLeft = Math.max(0, scrollWidth - clientWidth)
  const maxThumbOffset = Math.max(0, clientWidth - thumbWidth)
  if (maxScrollLeft <= 0 || maxThumbOffset <= 0) return 0

  const scrollPerPixel = maxScrollLeft / maxThumbOffset
  const nextScrollLeft = startScrollLeft + deltaX * scrollPerPixel

  return Math.max(0, Math.min(maxScrollLeft, Math.round(nextScrollLeft)))
}
