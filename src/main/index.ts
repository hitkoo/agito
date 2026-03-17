import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIPCHandlers } from './ipc'
import { AgitoStore } from './store'
import { IPC_COMMANDS, IPC_DOCK_EVENTS } from '../shared/ipc-channels'
import type { TerminalDockSyncState } from '../shared/types'
import { DeepLinkOAuthCallbackCoordinator } from './auth/oauth-callback'

let mainWindow: BrowserWindow | null = null
let detachedTerminalWindow: BrowserWindow | null = null
const AUTH_PROTOCOL_SCHEME = 'agito'
const authDeepLinkCoordinator = new DeepLinkOAuthCallbackCoordinator(AUTH_PROTOCOL_SCHEME)

app.on('open-url', (event, url) => {
  event.preventDefault()
  authDeepLinkCoordinator.handleOpenUrl(url)
})

function loadRenderer(window: BrowserWindow, mode?: 'terminal-dock'): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const base = process.env['ELECTRON_RENDERER_URL']
    const url = mode ? `${base}${base.includes('?') ? '&' : '?'}mode=${mode}` : base
    window.loadURL(url)
  } else if (mode) {
    window.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { mode },
    })
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

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

  loadRenderer(mainWindow)
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.agito.app')
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(AUTH_PROTOCOL_SCHEME)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const store = new AgitoStore()
  store.initialize()

  registerIPCHandlers(store, {
    authProtocolScheme: AUTH_PROTOCOL_SCHEME,
    authDeepLinkCoordinator,
  })

  createWindow()

  // --- Terminal Dock Detach/Attach ---

  let savedDockSize = { width: 720, height: 520 }
  let dockSyncState: TerminalDockSyncState = {
    detached: false,
    minimized: false,
    activeCharacterId: null,
    ownerWindow: 'attached',
    detachedReady: false,
  }

  const syncDockState = (targets = BrowserWindow.getAllWindows()): void => {
    for (const win of targets) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_DOCK_EVENTS.TERMINAL_DOCK_SYNC, dockSyncState)
      }
    }
  }

  ipcMain.handle(IPC_COMMANDS.TERMINAL_DOCK_GET_STATE, () => dockSyncState)
  ipcMain.handle(IPC_COMMANDS.TERMINAL_DOCK_READY, () => {
    if (detachedTerminalWindow && !detachedTerminalWindow.isDestroyed()) {
      detachedTerminalWindow.show()
      detachedTerminalWindow.focus()
    }
    dockSyncState = {
      ...dockSyncState,
      ownerWindow: 'detached',
      detachedReady: true,
    }
    syncDockState()
  })

  ipcMain.handle(IPC_COMMANDS.TERMINAL_DOCK_SET_ACTIVE_CHARACTER, (_, activeCharacterId: string | null) => {
    dockSyncState = { ...dockSyncState, activeCharacterId }
    syncDockState()
  })

  ipcMain.handle(IPC_COMMANDS.TERMINAL_DOCK_DETACH, (_, state: { width?: number; height?: number; activeCharacterId?: string }) => {
    if (detachedTerminalWindow) {
      const wasMinimized = dockSyncState.minimized
      dockSyncState = {
        ...dockSyncState,
        detached: true,
        minimized: false,
        activeCharacterId: state.activeCharacterId ?? dockSyncState.activeCharacterId,
        ownerWindow: 'attached',
        detachedReady: false,
      }
      syncDockState([detachedTerminalWindow, ...BrowserWindow.getAllWindows().filter((win) => win !== detachedTerminalWindow)])
      detachedTerminalWindow.setAlwaysOnTop(false)
      if (wasMinimized) {
        detachedTerminalWindow.setSize(savedDockSize.width, savedDockSize.height)
      }
      return
    }

    const width = state.width || 720
    const height = state.height || 520
    savedDockSize = { width, height }
    dockSyncState = {
      detached: true,
      minimized: false,
      activeCharacterId: state.activeCharacterId ?? dockSyncState.activeCharacterId,
      ownerWindow: 'attached',
      detachedReady: false,
    }
    syncDockState(BrowserWindow.getAllWindows())

    detachedTerminalWindow = new BrowserWindow({
      width,
      height,
      show: false,
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

    detachedTerminalWindow.webContents.once('did-finish-load', () => {
      if (detachedTerminalWindow && !detachedTerminalWindow.isDestroyed()) {
        syncDockState([detachedTerminalWindow])
      }
    })

    loadRenderer(detachedTerminalWindow, 'terminal-dock')

    detachedTerminalWindow.on('closed', () => {
      detachedTerminalWindow = null
      dockSyncState = {
        ...dockSyncState,
        detached: false,
        minimized: false,
        ownerWindow: 'attached',
        detachedReady: false,
      }
      syncDockState()
    })
  })

  ipcMain.handle(IPC_COMMANDS.TERMINAL_DOCK_ATTACH, () => {
    if (detachedTerminalWindow) {
      dockSyncState = {
        ...dockSyncState,
        detached: false,
        minimized: false,
        ownerWindow: 'attached',
        detachedReady: false,
      }
      syncDockState()
      detachedTerminalWindow.close()
    }
  })

  // PiP minimize/restore
  ipcMain.handle(IPC_COMMANDS.TERMINAL_DOCK_MINIMIZE, () => {
    if (!detachedTerminalWindow) return
    const bounds = detachedTerminalWindow.getBounds()
    savedDockSize = { width: bounds.width, height: bounds.height }
    detachedTerminalWindow.setSize(320, 48)
    detachedTerminalWindow.setAlwaysOnTop(true, 'floating')
    dockSyncState = { ...dockSyncState, minimized: true }
    syncDockState()
  })

  ipcMain.handle(IPC_COMMANDS.TERMINAL_DOCK_RESTORE, () => {
    if (!detachedTerminalWindow) return
    detachedTerminalWindow.setSize(savedDockSize.width, savedDockSize.height)
    detachedTerminalWindow.setAlwaysOnTop(false)
    dockSyncState = { ...dockSyncState, minimized: false }
    syncDockState()
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
