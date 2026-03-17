import { closeSync, openSync, readSync, readdirSync, statSync } from 'fs'
import { basename } from 'path'
import { join } from 'path'
import type { ScannedSession } from '../shared/types'

const CLAUDE_SESSION_SCAN_MAX_LINES = 32
const CLAUDE_SESSION_SCAN_MAX_BYTES = 64 * 1024
const CODEX_SESSION_SCAN_MAX_LINES = 32

export interface ClaudeSessionMetadata {
  sessionId: string
  cwd: string | null
  gitBranch: string | null
  timestamp: string | null
}

export function readFileHead(filePath: string, maxBytes = CLAUDE_SESSION_SCAN_MAX_BYTES): string {
  const fd = openSync(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(maxBytes)
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0)
    return buffer.subarray(0, bytesRead).toString('utf-8')
  } finally {
    closeSync(fd)
  }
}

export function extractClaudeSessionMetadataFromHead(
  head: string,
  maxLines = CLAUDE_SESSION_SCAN_MAX_LINES
): ClaudeSessionMetadata | null {
  let sessionId: string | null = null
  let cwd: string | null = null
  let gitBranch: string | null = null
  let timestamp: string | null = null

  const lines = head.split('\n')
  for (let index = 0; index < lines.length && index < maxLines; index += 1) {
    const line = lines[index]?.trim()
    if (!line) continue

    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (!sessionId && typeof parsed.sessionId === 'string' && parsed.sessionId.length > 0) {
        sessionId = parsed.sessionId
      }
      if (!cwd && typeof parsed.cwd === 'string' && parsed.cwd.length > 0) {
        cwd = parsed.cwd
      }
      if (!gitBranch && typeof parsed.gitBranch === 'string' && parsed.gitBranch.length > 0) {
        gitBranch = parsed.gitBranch
      }
      if (!timestamp && typeof parsed.timestamp === 'string' && parsed.timestamp.length > 0) {
        timestamp = parsed.timestamp
      }
    } catch {
      // Ignore unparseable lines while scanning the bounded session head.
    }
  }

  if (!sessionId) return null

  return {
    sessionId,
    cwd,
    gitBranch,
    timestamp,
  }
}

export function extractClaudeSessionMetadata(filePath: string): ClaudeSessionMetadata | null {
  const head = readFileHead(filePath)
  return extractClaudeSessionMetadataFromHead(head)
}

function normalizeClaudeHistoryDisplay(display: unknown): string | null {
  if (typeof display !== 'string') return null
  const normalized = display.replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  if (normalized.toLowerCase() === 'session') return null
  return normalized
}

export function extractClaudeSessionLabelsFromHistory(history: string): Map<string, string> {
  const labels = new Map<string, { label: string; timestamp: number }>()

  for (const line of history.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : null
      const label = normalizeClaudeHistoryDisplay(parsed.display)
      if (!sessionId || !label) continue

      const timestampValue = parsed.timestamp
      const timestamp =
        typeof timestampValue === 'number'
          ? timestampValue
          : Number.isFinite(Number(timestampValue))
            ? Number(timestampValue)
            : 0
      const existing = labels.get(sessionId)
      if (!existing || timestamp >= existing.timestamp) {
        labels.set(sessionId, { label, timestamp })
      }
    } catch {
      // Ignore malformed history rows.
    }
  }

  return new Map(Array.from(labels.entries(), ([sessionId, entry]) => [sessionId, entry.label]))
}

export function getPreferredClaudeSessionLabel(input: {
  historyLabel: string | null
  gitBranch: string | null
  workingDirectory: string
}): string {
  if (input.historyLabel) return input.historyLabel

  const normalizedBranch = input.gitBranch?.trim()
  if (normalizedBranch && normalizedBranch.toUpperCase() !== 'HEAD') {
    return normalizedBranch
  }

  return basename(input.workingDirectory)
}

export interface CodexSessionMetadata {
  sessionId: string
  cwd: string | null
  timestamp: string | null
  originator: string | null
  source: string | null
  userMessageLabel: string | null
}

export interface CodexSessionIndexEntry {
  sessionId: string
  threadName: string | null
  cwd: string | null
  updatedAt: string | null
}

function normalizeCodexUserMessageLabel(message: unknown): string | null {
  if (typeof message !== 'string') return null
  const normalized = message.replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized
}

function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8)
}

export function extractCodexSessionMetadataFromHead(
  head: string,
  maxLines = CODEX_SESSION_SCAN_MAX_LINES
): CodexSessionMetadata | null {
  let sessionId: string | null = null
  let cwd: string | null = null
  let timestamp: string | null = null
  let originator: string | null = null
  let source: string | null = null
  let userMessageLabel: string | null = null

  const lines = head.split('\n')
  for (let index = 0; index < lines.length && index < maxLines; index += 1) {
    const line = lines[index]?.trim()
    if (!line) continue

    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      const type = parsed.type
      const payload = typeof parsed.payload === 'object' && parsed.payload !== null
        ? parsed.payload as Record<string, unknown>
        : null

      if (type === 'session_meta' && payload) {
        if (!sessionId && typeof payload.id === 'string' && payload.id.length > 0) {
          sessionId = payload.id
        }
        if (!cwd && typeof payload.cwd === 'string' && payload.cwd.length > 0) {
          cwd = payload.cwd
        }
        if (!timestamp && typeof payload.timestamp === 'string' && payload.timestamp.length > 0) {
          timestamp = payload.timestamp
        }
        if (!originator && typeof payload.originator === 'string' && payload.originator.length > 0) {
          originator = payload.originator
        }
        if (!source && typeof payload.source === 'string' && payload.source.length > 0) {
          source = payload.source
        }
      }

      if (!userMessageLabel && type === 'event_msg' && payload?.type === 'user_message') {
        userMessageLabel = normalizeCodexUserMessageLabel(payload.message)
      }
    } catch {
      // Ignore malformed Codex session rows while scanning the bounded head.
    }
  }

  if (!sessionId) return null

  return {
    sessionId,
    cwd,
    timestamp,
    originator,
    source,
    userMessageLabel,
  }
}

export function extractCodexSessionIndexEntries(content: string): Map<string, CodexSessionIndexEntry> {
  const entries = new Map<string, CodexSessionIndexEntry>()

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      const sessionId = typeof parsed.id === 'string' ? parsed.id : null
      if (!sessionId) continue
      entries.set(sessionId, {
        sessionId,
        threadName: typeof parsed.thread_name === 'string' ? parsed.thread_name : null,
        cwd: typeof parsed.cwd === 'string' ? parsed.cwd : null,
        updatedAt: typeof parsed.updated_at === 'string' ? parsed.updated_at : null,
      })
    } catch {
      // Ignore malformed index rows.
    }
  }

  return entries
}

export function getPreferredCodexSessionLabel(input: {
  sqliteTitle: string | null
  indexLabel: string | null
  userMessageLabel: string | null
  workingDirectory: string | null
  sessionId: string
}): string {
  if (input.sqliteTitle?.trim()) return input.sqliteTitle.trim()
  if (input.indexLabel?.trim()) return input.indexLabel.trim()
  if (input.userMessageLabel) return input.userMessageLabel
  if (input.workingDirectory?.trim()) return basename(input.workingDirectory.trim())
  return shortSessionId(input.sessionId)
}

export function scanCodexSessionFiles(
  sessionsRoot: string,
  indexEntries: Map<string, CodexSessionIndexEntry>
): ScannedSession[] {
  const files: string[] = []
  const stack = [sessionsRoot]

  while (stack.length > 0) {
    const dirPath = stack.pop()
    if (!dirPath) continue

    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      const fullPath = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(fullPath)
      }
    }
  }

  const sessions: Array<ScannedSession | null> = files.map((filePath) => {
    const metadata = extractCodexSessionMetadataFromHead(readFileHead(filePath))
    if (!metadata) return null

    const stat = statSync(filePath)
    const indexEntry = indexEntries.get(metadata.sessionId)
    const workingDirectory = metadata.cwd ?? indexEntry?.cwd ?? ''

    return {
      sessionId: metadata.sessionId,
      engineType: 'codex' as const,
      workingDirectory,
      label: getPreferredCodexSessionLabel({
        sqliteTitle: null,
        indexLabel: indexEntry?.threadName ?? null,
        userMessageLabel: metadata.userMessageLabel,
        workingDirectory,
        sessionId: metadata.sessionId,
      }),
      createdAt: metadata.timestamp ?? indexEntry?.updatedAt ?? stat.birthtime.toISOString(),
      lastActiveAt: stat.mtime.toISOString(),
    }
  })

  return sessions.filter((session): session is ScannedSession => session !== null)
}

export function mergeCodexScannedSessions(input: {
  sqliteSessions: ScannedSession[]
  fileSessions: ScannedSession[]
  indexSessions: ScannedSession[]
}): ScannedSession[] {
  const merged = new Map<string, ScannedSession>()

  for (const session of input.sqliteSessions) {
    merged.set(session.sessionId, session)
  }

  for (const session of input.fileSessions) {
    if (!merged.has(session.sessionId)) {
      merged.set(session.sessionId, session)
    }
  }

  if (merged.size === 0) {
    for (const session of input.indexSessions) {
      merged.set(session.sessionId, session)
    }
  }

  return Array.from(merged.values())
}
