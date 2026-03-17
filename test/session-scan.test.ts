import { describe, expect, test } from 'bun:test'
import {
  extractClaudeSessionMetadataFromHead,
  extractClaudeSessionLabelsFromHistory,
  extractCodexSessionIndexEntries,
  extractCodexSessionMetadataFromHead,
  getPreferredClaudeSessionLabel,
  getPreferredCodexSessionLabel,
  mergeCodexScannedSessions,
} from '../src/main/session-scan'

describe('extractClaudeSessionMetadataFromHead', () => {
  test('finds Claude session metadata even when file-history-snapshot is first', () => {
    const head = [
      JSON.stringify({ type: 'file-history-snapshot', files: [] }),
      JSON.stringify({
        parentUuid: null,
        isSidechain: false,
        userType: 'external',
        cwd: '/Users/seungjin/Desktop/seungjin/agito',
        sessionId: '49d62636-d7fd-4ba8-89b3-0cc612f6fe15',
        version: '1.0.107',
        gitBranch: 'main',
        type: 'user',
        message: { role: 'user', content: 'hello' },
        timestamp: '2026-03-18T01:02:03.000Z',
      }),
    ].join('\n')

    expect(extractClaudeSessionMetadataFromHead(head)).toEqual({
      sessionId: '49d62636-d7fd-4ba8-89b3-0cc612f6fe15',
      cwd: '/Users/seungjin/Desktop/seungjin/agito',
      gitBranch: 'main',
      timestamp: '2026-03-18T01:02:03.000Z',
    })
  })

  test('keeps existing first-line metadata behavior', () => {
    const head = JSON.stringify({
      sessionId: 'bc248311-06d2-43f8-b6d3-c1e201ab41e4',
      cwd: '/tmp/project',
      gitBranch: 'feature/test',
      timestamp: '2026-03-18T04:05:06.000Z',
    })

    expect(extractClaudeSessionMetadataFromHead(head)).toEqual({
      sessionId: 'bc248311-06d2-43f8-b6d3-c1e201ab41e4',
      cwd: '/tmp/project',
      gitBranch: 'feature/test',
      timestamp: '2026-03-18T04:05:06.000Z',
    })
  })

  test('ignores metadata that only appears after the bounded scan window', () => {
    const filler = Array.from({ length: 32 }, (_, index) =>
      JSON.stringify({ type: 'file-history-snapshot', index })
    )
    const head = [
      ...filler,
      JSON.stringify({
        sessionId: 'too-late',
        cwd: '/late',
        gitBranch: 'main',
        timestamp: '2026-03-18T07:08:09.000Z',
      }),
    ].join('\n')

    expect(extractClaudeSessionMetadataFromHead(head)).toBeNull()
  })
})

describe('extractClaudeSessionLabelsFromHistory', () => {
  test('prefers the latest non-generic history display per session', () => {
    const history = [
      JSON.stringify({
        sessionId: 's1',
        display: 'session',
        timestamp: 100,
      }),
      JSON.stringify({
        sessionId: 's1',
        display: 'Refactor terminal dock status model',
        timestamp: 200,
      }),
      JSON.stringify({
        sessionId: 's2',
        display: 'session',
        timestamp: 300,
      }),
      JSON.stringify({
        sessionId: 's3',
        display: '   Rename auth flow   ',
        timestamp: 400,
      }),
    ].join('\n')

    expect(extractClaudeSessionLabelsFromHistory(history)).toEqual(
      new Map([
        ['s1', 'Refactor terminal dock status model'],
        ['s3', 'Rename auth flow'],
      ])
    )
  })
})

describe('getPreferredClaudeSessionLabel', () => {
  test('uses history label before gitBranch fallback', () => {
    expect(
      getPreferredClaudeSessionLabel({
        historyLabel: 'Named session',
        gitBranch: 'HEAD',
        workingDirectory: '/Users/seungjin/Desktop/seungjin/agito',
      })
    ).toBe('Named session')
  })

  test('falls back to basename when gitBranch is generic HEAD', () => {
    expect(
      getPreferredClaudeSessionLabel({
        historyLabel: null,
        gitBranch: 'HEAD',
        workingDirectory: '/Users/seungjin/Desktop/seungjin/agito',
      })
    ).toBe('agito')
  })
})

describe('extractCodexSessionMetadataFromHead', () => {
  test('extracts session_meta and first user_message snippet from Codex session files', () => {
    const head = [
      JSON.stringify({
        type: 'session_meta',
        payload: {
          id: '019cfd0d-61ef-7d21-9aa4-9be8d14a49a2',
          cwd: '/Users/seungjin/Desktop/seungjin/agito/agito-app',
          timestamp: '2026-03-17T18:27:18.642Z',
          originator: 'Codex Desktop',
          source: 'vscode',
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: '오랜만\n',
        },
      }),
    ].join('\n')

    expect(extractCodexSessionMetadataFromHead(head)).toEqual({
      sessionId: '019cfd0d-61ef-7d21-9aa4-9be8d14a49a2',
      cwd: '/Users/seungjin/Desktop/seungjin/agito/agito-app',
      timestamp: '2026-03-17T18:27:18.642Z',
      originator: 'Codex Desktop',
      source: 'vscode',
      userMessageLabel: '오랜만',
    })
  })
})

describe('extractCodexSessionIndexEntries', () => {
  test('parses thread names from session_index.jsonl', () => {
    const index = [
      JSON.stringify({
        id: 's1',
        thread_name: 'Fix build error after merge',
        updated_at: '2026-03-09T02:02:57.814331Z',
        cwd: '/tmp/project',
      }),
    ].join('\n')

    expect(extractCodexSessionIndexEntries(index)).toEqual(
      new Map([
        ['s1', {
          sessionId: 's1',
          threadName: 'Fix build error after merge',
          updatedAt: '2026-03-09T02:02:57.814331Z',
          cwd: '/tmp/project',
        }],
      ])
    )
  })
})

describe('getPreferredCodexSessionLabel', () => {
  test('prefers sqlite title, then index label, then user message snippet', () => {
    expect(
      getPreferredCodexSessionLabel({
        sqliteTitle: 'SQLite title',
        indexLabel: 'Index title',
        userMessageLabel: 'Prompt snippet',
        workingDirectory: '/tmp/project',
        sessionId: 'session-12345678',
      })
    ).toBe('SQLite title')

    expect(
      getPreferredCodexSessionLabel({
        sqliteTitle: null,
        indexLabel: 'Index title',
        userMessageLabel: 'Prompt snippet',
        workingDirectory: '/tmp/project',
        sessionId: 'session-12345678',
      })
    ).toBe('Index title')

    expect(
      getPreferredCodexSessionLabel({
        sqliteTitle: null,
        indexLabel: null,
        userMessageLabel: 'Prompt snippet',
        workingDirectory: '/tmp/project',
        sessionId: 'session-12345678',
      })
    ).toBe('Prompt snippet')
  })
})

describe('mergeCodexScannedSessions', () => {
  test('keeps sqlite rows authoritative but adds file-only latest sessions', () => {
    expect(
      mergeCodexScannedSessions({
        sqliteSessions: [
          {
            sessionId: 'sqlite-session',
            engineType: 'codex',
            workingDirectory: '/tmp/sqlite',
            label: 'SQLite title',
            createdAt: '2026-03-17T01:00:00.000Z',
            lastActiveAt: '2026-03-17T02:00:00.000Z',
          },
        ],
        fileSessions: [
          {
            sessionId: 'sqlite-session',
            engineType: 'codex',
            workingDirectory: '/tmp/file',
            label: 'File title',
            createdAt: '2026-03-17T01:00:00.000Z',
            lastActiveAt: '2026-03-17T03:00:00.000Z',
          },
          {
            sessionId: 'file-only-session',
            engineType: 'codex',
            workingDirectory: '/tmp/new',
            label: 'Prompt snippet',
            createdAt: '2026-03-18T01:00:00.000Z',
            lastActiveAt: '2026-03-18T02:00:00.000Z',
          },
        ],
        indexSessions: [],
      })
    ).toEqual([
      {
        sessionId: 'sqlite-session',
        engineType: 'codex',
        workingDirectory: '/tmp/sqlite',
        label: 'SQLite title',
        createdAt: '2026-03-17T01:00:00.000Z',
        lastActiveAt: '2026-03-17T02:00:00.000Z',
      },
      {
        sessionId: 'file-only-session',
        engineType: 'codex',
        workingDirectory: '/tmp/new',
        label: 'Prompt snippet',
        createdAt: '2026-03-18T01:00:00.000Z',
        lastActiveAt: '2026-03-18T02:00:00.000Z',
      },
    ])
  })
})
