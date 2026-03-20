import { describe, expect, test } from 'bun:test'
import { IPC_COMMANDS, IPC_EVENTS } from '../src/shared/ipc-channels'
import { getGenerateCategoryForItemPaletteTab } from '../src/renderer/src/lib/generate-entrypoint'

describe('generate entrypoint', () => {
  test('does not expose the legacy direct-generate IPC command', () => {
    expect('ASSET_GENERATE' in IPC_COMMANDS).toBe(false)
  })

  test('does not expose the legacy generate progress event', () => {
    expect('ASSET_GENERATE_PROGRESS' in IPC_EVENTS).toBe(false)
  })

  test('maps item palette tabs to generate categories', () => {
    expect(getGenerateCategoryForItemPaletteTab('background')).toBe('background')
    expect(getGenerateCategoryForItemPaletteTab('furniture')).toBe('furniture')
    expect(getGenerateCategoryForItemPaletteTab('skin')).toBe('skin')
  })
})
