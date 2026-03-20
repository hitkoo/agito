export const GENERATED_PREVIEW_RETRY_COOLDOWN_MS = 3_000

export function shouldRequestGeneratedPreview(args: {
  url: string | null | undefined
  isLoading: boolean
  failedAt: number | null | undefined
  now: number
  retryCooldownMs?: number
}): boolean {
  if (args.url || args.isLoading) {
    return false
  }
  if (args.failedAt == null) {
    return true
  }
  return args.now - args.failedAt >= (args.retryCooldownMs ?? GENERATED_PREVIEW_RETRY_COOLDOWN_MS)
}
