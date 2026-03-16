import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright'

const appDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')
const tempHome = path.join(os.tmpdir(), 'agito-terminal-playwright')
const screenshotDir = path.join(tempHome, 'screenshots')
const electronBinary = path.join(
  appDir,
  'node_modules/.pnpm/electron@33.4.11/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
)
await fs.rm(tempHome, { recursive: true, force: true })
await fs.mkdir(screenshotDir, { recursive: true })

const channels = {
  characterCreate: 'character:create',
  characterUpdate: 'character:update',
  ptySpawn: 'pty:spawn',
  dockSetActiveCharacter: 'terminal-dock:set-active-character',
  dockDetach: 'terminal-dock:detach',
}

const electronApp = await electron.launch({
  executablePath: electronBinary,
  args: ['.'],
  cwd: appDir,
  env: {
    ...process.env,
    AGITO_HOME: tempHome,
  },
})

let detachedWindow
let characterIds

try {
  const mainWindow = await electronApp.firstWindow()
  await mainWindow.waitForLoadState('domcontentloaded')

  characterIds = await mainWindow.evaluate(async ({ channels, cwd }) => {
    const createCharacter = async (name) => {
      const created = await window.api.invoke(channels.characterCreate, {
        name,
        engine: 'codex',
      })
      await window.api.invoke(channels.characterUpdate, created.id, {
        currentSessionId: `${name}-session`,
        status: 'working',
      })
      return created.id
    }

    const alphaId = await createCharacter('pw-alpha')
    const betaId = await createCharacter('pw-beta')

    await window.api.invoke(channels.ptySpawn, alphaId, {
      command: '/bin/zsh',
      args: ['-lc', 'printf "alpha-ready\\n"; while true; do printf "alpha-heartbeat\\n"; sleep 1; done'],
      cwd,
    })
    await window.api.invoke(channels.ptySpawn, betaId, {
      command: '/bin/zsh',
      args: ['-lc', 'printf "beta-ready\\n"; while true; do printf "beta-heartbeat\\n"; sleep 1; done'],
      cwd,
    })

    return { alphaId, betaId }
  }, { channels, cwd: appDir })

  const now = new Date().toISOString()
  await fs.writeFile(
    path.join(tempHome, 'sessions.json'),
    JSON.stringify([
      {
        characterId: characterIds.alphaId,
        sessionId: 'pw-alpha-session',
        engineType: 'codex',
        workingDirectory: appDir,
        createdAt: now,
        lastActiveAt: now,
      },
      {
        characterId: characterIds.betaId,
        sessionId: 'pw-beta-session',
        engineType: 'codex',
        workingDirectory: appDir,
        createdAt: now,
        lastActiveAt: now,
      },
    ], null, 2)
  )

  await mainWindow.waitForTimeout(500)
  await mainWindow.evaluate(async ({ channels, alphaId }) => {
    await window.api.invoke(channels.dockSetActiveCharacter, alphaId)
    await window.api.invoke(channels.dockDetach, {
      activeCharacterId: alphaId,
      width: 900,
      height: 640,
    })
  }, { channels, alphaId: characterIds.alphaId })

  detachedWindow = await electronApp.waitForEvent('window')
  await detachedWindow.waitForLoadState('domcontentloaded')
  await detachedWindow.getByText('pw-alpha').waitFor({ timeout: 10000 })
  await detachedWindow.screenshot({ path: path.join(screenshotDir, 'detached-before-wait.png') })
  await detachedWindow.waitForFunction(
    () => {
      const text = document.body.innerText
      const xtermText = document.querySelector('.xterm')?.textContent ?? ''
      return text.includes('alpha-ready') || text.includes('alpha-heartbeat') || xtermText.includes('alpha-ready') || xtermText.includes('alpha-heartbeat')
    },
    undefined,
    { timeout: 15000 }
  )
  await detachedWindow.screenshot({ path: path.join(screenshotDir, 'detached-alpha.png') })

  await detachedWindow.getByText('pw-beta').click()
  await detachedWindow.waitForFunction(
    () => {
      const text = document.body.innerText
      const xtermText = document.querySelector('.xterm')?.textContent ?? ''
      return text.includes('beta-ready') || text.includes('beta-heartbeat') || xtermText.includes('beta-ready') || xtermText.includes('beta-heartbeat')
    },
    undefined,
    { timeout: 15000 }
  )
  await detachedWindow.screenshot({ path: path.join(screenshotDir, 'detached-beta.png') })

  console.log(JSON.stringify({
    ok: true,
    tempHome,
    screenshotDir,
    characters: characterIds,
  }, null, 2))
} catch (error) {
  let diagnostics = null
  if (detachedWindow) {
    try {
      diagnostics = await detachedWindow.evaluate(() => {
        const xterm = document.querySelector('.xterm')
        const container = document.querySelector('[style*="visibility"]')
        return {
          bodyText: document.body.innerText,
          xtermText: xterm?.textContent ?? null,
          xtermHtml: xterm?.outerHTML?.slice(0, 1500) ?? null,
          spinnerVisible: document.body.innerText.includes('Loading session...'),
          containerVisibility: container ? getComputedStyle(container).visibility : null,
        }
      })
    } catch {
      diagnostics = { error: 'failed-to-read-window-diagnostics' }
    }
  }
  if (characterIds) {
    try {
      const sessionDiagnostics = await electronApp.firstWindow().then((page) => page.evaluate(async ({ alphaId, betaId }) => {
        const store = await window.api.invoke('store:read')
        return {
          alphaAlive: await window.api.invoke('pty:is-alive', alphaId),
          betaAlive: await window.api.invoke('pty:is-alive', betaId),
          characters: store.characters
            .filter((character) => character.id === alphaId || character.id === betaId)
            .map((character) => ({
              id: character.id,
              name: character.name,
              currentSessionId: character.currentSessionId,
              status: character.status,
            })),
        }
      }, characterIds))
      diagnostics = { ...diagnostics, sessionDiagnostics }
    } catch {
      diagnostics = { ...diagnostics, sessionDiagnostics: { error: 'failed-to-read-session-diagnostics' } }
    }
  }
  console.error(JSON.stringify({
    ok: false,
    tempHome,
    screenshotDir,
    diagnostics,
    error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
  }, null, 2))
  throw error
} finally {
  await electronApp.close()
}
