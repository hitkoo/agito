export interface ApiRequestErrorShape {
  status: number
  code?: string
  message: string
  detail: unknown
}

export class ApiRequestError extends Error {
  readonly status: number
  readonly code?: string
  readonly detail: unknown

  constructor(args: ApiRequestErrorShape) {
    super(args.message)
    this.name = 'ApiRequestError'
    this.status = args.status
    this.code = args.code
    this.detail = args.detail
  }
}

function buildMessage(status: number, detail: unknown): string {
  if (detail && typeof detail === 'object') {
    const code = typeof (detail as { code?: unknown }).code === 'string'
      ? (detail as { code: string }).code
      : undefined
    if (code === 'insufficient_credits') {
      const required = typeof (detail as { required_credits?: unknown }).required_credits === 'number'
        ? (detail as { required_credits: number }).required_credits
        : undefined
      const remaining = typeof (detail as { remaining_credits?: unknown }).remaining_credits === 'number'
        ? (detail as { remaining_credits: number }).remaining_credits
        : undefined
      if (typeof required === 'number' && typeof remaining === 'number') {
        return `Need ${required} Gito. Current balance is ${remaining} Gito.`
      }
      return 'Not enough Gito to continue.'
    }
  }

  if (typeof detail === 'string' && detail.trim()) {
    return detail
  }

  return `Request failed: ${status}`
}

export async function normalizeApiError(response: Response): Promise<ApiRequestError> {
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    try {
      payload = await response.text()
    } catch {
      payload = null
    }
  }

  const detail = payload && typeof payload === 'object' && 'detail' in (payload as Record<string, unknown>)
    ? (payload as { detail?: unknown }).detail
    : payload

  const code = detail && typeof detail === 'object' && typeof (detail as { code?: unknown }).code === 'string'
    ? (detail as { code: string }).code
    : undefined

  return new ApiRequestError({
    status: response.status,
    code,
    message: buildMessage(response.status, detail),
    detail,
  })
}
