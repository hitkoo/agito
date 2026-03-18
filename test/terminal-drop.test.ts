import { describe, expect, test } from 'bun:test'
import {
  buildTerminalDropInput,
  escapeTerminalDropPath,
  extractTerminalDropPaths,
  isTerminalFileDrop,
} from '../src/renderer/src/panel/terminal-drop'

describe('escapeTerminalDropPath', () => {
  test('keeps regular absolute paths unchanged', () => {
    expect(escapeTerminalDropPath('/tmp/example.png')).toBe('/tmp/example.png')
  })

  test('escapes spaces with backslashes like Warp', () => {
    expect(escapeTerminalDropPath('/tmp/space dir/image 1.png')).toBe('/tmp/space\\ dir/image\\ 1.png')
  })

  test('preserves unicode characters while escaping spaces', () => {
    expect(
      escapeTerminalDropPath('/Users/seungjin/Desktop/스크린샷 2026-03-18 오전 9.41.13.png'),
    ).toBe('/Users/seungjin/Desktop/스크린샷\\ 2026-03-18\\ 오전\\ 9.41.13.png')
  })
})

describe('buildTerminalDropInput', () => {
  test('adds a trailing space for a single dropped path', () => {
    expect(buildTerminalDropInput(['/tmp/example.png'])).toBe('/tmp/example.png ')
  })

  test('joins multiple dropped file paths with spaces and keeps the trailing space', () => {
    expect(
      buildTerminalDropInput([
        '/tmp/alpha.png',
        '/tmp/space dir/beta.png',
      ]),
    ).toBe('/tmp/alpha.png /tmp/space\\ dir/beta.png ')
  })

  test('ignores empty file paths and returns null when nothing usable exists', () => {
    expect(buildTerminalDropInput(['', '   '])).toBeNull()
  })
})

describe('isTerminalFileDrop', () => {
  test('treats a Files drag type as a file drop even before files are populated', () => {
    expect(
      isTerminalFileDrop({
        types: ['Files'],
        files: [],
      }),
    ).toBe(true)
  })
})

describe('extractTerminalDropPaths', () => {
  test('extracts dropped file paths from dataTransfer items first', () => {
    expect(
      extractTerminalDropPaths({
        items: [
          {
            kind: 'file',
            getAsFile: () => ({ marker: '/tmp/example.png' }),
          },
        ],
        files: [],
      }, (file) => (file as { marker?: string }).marker ?? ''),
    ).toEqual(['/tmp/example.png'])
  })
})
