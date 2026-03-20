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
  FLOAT_TERMINAL_DOCK_GAP,
  getAnchoredDockBounds,
  getFloatBarCharacterCount,
  getFloatBarBoundsFromTerminalBounds,
  getFloatTerminalBoundsFromBarBounds,
  getFittedMinimizedDockWidth,
  type DockWindowBounds,
  TERMINAL_DOCK_BAR_DEFAULT_HEIGHT,
} from '../shared/terminal-dock-bar'
import {
  getTerminalDockAlwaysOnTopLevel,
  getTerminalDockWindowCloseShortcutAction,
} from '../shared/terminal-dock-state'
import { DeepLinkOAuthCallbackCoordinator } from './auth/oauth-callback'
import { DeepLinkBillingCheckoutCoordinator } from './billing-callback'

let mainWindow: BrowserWindow | null = null
let terminalDockWindow: BrowserWindow | null = null
let floatDockWindow: BrowserWindow | null = null
const APP_DARK_BACKGROUND = '#302f33'
const AUTH_PROTOCOL_SCHEME = 'agito'
const authDeepLinkCoordinator = new DeepLinkOAuthCallbackCoordinator(AUTH_PROTOCOL_SCHEME)
const billingDeepLinkCoordinator = new DeepLinkBillingCheckoutCoordinator(AUTH_PROTOCOL_SCHEME)

app.on('open-url', (event, url) => {
  event.preventDefault()
  if (authDeepLinkCoordinator.handleOpenUrl(url)) return
  billingDeepLinkCoordinator.handleOpenUrl(url)
})

function loadRenderer(
  window: BrowserWindow,
  options?: { mode?: 'terminal-dock'; role?: 'terminal-window' | 'float-bar' }
): void {
  const query = new URLSearchParams()
  if (options?.mode) query.set('mode', options.mode)
  if (options?.role) query.set('role', options.role)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const base = process.env['ELECTRON_RENDERER_URL']
    const queryString = query.toString()
    const url = queryString ? `${base}${base.includes('?') ? '&' : '?'}${queryString}` : base
    window.loadURL(url)
  } else if (query.size > 0) {
    window.loadFile(join(__dirname, '../renderer/index.html'), {
      query: Object.fromEntries(query.entries()),
    })
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    show: false,
    backgroundColor: APP_DARK_BACKGROUND,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
    }
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  loadRenderer(window)
  mainWindow = window
  return window
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

  let savedTerminalBounds: DockWindowBounds | null = null
  let savedFloatTerminalBounds: DockWindowBounds | null = null
  let savedTerminalSize = { width: 720, height: 520 }
  let savedDockBarHeight = TERMINAL_DOCK_BAR_DEFAULT_HEIGHT
  let syncingFloatPair = false
  const initialDockLayout = createEmptyDockLayout()
  let dockSyncState: TerminalDockSyncState = {
    floatMode: false,
    terminalVisible: false,
    barVisible: false,
    focusedPaneId: initialDockLayout.focusedPaneId,
    activeCharacterId: null,
    layout: initialDockLayout,
  }

  const toDockBounds = (bounds: Electron.Rectangle): DockWindowBounds => ({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  })

  const getOpenCharacterCount = (): number => {
    return getFloatBarCharacterCount({
      openCharacterCount: listOpenCharacterIds(dockSyncState.layout).length,
      totalCharacterCount: store.getCharacters().length,
    })
  }

  const getWorkAreaForBounds = (bounds?: DockWindowBounds | null): DockWindowBounds => {
    if (bounds) {
      return toDockBounds(screen.getDisplayMatching(bounds).workArea)
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      return toDockBounds(screen.getDisplayMatching(mainWindow.getBounds()).workArea)
    }

    return toDockBounds(screen.getPrimaryDisplay().workArea)
  }

  const getCurrentTerminalBounds = (): DockWindowBounds | null => {
    if (terminalDockWindow && !terminalDockWindow.isDestroyed()) {
      return toDockBounds(terminalDockWindow.getBounds())
    }
    return getTargetTerminalBoundsForState()
  }

  const getTargetTerminalBoundsForState = (): DockWindowBounds | null => {
    if (dockSyncState.floatMode && savedFloatTerminalBounds) {
      return savedFloatTerminalBounds
    }

    if (savedTerminalBounds) {
      return dockSyncState.floatMode
        ? getFloatTerminalBoundsFromBaseBounds(savedTerminalBounds)
        : savedTerminalBounds
    }

    if (terminalDockWindow && !terminalDockWindow.isDestroyed()) {
      return toDockBounds(terminalDockWindow.getBounds())
    }

    return null
  }

  const getFloatTerminalHeight = (baseHeight: number): number => {
    return Math.max(200, baseHeight - (savedDockBarHeight + FLOAT_TERMINAL_DOCK_GAP))
  }

  const getFloatTerminalBoundsFromBaseBounds = (bounds: DockWindowBounds): DockWindowBounds => {
    return {
      ...bounds,
      height: getFloatTerminalHeight(bounds.height),
    }
  }

  const getBaseTerminalBoundsFromFloatBounds = (bounds: DockWindowBounds): DockWindowBounds => {
    return {
      ...bounds,
      height: bounds.height + savedDockBarHeight + FLOAT_TERMINAL_DOCK_GAP,
    }
  }

  const persistTerminalBounds = (bounds: DockWindowBounds): void => {
    const nextBounds = dockSyncState.floatMode
      ? getBaseTerminalBoundsFromFloatBounds(bounds)
      : bounds
    savedTerminalBounds = nextBounds
    savedTerminalSize = { width: nextBounds.width, height: nextBounds.height }
    if (dockSyncState.floatMode) {
      savedFloatTerminalBounds = bounds
    }
  }

  const ensureMainWindowVisible = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
      return
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.show()
    mainWindow.focus()
  }

  const syncDockState = (targets = BrowserWindow.getAllWindows()): void => {
    for (const win of targets) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_DOCK_EVENTS.TERMINAL_DOCK_SYNC, dockSyncState)
      }
    }
  }

  const updateDockLayout = (layout: DockLayout): void => {
    dockSyncState = {
      ...dockSyncState,
      layout,
      focusedPaneId: layout.focusedPaneId,
      activeCharacterId: getActiveCharacterId(layout),
    }
  }

  const getStandaloneBarBounds = (anchorBounds?: DockWindowBounds | null): DockWindowBounds => {
    const nextHeight = clampTerminalDockBarHeight(savedDockBarHeight)
    const workArea = getWorkAreaForBounds(anchorBounds ?? getCurrentTerminalBounds())
    const nextWidth = getFittedMinimizedDockWidth({
      characterCount: getOpenCharacterCount(),
      height: nextHeight,
      maxWidth: Math.max(96, workArea.width - 32),
    })

    const currentBarBounds =
      floatDockWindow && !floatDockWindow.isDestroyed()
        ? toDockBounds(floatDockWindow.getBounds())
        : null
    const effectiveAnchor =
      currentBarBounds ??
      anchorBounds ??
      savedTerminalBounds ?? {
        x: workArea.x + Math.round((workArea.width - nextWidth) / 2),
        y: workArea.y + workArea.height - nextHeight - 32,
        width: nextWidth,
        height: nextHeight,
      }

    return getAnchoredDockBounds({
      anchorBounds: effectiveAnchor,
      nextWidth,
      nextHeight,
      workArea,
    })
  }

  const getPairedBarBounds = (terminalBounds?: DockWindowBounds | null): DockWindowBounds => {
    const effectiveTerminalBounds = terminalBounds ?? getCurrentTerminalBounds()
    const workArea = getWorkAreaForBounds(effectiveTerminalBounds)

    if (effectiveTerminalBounds) {
      return getFloatBarBoundsFromTerminalBounds({
        terminalBounds: effectiveTerminalBounds,
        barHeight: savedDockBarHeight,
        characterCount: getOpenCharacterCount(),
        workArea,
      })
    }

    const fallbackTerminalBounds = {
      x: workArea.x + Math.round((workArea.width - savedTerminalSize.width) / 2),
      y: workArea.y + Math.round((workArea.height - savedTerminalSize.height) / 2),
      width: savedTerminalSize.width,
      height: savedTerminalSize.height,
    }

    return getFloatBarBoundsFromTerminalBounds({
      terminalBounds: fallbackTerminalBounds,
      barHeight: savedDockBarHeight,
      characterCount: getOpenCharacterCount(),
      workArea,
    })
  }

  const getPairedTerminalBounds = (barBounds?: DockWindowBounds | null): DockWindowBounds => {
    const effectiveBarBounds =
      barBounds ??
      (floatDockWindow && !floatDockWindow.isDestroyed()
        ? toDockBounds(floatDockWindow.getBounds())
        : null)

    if (!effectiveBarBounds) {
      return getCurrentTerminalBounds() ?? {
        x: 0,
        y: 0,
        width: savedTerminalSize.width,
        height: getFloatTerminalHeight(savedTerminalSize.height),
      }
    }

    return getFloatTerminalBoundsFromBarBounds({
      barBounds: effectiveBarBounds,
      terminalWidth: savedTerminalSize.width,
      terminalHeight: getFloatTerminalHeight(savedTerminalSize.height),
      workArea: getWorkAreaForBounds(effectiveBarBounds),
    })
  }

  const createTerminalDockWindow = (): BrowserWindow => {
    const initialTerminalBounds = getTargetTerminalBoundsForState()
    const dockWindow = new BrowserWindow({
      width: initialTerminalBounds?.width ?? savedTerminalSize.width,
      height: initialTerminalBounds?.height ?? savedTerminalSize.height,
      x: initialTerminalBounds?.x,
      y: initialTerminalBounds?.y,
      show: false,
      backgroundColor: APP_DARK_BACKGROUND,
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
      if (input.type === 'keyDown') {
        const action = getTerminalDockWindowCloseShortcutAction({
          role: 'terminal-window',
          floatMode: dockSyncState.floatMode,
          key: input.key,
          metaKey: input.meta,
          ctrlKey: input.control,
          altKey: input.alt,
          shiftKey: input.shift,
        })

        if (action === 'prevent') {
          event.preventDefault()
          return
        }

        if (action === 'close-float-terminal') {
          event.preventDefault()
          dockSyncState = {
            ...dockSyncState,
            terminalVisible: false,
            barVisible: true,
          }
          persistTerminalBounds(toDockBounds(dockWindow.getBounds()))
          updateWindowVisibility()
          syncDockState()
          return
        }

        if (action !== 'close-terminal') return
        event.preventDefault()
        const shouldReopenMain = !dockSyncState.floatMode && (!mainWindow || mainWindow.isDestroyed())
        dockSyncState = {
          ...dockSyncState,
          terminalVisible: false,
          barVisible: dockSyncState.floatMode ? dockSyncState.barVisible : false,
        }
        updateWindowVisibility()
        syncDockState()
        if (shouldReopenMain) {
          ensureMainWindowVisible()
        }
      }
    })

    dockWindow.on('move', () => {
      if (dockSyncState.floatMode) {
        persistTerminalBounds(toDockBounds(dockWindow.getBounds()))
      }
    })
    dockWindow.on('resize', () => {
      if (dockSyncState.floatMode) {
        persistTerminalBounds(toDockBounds(dockWindow.getBounds()))
      }
    })

    dockWindow.once('ready-to-show', () => {
      if (dockSyncState.terminalVisible && !dockWindow.isDestroyed()) {
        dockWindow.show()
        dockWindow.focus()
      }
    })

    dockWindow.on('closed', () => {
      if (terminalDockWindow !== dockWindow) return
      if (!dockWindow.isDestroyed()) {
        persistTerminalBounds(toDockBounds(dockWindow.getBounds()))
      }
      terminalDockWindow = null
      if (dockSyncState.terminalVisible) {
        dockSyncState = {
          ...dockSyncState,
          terminalVisible: false,
          barVisible: dockSyncState.floatMode ? dockSyncState.barVisible : false,
        }
      }
      if (!dockSyncState.floatMode && !dockSyncState.barVisible && (!mainWindow || mainWindow.isDestroyed())) {
        ensureMainWindowVisible()
      }
      syncDockState()
    })

    loadRenderer(dockWindow, { mode: 'terminal-dock', role: 'terminal-window' })
    return dockWindow
  }

  const createFloatDockWindow = (): BrowserWindow => {
    const barBounds = dockSyncState.floatMode
      ? getPairedBarBounds(getCurrentTerminalBounds())
      : getStandaloneBarBounds(savedTerminalBounds)
    const dockWindow = new BrowserWindow({
      x: barBounds.x,
      y: barBounds.y,
      width: barBounds.width,
      height: barBounds.height,
      show: false,
      backgroundColor: APP_DARK_BACKGROUND,
      alwaysOnTop: true,
      frame: false,
      transparent: false,
      skipTaskbar: false,
      resizable: false,
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
      if (input.type !== 'keyDown') return

      const action = getTerminalDockWindowCloseShortcutAction({
        role: 'float-bar',
        floatMode: dockSyncState.floatMode,
        key: input.key,
        metaKey: input.meta,
        ctrlKey: input.control,
        altKey: input.alt,
        shiftKey: input.shift,
      })

      if (action === 'prevent') {
        event.preventDefault()
      }
    })

    dockWindow.once('ready-to-show', () => {
      if (dockSyncState.barVisible && !dockWindow.isDestroyed()) {
        dockWindow.show()
      }
    })

    dockWindow.on('closed', () => {
      if (floatDockWindow !== dockWindow) return
      floatDockWindow = null
      if (dockSyncState.barVisible) {
        dockSyncState = {
          ...dockSyncState,
          barVisible: false,
        }
      }
      syncDockState()
    })

    loadRenderer(dockWindow, { mode: 'terminal-dock', role: 'float-bar' })
    return dockWindow
  }

  const ensureTerminalWindowVisible = (bounds?: DockWindowBounds | null): BrowserWindow => {
    if (!terminalDockWindow || terminalDockWindow.isDestroyed()) {
      terminalDockWindow = createTerminalDockWindow()
    }

    if (bounds) {
      terminalDockWindow.setBounds(bounds)
      persistTerminalBounds(bounds)
    } else {
      const currentBounds = getTargetTerminalBoundsForState()
      if (currentBounds) {
        terminalDockWindow.setBounds(currentBounds)
      }
    }

    const terminalAlwaysOnTopLevel = getTerminalDockAlwaysOnTopLevel({
      role: 'terminal-window',
      floatMode: dockSyncState.floatMode,
    })
    if (terminalAlwaysOnTopLevel) {
      terminalDockWindow.setAlwaysOnTop(true, terminalAlwaysOnTopLevel)
    } else {
      terminalDockWindow.setAlwaysOnTop(false)
    }
    terminalDockWindow.setResizable(true)
    terminalDockWindow.show()
    terminalDockWindow.focus()
    return terminalDockWindow
  }

  const ensureBarWindowVisible = (bounds?: DockWindowBounds | null): BrowserWindow => {
    if (!floatDockWindow || floatDockWindow.isDestroyed()) {
      floatDockWindow = createFloatDockWindow()
    }

    const nextBounds =
      bounds ??
      (dockSyncState.floatMode ? getPairedBarBounds(getCurrentTerminalBounds()) : getStandaloneBarBounds())
    floatDockWindow.setBounds(nextBounds)
    const barAlwaysOnTopLevel =
      getTerminalDockAlwaysOnTopLevel({
        role: 'float-bar',
        floatMode: dockSyncState.floatMode,
      }) || 'pop-up-menu'
    floatDockWindow.setAlwaysOnTop(true, barAlwaysOnTopLevel)
    floatDockWindow.setResizable(false)
    if (!floatDockWindow.isVisible()) {
      if (dockSyncState.terminalVisible && typeof floatDockWindow.showInactive === 'function') {
        floatDockWindow.showInactive()
      } else {
        floatDockWindow.show()
      }
    }
    return floatDockWindow
  }

  const closeTerminalWindow = (): void => {
    if (terminalDockWindow && !terminalDockWindow.isDestroyed()) {
      persistTerminalBounds(toDockBounds(terminalDockWindow.getBounds()))
      terminalDockWindow.close()
    }
  }

  const closeBarWindow = (): void => {
    if (floatDockWindow && !floatDockWindow.isDestroyed()) {
      floatDockWindow.close()
    }
  }

  const updateWindowVisibility = (): void => {
    if (dockSyncState.terminalVisible) {
      const nextTerminalBounds =
        terminalDockWindow && !terminalDockWindow.isDestroyed()
          ? toDockBounds(terminalDockWindow.getBounds())
          : getTargetTerminalBoundsForState()
      ensureTerminalWindowVisible(nextTerminalBounds)
    } else {
      closeTerminalWindow()
    }

    if (dockSyncState.barVisible) {
      const nextBarBounds = dockSyncState.floatMode
        ? floatDockWindow && !floatDockWindow.isDestroyed()
          ? getStandaloneBarBounds(toDockBounds(floatDockWindow.getBounds()))
          : getPairedBarBounds(getCurrentTerminalBounds())
        : getStandaloneBarBounds(getCurrentTerminalBounds())
      ensureBarWindowVisible(nextBarBounds)
    } else {
      closeBarWindow()
    }
  }

  const showTerminalDock = (args?: { characterId?: string }): void => {
    if (args?.characterId) {
      updateDockLayout(ensureCharacterSurface(dockSyncState.layout, args.characterId))
    }

    const previousTerminalBounds = getCurrentTerminalBounds()

    dockSyncState = {
      ...dockSyncState,
      terminalVisible: true,
      barVisible: dockSyncState.floatMode ? true : false,
    }

    if (dockSyncState.floatMode) {
      const terminalBounds = previousTerminalBounds ?? savedTerminalBounds
      if (terminalBounds) {
        persistTerminalBounds(terminalBounds)
      }
    }

    updateWindowVisibility()
    syncDockState()
  }

  const setFloatMode = (enabled: boolean): void => {
    if (dockSyncState.floatMode === enabled) return

    const terminalBounds = getCurrentTerminalBounds()
    if (terminalBounds) {
      persistTerminalBounds(terminalBounds)
    }

    dockSyncState = {
      ...dockSyncState,
      floatMode: enabled,
      barVisible: enabled ? dockSyncState.terminalVisible || dockSyncState.barVisible : false,
    }

    if (enabled && savedTerminalBounds) {
      savedFloatTerminalBounds = getFloatTerminalBoundsFromBaseBounds(savedTerminalBounds)
    }

    updateWindowVisibility()
    syncDockState()
  }

  ipcMain.handle(IPC_COMMANDS.TERMINAL_DOCK_GET_STATE, () => dockSyncState)

  ipcMain.handle(IPC_COMMANDS.TERMINAL_DOCK_SHOW, (_, args?: { characterId?: string }) => {
    showTerminalDock(args)
  })

  ipcMain.handle(IPC_COMMANDS.MAIN_WINDOW_SHOW, () => {
    ensureMainWindowVisible()
  })

  ipcMain.handle(IPC_COMMANDS.TERMINAL_DOCK_HIDE, () => {
    const shouldReopenMain = !dockSyncState.floatMode && (!mainWindow || mainWindow.isDestroyed())
    dockSyncState = {
      ...dockSyncState,
      terminalVisible: false,
      barVisible: dockSyncState.floatMode ? dockSyncState.barVisible : false,
    }
    updateWindowVisibility()
    syncDockState()
    if (shouldReopenMain) {
      ensureMainWindowVisible()
    }
  })

  ipcMain.handle(IPC_COMMANDS.TERMINAL_DOCK_SET_LAYOUT, (_, state: {
    layout: DockLayout
    focusedPaneId: string
    activeCharacterId: string | null
  }) => {
    dockSyncState = {
      ...dockSyncState,
      layout: state.layout,
      focusedPaneId: state.focusedPaneId,
      activeCharacterId: state.activeCharacterId,
    }

    if (dockSyncState.barVisible) {
      updateWindowVisibility()
    }
    syncDockState()
  })

  ipcMain.handle(IPC_COMMANDS.TERMINAL_DOCK_SET_FLOAT_MODE, (_, args: { enabled: boolean }) => {
    setFloatMode(Boolean(args?.enabled))
  })

  ipcMain.handle(IPC_COMMANDS.TERMINAL_DOCK_SET_BAR_HEIGHT, (_, args: { height: number }) => {
    savedDockBarHeight = clampTerminalDockBarHeight(args.height)
    if (dockSyncState.barVisible) {
      updateWindowVisibility()
    }
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
