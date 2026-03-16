import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIPCHandlers } from './ipc'
import { AgitoStore } from './store'

let mainWindow: BrowserWindow | null = null
let detachedTerminalWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.agito.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const store = new AgitoStore()
  store.initialize()

  registerIPCHandlers(store)

  createWindow()

  // --- Terminal Dock Detach/Attach ---

  let savedDockSize = { width: 720, height: 520 }

  ipcMain.handle('terminal-dock:detach', (_, state: { width?: number; height?: number; activeCharacterId?: string }) => {
    if (detachedTerminalWindow) {
      detachedTerminalWindow.focus()
      return
    }

    const width = state.width || 720
    const height = state.height || 520
    savedDockSize = { width, height }

    detachedTerminalWindow = new BrowserWindow({
      width,
      height,
      alwaysOnTop: false,
      frame: false,
      transparent: false,
      skipTaskbar: false,
      resizable: true,
      minimizable: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    // Load same renderer with query param to switch mode
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      const base = process.env['ELECTRON_RENDERER_URL']
      const sep = base.includes('?') ? '&' : '?'
      detachedTerminalWindow.loadURL(`${base}${sep}mode=terminal-dock`)
    } else {
      detachedTerminalWindow.loadFile(join(__dirname, '../renderer/index.html'), {
        query: { mode: 'terminal-dock' },
      })
    }

    detachedTerminalWindow.on('closed', () => {
      detachedTerminalWindow = null
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('terminal-dock:sync', { detached: false })
      }
    })

    // Notify all windows
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('terminal-dock:sync', { detached: true, activeCharacterId: state.activeCharacterId })
    }
  })

  ipcMain.handle('terminal-dock:attach', () => {
    if (detachedTerminalWindow) {
      detachedTerminalWindow.close()
      detachedTerminalWindow = null
    }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('terminal-dock:sync', { detached: false })
    }
  })

  // PiP minimize/restore
  ipcMain.handle('terminal-dock:minimize', () => {
    if (!detachedTerminalWindow) return
    const bounds = detachedTerminalWindow.getBounds()
    savedDockSize = { width: bounds.width, height: bounds.height }
    detachedTerminalWindow.setSize(320, 48)
    detachedTerminalWindow.setAlwaysOnTop(true, 'floating')
  })

  ipcMain.handle('terminal-dock:restore', () => {
    if (!detachedTerminalWindow) return
    detachedTerminalWindow.setSize(savedDockSize.width, savedDockSize.height)
    detachedTerminalWindow.setAlwaysOnTop(false)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
