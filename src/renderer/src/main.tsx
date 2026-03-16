import React from 'react'
import ReactDOM from 'react-dom/client'
import './globals.css'
import App from './App'
import { TerminalDockApp } from './TerminalDockApp'

const isTerminalDockMode = new URLSearchParams(window.location.search).get('mode') === 'terminal-dock'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isTerminalDockMode ? <TerminalDockApp /> : <App />}
  </React.StrictMode>
)
