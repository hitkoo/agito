import { describe, expect, test } from 'bun:test'
import {
  getTerminalDockRenderMode,
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
      })
    ).toBe('attached-dock')
  })

  test('hides attached dock when detached window owns the terminal', () => {
    expect(
      getTerminalDockRenderMode({
        detachedMode: false,
        detached: true,
        visible: true,
        minimized: false,
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
      })
    ).toBe('detached-minimized-bar')
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
