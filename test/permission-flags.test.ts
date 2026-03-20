import { describe, expect, test } from 'bun:test'
import { getEnginePermissionSkipArgs } from '../src/main/engine/permission-flags'

describe('getEnginePermissionSkipArgs', () => {
  test('returns no extra args when the setting is disabled', () => {
    expect(getEnginePermissionSkipArgs('claude-code', false)).toEqual([])
    expect(getEnginePermissionSkipArgs('codex', false)).toEqual([])
  })

  test('maps the global toggle to engine-specific unsafe flags', () => {
    expect(getEnginePermissionSkipArgs('claude-code', true)).toEqual([
      '--dangerously-skip-permissions',
    ])
    expect(getEnginePermissionSkipArgs('codex', true)).toEqual(['--yolo'])
  })
})
