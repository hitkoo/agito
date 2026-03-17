import { describe, expect, test } from 'bun:test'
import {
  buildInitialTerminalReplay,
  canHydrateTerminalViewport,
  getTerminalDockRenderMode,
  resolveSessionResumeEngine,
  shouldScheduleTrailingTerminalResize,
  shouldKeepTerminalLoading,
  shouldRenderAssignedTerminal,
  shouldSendPtyResize,
} from '../src/shared/terminal-dock-state'
import type { EngineType } from '../src/shared/types'

describe('getTerminalDockRenderMode', () => {
  test('renders hidden when the dock is not visible', () => {
    expect(
      getTerminalDockRenderMode({
        visible: false,
        minimized: false,
      })
    ).toBe('hidden')
  })

  test('renders the full dock when visible and not minimized', () => {
    expect(
      getTerminalDockRenderMode({
        visible: true,
        minimized: false,
      })
    ).toBe('dock')
  })

  test('renders the minimized bar when visible and minimized', () => {
    expect(
      getTerminalDockRenderMode({
        visible: true,
        minimized: true,
      })
    ).toBe('minimized-bar')
  })
})

describe('buildInitialTerminalReplay', () => {
  test('keeps serialized snapshot content and appends only newer queued chunks', () => {
    expect(
      buildInitialTerminalReplay(
        { serialized: 'snapshot', seq: 2, cols: 80, rows: 24, isAlive: true, bootstrapping: false },
        [
          { data: 'stale', seq: 1 },
          { data: 'dup', seq: 2 },
          { data: '+live', seq: 3 },
        ]
      )
    ).toEqual({
      data: 'snapshot+live',
      seq: 3,
    })
  })

  test('can hydrate purely from queued live chunks when snapshot is empty', () => {
    expect(
      buildInitialTerminalReplay(
        { serialized: '', seq: 0, cols: 80, rows: 24, isAlive: false, bootstrapping: false },
        [
          { data: 'a', seq: 1 },
          { data: 'b', seq: 2 },
        ]
      )
    ).toEqual({
      data: 'ab',
      seq: 2,
    })
  })
})

describe('canHydrateTerminalViewport', () => {
  test('allows initial hydrate whenever the local terminal container is measurable', () => {
    expect(
      canHydrateTerminalViewport({
        width: 800,
        height: 500,
      })
    ).toBe(true)
  })

  test('rejects hydrate only for zero-sized local containers', () => {
    expect(
      canHydrateTerminalViewport({
        width: 0,
        height: 500,
      })
    ).toBe(false)

    expect(
      canHydrateTerminalViewport({
        width: 800,
        height: 0,
      })
    ).toBe(false)
  })
})

describe('shouldRenderAssignedTerminal', () => {
  test('renders terminal view for any active assigned session without PTY liveness gating', () => {
    expect(
      shouldRenderAssignedTerminal({
        activeCharacterId: 'char-1',
        hasAssignedSession: true,
      })
    ).toBe(true)
  })

  test('does not render terminal view when there is no assigned session', () => {
    expect(
      shouldRenderAssignedTerminal({
        activeCharacterId: 'char-1',
        hasAssignedSession: false,
      })
    ).toBe(false)
  })
})

describe('shouldKeepTerminalLoading', () => {
  test('keeps spinner up for empty bootstrapping snapshots', () => {
    expect(
      shouldKeepTerminalLoading({
        snapshot: {
          serialized: '',
          seq: 0,
          cols: 80,
          rows: 24,
          isAlive: true,
          bootstrapping: true,
        },
        replayData: '',
      })
    ).toBe(true)
  })

  test('reveals terminal once replay data exists or bootstrapping is over', () => {
    expect(
      shouldKeepTerminalLoading({
        snapshot: {
          serialized: '',
          seq: 0,
          cols: 80,
          rows: 24,
          isAlive: true,
          bootstrapping: true,
        },
        replayData: 'prompt',
      })
    ).toBe(false)

    expect(
      shouldKeepTerminalLoading({
        snapshot: {
          serialized: '',
          seq: 0,
          cols: 80,
          rows: 24,
          isAlive: false,
          bootstrapping: false,
        },
        replayData: '',
      })
    ).toBe(false)
  })
})

describe('shouldSendPtyResize', () => {
  test('rejects resize from zero-sized terminal containers', () => {
    expect(
      shouldSendPtyResize({
        width: 800,
        height: 500,
        cols: 120,
        rows: 40,
      })
    ).toBe(true)

    expect(
      shouldSendPtyResize({
        width: 0,
        height: 500,
        cols: 120,
        rows: 40,
      })
    ).toBe(false)

    expect(
      shouldSendPtyResize({
        width: 800,
        height: 500,
        cols: 0,
        rows: 40,
      })
    ).toBe(false)
  })

  test('allows resize for visible terminals with positive dimensions', () => {
    expect(
      shouldSendPtyResize({
        width: 800,
        height: 500,
        cols: 120,
        rows: 40,
      })
    ).toBe(true)
  })
})

describe('shouldScheduleTrailingTerminalResize', () => {
  test('enables trailing resize resend only for codex', () => {
    expect(shouldScheduleTrailingTerminalResize('codex')).toBe(true)
    expect(shouldScheduleTrailingTerminalResize('claude-code')).toBe(false)
  })
})

describe('resolveSessionResumeEngine', () => {
  test('prefers the scanned session engine over UI fallback state', () => {
    expect(
      resolveSessionResumeEngine({
        scannedEngineType: 'claude-code',
        selectedEngine: 'codex',
        characterEngine: null,
      })
    ).toBe('claude-code')
  })

  test('falls back to selected engine and then character engine', () => {
    expect(
      resolveSessionResumeEngine({
        scannedEngineType: null,
        selectedEngine: 'codex',
        characterEngine: null,
      })
    ).toBe('codex')

    expect(
      resolveSessionResumeEngine({
        scannedEngineType: null,
        selectedEngine: null,
        characterEngine: 'claude-code' as EngineType,
      })
    ).toBe('claude-code')
  })
})
