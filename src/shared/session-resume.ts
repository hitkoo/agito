import type { EngineType, SessionMapping } from './types'

export interface SessionResumeInvokeArgs {
  characterId: string
  sessionId: string
  workingDirectory?: string
  engineType?: EngineType
}

export function buildSessionResumeInvokeArgs(args: {
  characterId: string
  sessionId: string
  sessions: SessionMapping[]
}): SessionResumeInvokeArgs {
  const { characterId, sessionId, sessions } = args
  const mapping = sessions.find((session) => session.sessionId === sessionId)

  if (!mapping) {
    return { characterId, sessionId }
  }

  return {
    characterId,
    sessionId,
    workingDirectory: mapping.workingDirectory,
    engineType: mapping.engineType,
  }
}

export function upsertSessionMappingOnResume(args: {
  sessions: SessionMapping[]
  characterId: string
  sessionId: string
  workingDirectory: string
  engineType: EngineType
  now: string
  overwriteExistingMetadata: boolean
}): SessionMapping[] {
  const {
    sessions,
    characterId,
    sessionId,
    workingDirectory,
    engineType,
    now,
    overwriteExistingMetadata,
  } = args

  const existingIndex = sessions.findIndex((session) => session.sessionId === sessionId)
  if (existingIndex === -1) {
    return [
      ...sessions,
      {
        characterId,
        sessionId,
        engineType,
        workingDirectory,
        createdAt: now,
        lastActiveAt: now,
      },
    ]
  }

  return sessions.map((session, index) => {
    if (index !== existingIndex) return session

    if (!overwriteExistingMetadata) {
      return {
        ...session,
        lastActiveAt: now,
      }
    }

    return {
      ...session,
      characterId,
      engineType,
      workingDirectory,
      lastActiveAt: now,
    }
  })
}
