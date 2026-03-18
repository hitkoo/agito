import React from 'react'
import ReactDOM from 'react-dom/client'
import 'hack-font/build/web/hack.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/iosevka/400.css'
import '@fontsource/monaspace-neon/400.css'
import '@fontsource/maple-mono/400.css'
import './globals.css'
import App from './App'
import { TerminalDockApp } from './TerminalDockApp'

const isTerminalDockMode = new URLSearchParams(window.location.search).get('mode') === 'terminal-dock'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isTerminalDockMode ? <TerminalDockApp /> : <App />}
  </React.StrictMode>
)
