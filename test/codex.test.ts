import { describe, expect, test } from 'bun:test'
import { codexAdapter } from '../src/main/engine/codex'

describe('codexAdapter.buildSpawnArgs', () => {
  test('starts a new session with additional args only', () => {
    expect(
      codexAdapter.buildSpawnArgs({
        workingDirectory: '/tmp/project',
        additionalArgs: ['--yolo'],
      })
    ).toEqual(['--yolo'])
  })

  test('places resume before additional args for an existing saved session', () => {
    expect(
      codexAdapter.buildSpawnArgs({
        sessionId: '019cfd3b-fb13-7d01-872d-8092e4be9f11',
        workingDirectory: '/tmp/project',
        additionalArgs: ['--yolo'],
      })
    ).toEqual(['resume', '019cfd3b-fb13-7d01-872d-8092e4be9f11', '--yolo'])
  })
})
