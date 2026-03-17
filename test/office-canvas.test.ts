import { describe, expect, test } from 'bun:test'

const officeCanvasPath =
  '/Users/seungjin/Desktop/seungjin/agito/agito-app/src/renderer/src/world/OfficeCanvas.tsx'

describe('OfficeCanvas DoneEffect', async () => {
  const source = await Bun.file(officeCanvasPath).text()

  test('does not visually fade done state to idle on a local timer', () => {
    expect(source).toContain('function DoneEffect')
    expect(source).not.toContain('setTimeout(() => setShowCheck(false), 3000)')
    expect(source).not.toContain('const c = showCheck ? color : STATUS_COLORS.idle')
  })
})
