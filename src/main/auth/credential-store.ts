import keytar from 'keytar'
import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { dirname, join } from 'path'
import type { AuthUserProfile } from '../../shared/auth'
import type { CredentialStore } from './auth-service'

const AUTH_FILE_MAGIC = 'AGITO_AUTH_V1'
const KEYTAR_SERVICE = 'Agito'
const KEYTAR_ACCOUNT = 'supabase-session'
const AUTH_FILE_NAME = 'auth-session.bin'

export interface StoredAuthSession {
  accessToken: string
  refreshToken: string
  expiresAt: number | null
  profile: AuthUserProfile
}

interface SerializedAuthSession extends StoredAuthSession {
  version: 1
}

function serializeSession(session: StoredAuthSession): string {
  return JSON.stringify({
    version: 1,
    ...session,
  } satisfies SerializedAuthSession)
}

function deserializeSession(raw: string): StoredAuthSession {
  const parsed = JSON.parse(raw) as SerializedAuthSession
  if (parsed.version !== 1) {
    throw new Error(`Unsupported auth session version: ${parsed.version}`)
  }

  return {
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
    expiresAt: parsed.expiresAt,
    profile: parsed.profile,
  }
}

export class KeytarCredentialStore implements CredentialStore<StoredAuthSession> {
  async getSession(): Promise<StoredAuthSession | null> {
    try {
      const raw = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT)
      return raw ? deserializeSession(raw) : null
    } catch {
      return null
    }
  }

  async setSession(session: StoredAuthSession): Promise<void> {
    await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, serializeSession(session))
  }

  async clearSession(): Promise<void> {
    await keytar.deletePassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT)
  }
}

export class EncryptedFileCredentialStore implements CredentialStore<StoredAuthSession> {
  private readonly filePath: string

  constructor(basePath: string) {
    this.filePath = join(basePath, AUTH_FILE_NAME)
  }

  async getSession(): Promise<StoredAuthSession | null> {
    if (!existsSync(this.filePath)) return null

    const raw = readFileSync(this.filePath)
    const delimiterIndex = raw.indexOf(0x0a)
    if (delimiterIndex === -1) return null

    const magic = raw.subarray(0, delimiterIndex).toString('utf8')
    const payload = raw.subarray(delimiterIndex + 1)

    try {
      const json =
        magic === AUTH_FILE_MAGIC && safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(payload)
          : payload.toString('utf8')
      return deserializeSession(json)
    } catch {
      return null
    }
  }

  async setSession(session: StoredAuthSession): Promise<void> {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const json = serializeSession(session)
    const payload = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(json)
      : Buffer.from(json, 'utf8')
    const fileData = Buffer.concat([
      Buffer.from(`${AUTH_FILE_MAGIC}\n`, 'utf8'),
      payload,
    ])
    writeFileSync(this.filePath, fileData)
  }

  async clearSession(): Promise<void> {
    if (existsSync(this.filePath)) {
      unlinkSync(this.filePath)
    }
  }
}

export class LayeredCredentialStore implements CredentialStore<StoredAuthSession> {
  constructor(
    private readonly primary: CredentialStore<StoredAuthSession>,
    private readonly fallback: CredentialStore<StoredAuthSession>
  ) {}

  async getSession(): Promise<StoredAuthSession | null> {
    const primarySession = await this.primary.getSession()
    if (primarySession) return primarySession

    const fallbackSession = await this.fallback.getSession()
    if (fallbackSession) {
      try {
        await this.primary.setSession(fallbackSession)
      } catch {
        // Ignore migration failures and keep using the fallback session.
      }
    }
    return fallbackSession
  }

  async setSession(session: StoredAuthSession): Promise<void> {
    try {
      await this.primary.setSession(session)
      await this.fallback.clearSession()
      return
    } catch {
      await this.fallback.setSession(session)
    }
  }

  async clearSession(): Promise<void> {
    await Promise.allSettled([
      this.primary.clearSession(),
      this.fallback.clearSession(),
    ])
  }
}

export function createCredentialStore(basePath: string): CredentialStore<StoredAuthSession> {
  return new LayeredCredentialStore(
    new KeytarCredentialStore(),
    new EncryptedFileCredentialStore(basePath)
  )
}
