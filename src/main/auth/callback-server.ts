import { createServer, type Server } from 'http'
import { URL } from 'url'

export interface CallbackPayload {
  query: Record<string, string>
}

export interface CallbackServer {
  promise: Promise<CallbackPayload>
  url: string
  close: () => void
}

const START_PORT = 46771
const MAX_PORT_ATTEMPTS = 25

function tryBind(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
}

export async function createCallbackServer(): Promise<CallbackServer> {
  let resolvePromise: ((payload: CallbackPayload) => void) | null = null
  let rejectPromise: ((error: Error) => void) | null = null
  let activeServer: Server | null = null
  let activePort: number | null = null

  const promise = new Promise<CallbackPayload>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  const requestHandler = (req: import('http').IncomingMessage, res: import('http').ServerResponse): void => {
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${activePort ?? START_PORT}`)

      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Not found')
        return
      }

      const query: Record<string, string> = {}
      url.searchParams.forEach((value, key) => {
        query[key] = value
      })

      const success = Boolean(query.code) && !query.error

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        success
          ? '<html><body style="font-family: sans-serif; padding: 24px;">Authentication complete. You can return to Agito.</body></html>'
          : `<html><body style="font-family: sans-serif; padding: 24px;">Authentication failed: ${query.error_description ?? query.error ?? 'Unknown error'}</body></html>`
      )

      resolvePromise?.({ query })
    } catch (error) {
      rejectPromise?.(error instanceof Error ? error : new Error(String(error)))
    } finally {
      activeServer?.close()
      activeServer = null
    }
  }

  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const port = START_PORT + offset
    const server = createServer(requestHandler)
    try {
      await tryBind(server, port)
      activeServer = server
      activePort = port
      break
    } catch (error) {
      server.close()
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code !== 'EADDRINUSE') {
        throw error
      }
    }
  }

  if (!activeServer || !activePort) {
    throw new Error(`No OAuth callback port available in range ${START_PORT}-${START_PORT + MAX_PORT_ATTEMPTS - 1}`)
  }

  activeServer.on('error', (error) => {
    rejectPromise?.(error instanceof Error ? error : new Error(String(error)))
  })

  return {
    promise,
    url: `http://127.0.0.1:${activePort}`,
    close: () => {
      activeServer?.close()
      activeServer = null
    },
  }
}
