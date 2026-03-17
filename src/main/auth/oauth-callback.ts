export interface OAuthCallbackPayload {
  query: Record<string, string>
}

export function buildGoogleOAuthRedirectTarget(args: {
  isPackaged: boolean
  localhostCallbackBaseUrl: string
  protocolScheme: string
}): string {
  if (args.isPackaged) {
    return `${args.protocolScheme}://auth/callback`
  }
  return `${args.localhostCallbackBaseUrl}/callback`
}

export class DeepLinkOAuthCallbackCoordinator {
  private pendingResolver: ((payload: OAuthCallbackPayload) => void) | null = null
  private pendingRejecter: ((error: Error) => void) | null = null

  constructor(private readonly protocolScheme: string) {}

  waitForCallback(): Promise<OAuthCallbackPayload> {
    if (this.pendingResolver) {
      throw new Error('OAuth callback is already pending')
    }

    return new Promise((resolve, reject) => {
      this.pendingResolver = resolve
      this.pendingRejecter = reject
    })
  }

  handleOpenUrl(rawUrl: string): boolean {
    const parsed = new URL(rawUrl)
    const normalizedProtocol = parsed.protocol.replace(/:$/, '')
    const normalizedPath = parsed.pathname.replace(/\/+$/, '')
    if (normalizedProtocol !== this.protocolScheme) return false
    if (!(parsed.host === 'auth' && normalizedPath === '/callback')) return false

    const query: Record<string, string> = {}
    parsed.searchParams.forEach((value, key) => {
      query[key] = value
    })

    this.pendingResolver?.({ query })
    this.pendingResolver = null
    this.pendingRejecter = null
    return true
  }

  rejectPending(error: Error): void {
    this.pendingRejecter?.(error)
    this.pendingResolver = null
    this.pendingRejecter = null
  }
}
