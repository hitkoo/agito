import { describe, expect, test } from 'bun:test'
import { claudeCodeAdapter } from '../src/main/engine/claude-code'

describe('claudeCodeAdapter.buildSpawnArgs', () => {
  test('uses --session-id for a new session start', () => {
    expect(
      claudeCodeAdapter.buildSpawnArgs({
        startSessionId: '019cfd3b-fb13-7d01-872d-8092e4be9f11',
        workingDirectory: '/tmp/project',
      })
    ).toEqual(['--session-id', '019cfd3b-fb13-7d01-872d-8092e4be9f11'])
  })

  test('uses --resume for an existing saved session', () => {
    expect(
      claudeCodeAdapter.buildSpawnArgs({
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        workingDirectory: '/tmp/project',
      })
    ).toEqual(['--resume', '550e8400-e29b-41d4-a716-446655440000'])
  })

  test('appends additional args after the session flags', () => {
    expect(
      claudeCodeAdapter.buildSpawnArgs({
        startSessionId: '019cfd3b-fb13-7d01-872d-8092e4be9f11',
        workingDirectory: '/tmp/project',
        additionalArgs: ['--dangerously-skip-permissions'],
      })
    ).toEqual([
      '--session-id',
      '019cfd3b-fb13-7d01-872d-8092e4be9f11',
      '--dangerously-skip-permissions',
    ])
  })
})
