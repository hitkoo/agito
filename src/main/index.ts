import { app, shell, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIPCHandlers } from './ipc'
import { AgitoStore } from './store'
import { IPC_COMMANDS, IPC_DOCK_EVENTS } from '../shared/ipc-channels'
import type { TerminalDockSyncState } from '../shared/types'
import {
  createEmptyDockLayout,
  ensureCharacterSurface,
  getActiveCharacterId,
  listOpenCharacterIds,
  type DockLayout,
} from '../shared/terminal-dock-layout'
import {
  clampTerminalDockBarHeight,
  getAnchoredDockBounds,
  getFittedMinimizedDockWidth,
  TERMINAL_DOCK_BAR_DEFAULT_HEIGHT,
} from '../shared/terminal-dock-bar'
import { DeepLinkOAuthCallbackCoordinator } from './auth/oauth-callback'
import { DeepLinkBillingCheckoutCoordinator } from './billing-callback'

let mainWindow: BrowserWindow | null = null
let detachedTerminalWindow: BrowserWindow | null = null
const AUTH_PROTOCOL_SCHEME = 'agito'
const authDeepLinkCoordinator = new DeepLinkOAuthCallbackCoordinator(AUTH_PROTOCOL_SCHEME)
const billingDeepLinkCoordinator = new DeepLinkBillingCheckoutCoordinator(AUTH_PROTOCOL_SCHEME)

app.on('open-url', (event, url) => {
  event.preventDefault()
  if (authDeepLinkCoordinator.handleOpenUrl(url)) return
  billingDeepLinkCoordinator.handleOpenUrl(url)
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
    billingProtocolScheme: AUTH_PROTOCOL_SCHEME,
    billingDeepLinkCoordinator,
  })

  createWindow()

  // --- Terminal Dock ---

  let savedDockSize = { width: 720, height: 520 }
  let savedMinimizedDockHeight = TERMINAL_DOCK_BAR_DEFAULT_HEIGHT
  const initialDockLayout = createEmptyDockLayout()
  let dockSyncState: TerminalDockSyncState = {
    visible: false,
    minimized: false,
    focusedPaneId: initialDockLayout.focusedPaneId,
    activeCharacterId: null,
    layout: initialDockLayout,
  }

  const syncDockState = (targets = BrowserWindow.getAllWindows()): void => {
    for (const win of targets) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_DOCK_EVENTS.TERMINAL_DOCK_SYNC, dockSyncState)
      }
    }
  }

  const syncDetachedDockState = (): void => {
    if (!detachedTerminalWindow || detachedTerminalWindow.isDestroyed()) return
    syncDockState([detachedTerminalWindow])
  }

  const updateDockLayout = (layout: DockLayout): void => {
    dockSyncState = {
      ...dockSyncState,
      layout,
      focusedPaneId: layout.focusedPaneId,
      activeCharacterId: getActiveCharacterId(layout),
    }
  }

  const applyMinimizedDockBounds = (): void => {
    if (!detachedTerminalWindow || detachedTerminalWindow.isDestroyed()) return

    const currentBounds = detachedTerminalWindow.getBounds()
    const display = screen.getDisplayMatching(currentBounds)
    const workArea = display.workArea
    const maxWidth = Math.max(96, display.workArea.width - 32)
    const nextHeight = clampTerminalDockBarHeight(savedMinimizedDockHeight)
    const openCharacterCount = listOpenCharacterIds(dockSyncState.layout).length
    const visibleCharacterCount =
      openCharacterCount > 0 ? openCharacterCount : store.getCharacters().length
    const nextWidth = getFittedMinimizedDockWidth({
      characterCount: visibleCharacterCount,
      height: nextHeight,
      maxWidth,
    })

    detachedTerminalWindow.setBounds(
      getAnchoredDockBounds({
        anchorBounds: currentBounds,
        nextWidth,
        nextHeight,
        workArea,
      }),
    )
  }

  const minimizeDetachedDockWindow = (options?: { height?: number }): void => {
    if (!detachedTerminalWindow || detachedTerminalWindow.isDestroyed()) return

    const bounds = detachedTerminalWindow.getBounds()
    savedDockSize = { width: bounds.width, height: bounds.height }
    if (typeof options?.height === 'number') {
      savedMinimizedDockHeight = clampTerminalDockBarHeight(options.height)
    }
    dockSyncState = { ...dockSyncState, visible: true, minimized: true }
    syncDetachedDockState()
    detachedTerminalWindow.setAlwaysOnTop(true, 'floating')
    detachedTerminalWindow.setResizable(false)
    applyMinimizedDockBounds()
    syncDockState()
  }

  const restoreDetachedDockWindow = (): void => {
    if (!detachedTerminalWindow || detachedTerminalWindow.isDestroyed()) return

    dockSyncState = { ...dockSyncState, minimized: false }
    syncDetachedDockState()
    const currentBounds = detachedTerminalWindow.getBounds()
    const display = screen.getDisplayMatching(currentBounds)
    detachedTerminalWindow.setBounds(
      getAnchoredDockBounds({
        anchorBounds: currentBounds,
        nextWidth: savedDockSize.width,
        nextHeight: savedDockSize.height,
        workArea: display.workArea,
      }),
    )
    detachedTerminalWindow.setAlwaysOnTop(false)
    detachedTerminalWindow.setResizable(true)
  }

  const createDetachedDockWindow = (): BrowserWindow => {
    const dockWindow = new BrowserWindow({
      width: savedDockSize.width,
      height: savedDockSize.height,
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

    dockWindow.webContents.once('did-finish-load', () => {
      syncDockState([dockWindow])
    })

    dockWindow.webContents.on('before-input-event', (event, input) => {
      if (
        input.type === 'keyDown' &&
        input.meta &&
        !input.alt &&
        !input.control &&
        !input.shift &&
        input.key.toLowerCase() === 'w'
      ) {
        event.preventDefault()
        if (!dockSyncState.minimized) {
          minimizeDetachedDockWindow()
        }
      }
    })

    dockWindow.once('ready-to-show', () => {
      if (dockSyncState.visible && !dockWindow.isDestroyed()) {
        dockWindow.show()
        dockWindow.focus()
      }
    })

    dockWindow.on('closed', () => {
      detachedTerminalWindow = null
      dockSyncState = {
        ...dockSyncState,
        visible: false,
        minimized: false,
      }
      syncDockState()
    })

    loadRenderer(dockWindow, 'terminal-dock')
    return dockWindow
  }

  ipcMain.handle(IPC_COMMANDS.TERMINAL_DOCK_GET_STATE, () => dockSyncState)
  ipcMain.handle(IPC_COMMANDS.TERMINAL_DOCK_SHOW, (_, args?: { characterId?: string }) => {
    const wasMinimized = dockSyncState.minimized

    if (args?.characterId) {
      updateDockLayout(ensureCharacterSurface(dockSyncState.layout, args.characterId))
    }

    dockSyncState = {
      ...dockSyncState,
      visible: true,
      minimized: false,
    }

    if (!detachedTerminalWindow || detachedTerminalWindow.isDestroyed()) {
      detachedTerminalWindow = createDetachedDockWindow()
      syncDockState(BrowserWindow.getAllWindows())
      return
    }

    if (wasMinimized) {
      restoreDetachedDockWindow()
    } else {
      detachedTerminalWindow.setAlwaysOnTop(false)
      detachedTerminalWindow.setResizable(true)
      detachedTerminalWindow.setSize(savedDockSize.width, savedDockSize.height)
    }
    detachedTerminalWindow.show()
    detachedTerminalWindow.focus()
    syncDockState()
  })

  ipcMain.handle(IPC_COMMANDS.TERMINAL_DOCK_HIDE, () => {
    dockSyncState = {
      ...dockSyncState,
      visible: false,
      minimized: false,
    }
    syncDockState()
    detachedTerminalWindow?.close()
  })

  ipcMain.handle(
    IPC_COMMANDS.TERMINAL_DOCK_SET_LAYOUT,
    (_, state: { layout: DockLayout; focusedPaneId: string; activeCharacterId: string | null }) => {
      dockSyncState = {
        ...dockSyncState,
        layout: state.layout,
        focusedPaneId: state.focusedPaneId,
        activeCharacterId: state.activeCharacterId,
      }
      if (dockSyncState.minimized) {
        applyMinimizedDockBounds()
      }
      syncDockState()
    }
  )

  // PiP minimize/restore
  ipcMain.handle(IPC_COMMANDS.TERMINAL_DOCK_MINIMIZE, (_, args?: { height?: number }) => {
    minimizeDetachedDockWindow(args)
  })

  ipcMain.handle(IPC_COMMANDS.TERMINAL_DOCK_RESTORE, () => {
    restoreDetachedDockWindow()
    syncDockState()
  })

  ipcMain.handle(
    IPC_COMMANDS.TERMINAL_DOCK_SET_MINIMIZED_HEIGHT,
    (_, args: { height: number }) => {
      savedMinimizedDockHeight = clampTerminalDockBarHeight(args.height)
      if (dockSyncState.minimized) {
        applyMinimizedDockBounds()
      }
    }
  )

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
