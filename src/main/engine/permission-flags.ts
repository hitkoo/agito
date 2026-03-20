import type { EngineType } from '../../shared/types'

export function getEnginePermissionSkipArgs(
  engine: EngineType,
  skipPermissionPrompts: boolean
): string[] {
  if (!skipPermissionPrompts) return []

  if (engine === 'claude-code') {
    return ['--dangerously-skip-permissions']
  }

  return ['--yolo']
}
