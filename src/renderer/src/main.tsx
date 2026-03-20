import React from 'react'
import ReactDOM from 'react-dom/client'
import 'hack-font/build/web/hack.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/iosevka/400.css'
import '@fontsource/monaspace-neon/400.css'
import '@fontsource/maple-mono/400.css'
import './globals.css'
import { applyInitialThemeClass } from './lib/theme-boot'
import App from './App'
import { TerminalDockApp } from './TerminalDockApp'

applyInitialThemeClass(window)

const dockQuery = new URLSearchParams(window.location.search)
const isTerminalDockMode = dockQuery.get('mode') === 'terminal-dock'
const terminalDockRole =
  dockQuery.get('role') === 'float-bar' ? 'float-bar' : 'terminal-window'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isTerminalDockMode ? <TerminalDockApp windowRole={terminalDockRole} /> : <App />}
  </React.StrictMode>
)
