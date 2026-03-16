import { describe, expect, test } from 'bun:test'
import {
  buildInitialTerminalReplay,
  canHydrateTerminalViewport,
  getTerminalDockRenderMode,
  isTerminalDockOwner,
  shouldAutoResumeTerminal,
  shouldSendPtyResize,
} from '../src/shared/terminal-dock-state'

describe('getTerminalDockRenderMode', () => {
  test('renders attached dock only in attached visible state', () => {
    expect(
      getTerminalDockRenderMode({
        detachedMode: false,
        detached: false,
        visible: true,
        minimized: false,
        ownerWindow: 'attached',
        detachedReady: false,
      })
    ).toBe('attached-dock')
  })

  test('keeps attached dock visible until detached window is ready to take over', () => {
    expect(
      getTerminalDockRenderMode({
        detachedMode: false,
        detached: true,
        visible: true,
        minimized: false,
        ownerWindow: 'attached',
        detachedReady: false,
      })
    ).toBe('attached-dock')
  })

  test('keeps attached dock mounted as hidden warm standby after detached handoff', () => {
    expect(
      getTerminalDockRenderMode({
        detachedMode: false,
        detached: true,
        visible: true,
        minimized: false,
        ownerWindow: 'detached',
        detachedReady: true,
      })
    ).toBe('attached-dock-hidden-warm')
  })

  test('shows detached dock during handoff bootstrap before it becomes owner', () => {
    expect(
      getTerminalDockRenderMode({
        detachedMode: true,
        detached: true,
        visible: true,
        minimized: false,
        ownerWindow: 'attached',
        detachedReady: false,
      })
    ).toBe('detached-dock')
  })

  test('hides attached dock only after detached window owns the terminal', () => {
    expect(
      getTerminalDockRenderMode({
        detachedMode: false,
        detached: true,
        visible: false,
        minimized: false,
        ownerWindow: 'detached',
        detachedReady: true,
      })
    ).toBe('hidden')
  })

  test('shows detached minimized bar instead of full dock', () => {
    expect(
      getTerminalDockRenderMode({
        detachedMode: true,
        detached: true,
        visible: true,
        minimized: true,
        ownerWindow: 'detached',
        detachedReady: true,
      })
    ).toBe('detached-minimized-bar')
  })
})

describe('isTerminalDockOwner', () => {
  test('grants ownership to the window selected by dock sync state', () => {
    expect(isTerminalDockOwner({ detachedMode: false, ownerWindow: 'attached' })).toBe(true)
    expect(isTerminalDockOwner({ detachedMode: false, ownerWindow: 'detached' })).toBe(false)
    expect(isTerminalDockOwner({ detachedMode: true, ownerWindow: 'attached' })).toBe(false)
    expect(isTerminalDockOwner({ detachedMode: true, ownerWindow: 'detached' })).toBe(true)
  })
})

describe('shouldAutoResumeTerminal', () => {
  test('does not auto-resume from hidden attached dock', () => {
    expect(
      shouldAutoResumeTerminal({
        renderMode: 'hidden',
        activeCharacterId: 'char-1',
        hasAssignedSession: true,
        ptyAlive: false,
        isResuming: false,
      })
    ).toBe(false)
  })

  test('auto-resumes only for active visible dock owner', () => {
    expect(
      shouldAutoResumeTerminal({
        renderMode: 'detached-dock',
        activeCharacterId: 'char-1',
        hasAssignedSession: true,
        ptyAlive: false,
        isResuming: false,
      })
    ).toBe(true)
  })
})

describe('buildInitialTerminalReplay', () => {
  test('keeps serialized snapshot content and appends only newer queued chunks', () => {
    expect(
      buildInitialTerminalReplay(
        { serialized: 'snapshot', seq: 2, cols: 80, rows: 24, isAlive: true },
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
        { serialized: '', seq: 0, cols: 80, rows: 24, isAlive: false },
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

describe('shouldSendPtyResize', () => {
  test('rejects resize from inactive or zero-sized terminal containers', () => {
    expect(
      shouldSendPtyResize({
        isActiveOwner: false,
        width: 800,
        height: 500,
        cols: 120,
        rows: 40,
      })
    ).toBe(false)

    expect(
      shouldSendPtyResize({
        isActiveOwner: true,
        width: 0,
        height: 500,
        cols: 120,
        rows: 40,
      })
    ).toBe(false)

    expect(
      shouldSendPtyResize({
        isActiveOwner: true,
        width: 800,
        height: 500,
        cols: 0,
        rows: 40,
      })
    ).toBe(false)
  })

  test('allows resize only for active owner with positive dimensions', () => {
    expect(
      shouldSendPtyResize({
        isActiveOwner: true,
        width: 800,
        height: 500,
        cols: 120,
        rows: 40,
      })
    ).toBe(true)
  })
})
