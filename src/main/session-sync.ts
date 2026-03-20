import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'

const UUID_REGEX =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i
const UUID_REGEX_GLOBAL =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/ig

export function createUuidV7(): string {
  const bytes = randomBytes(16)
  let timestamp = BigInt(Date.now())

  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn)
    timestamp >>= 8n
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export function parseSessionIdFromStatusOutput(output: string): string | null {
  const match = output.match(UUID_REGEX)
  return match?.[0] ?? null
}

export function parseLastSessionIdFromStatusOutput(output: string): string | null {
  const matches = Array.from(output.matchAll(UUID_REGEX_GLOBAL))
  return matches.at(-1)?.[0] ?? null
}

export function findClaudeSessionArtifactPath(
  homeDirectory: string,
  sessionId: string
): string | null {
  const projectRoot = join(homeDirectory, '.claude', 'projects')
  if (!existsSync(projectRoot)) return null

  for (const entry of readdirSync(projectRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const candidatePath = join(projectRoot, entry.name, `${sessionId}.jsonl`)
    if (existsSync(candidatePath)) return candidatePath
  }

  return null
}

export function findCodexSessionArtifactPath(
  homeDirectory: string,
  sessionId: string
): string | null {
  const roots = [
    join(homeDirectory, '.codex', 'sessions'),
    join(homeDirectory, '.codex', 'archived_sessions'),
  ]

  for (const root of roots) {
    const match = findCodexSessionArtifactPathRecursive(root, sessionId)
    if (match) return match
  }

  return null
}

function findCodexSessionArtifactPathRecursive(
  root: string,
  sessionId: string
): string | null {
  if (!existsSync(root)) return null

  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const nextPath = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(nextPath)
        continue
      }

      if (
        entry.isFile() &&
        entry.name.endsWith('.jsonl') &&
        entry.name.includes(sessionId)
      ) {
        return nextPath
      }
    }
  }

  return null
}
