import { describe, expect, test } from 'bun:test'
import { buildTerminalOptions, buildTerminalTheme } from '../src/renderer/src/panel/terminal-theme'

describe('buildTerminalTheme', () => {
  test('uses muted foreground for the cursor color', () => {
    const theme = buildTerminalTheme({
      '--background': '240 10% 10%',
      '--foreground': '0 0% 95%',
      '--muted': '240 10% 20%',
      '--muted-foreground': '240 5% 65%',
    })

    expect(theme.cursor).toBe('hsl(240 5% 65%)')
  })

  test('uses a translucent muted selection background', () => {
    const theme = buildTerminalTheme({
      '--background': '240 10% 10%',
      '--foreground': '0 0% 95%',
      '--muted': '240 10% 20%',
      '--muted-foreground': '240 5% 65%',
    })

    expect(theme.selectionBackground).toBe('hsl(240 10% 20% / 0.55)')
  })
})

describe('buildTerminalOptions', () => {
  test('hides the cursor when the terminal is unfocused', () => {
    const options = buildTerminalOptions({
      variables: {
        '--background': '240 10% 10%',
        '--foreground': '0 0% 95%',
        '--muted': '240 10% 20%',
        '--muted-foreground': '240 5% 65%',
      },
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 13,
    })

    expect(options.cursorInactiveStyle).toBe('none')
  })
})
