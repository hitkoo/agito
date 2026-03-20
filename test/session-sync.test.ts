import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createUuidV7,
  findClaudeSessionArtifactPath,
  findCodexSessionArtifactPath,
  parseLastSessionIdFromStatusOutput,
  parseSessionIdFromStatusOutput,
} from '../src/main/session-sync'

describe('parseSessionIdFromStatusOutput', () => {
  test('extracts the first UUID from a status block', () => {
    const output = [
      'Model: codex',
      'Session ID: 019cfd3b-fb13-7d01-872d-8092e4be9f11',
      'Directory: /tmp/project',
    ].join('\n')

    expect(parseSessionIdFromStatusOutput(output)).toBe(
      '019cfd3b-fb13-7d01-872d-8092e4be9f11',
    )
  })

  test('extracts the last UUID from rendered status text', () => {
    const output = [
      'old 019cfd3b-fb13-7d01-872d-8092e4be9f11',
      'Session ID: 019d0701-c734-7eb3-a7f8-24185477d814',
    ].join('\n')

    expect(parseLastSessionIdFromStatusOutput(output)).toBe(
      '019d0701-c734-7eb3-a7f8-24185477d814',
    )
  })
})

describe('session artifact lookup', () => {
  test('finds a Claude session jsonl by session id stem', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'agito-sync-home-'))
    const projectsDir = join(fakeHome, '.claude', 'projects', '-tmp-project')
    mkdirSync(projectsDir, { recursive: true })
    const sessionId = '019cfd3b-fb13-7d01-872d-8092e4be9f11'
    const expectedPath = join(projectsDir, `${sessionId}.jsonl`)
    writeFileSync(expectedPath, '{"type":"assistant"}\n')

    expect(findClaudeSessionArtifactPath(fakeHome, sessionId)).toBe(expectedPath)
  })

  test('finds a nested Codex rollout jsonl by session id suffix', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'agito-sync-home-'))
    const sessionsDir = join(fakeHome, '.codex', 'sessions', '2026', '03', '19')
    mkdirSync(sessionsDir, { recursive: true })
    const sessionId = '019cfd3b-fb13-7d01-872d-8092e4be9f11'
    const expectedPath = join(
      sessionsDir,
      `rollout-2026-03-19T10-00-00-${sessionId}.jsonl`,
    )
    writeFileSync(expectedPath, '{"type":"session_meta","payload":{"id":"' + sessionId + '"}}\n')

    expect(findCodexSessionArtifactPath(fakeHome, sessionId)).toBe(expectedPath)
  })
})

describe('createUuidV7', () => {
  test('returns a valid UUID v7 string', () => {
    const id = createUuidV7()
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})
