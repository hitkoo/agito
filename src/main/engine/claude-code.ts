import { execSync } from 'child_process'
import type { EngineAdapter, EngineSpawnOptions, CLIDetectionResult } from './types'

export const claudeCodeAdapter: EngineAdapter = {
  name: 'claude-code',
  cliCommand: 'claude',

  buildSpawnArgs(options: EngineSpawnOptions): string[] {
    const args: string[] = []
    if (options.startSessionId) {
      args.push('--session-id', options.startSessionId)
    } else if (options.sessionId) {
      args.push('--resume', options.sessionId)
    }
    if (options.soulPath) {
      args.push('--append-system-prompt', options.soulPath)
    }
    if (options.additionalArgs) {
      args.push(...options.additionalArgs)
    }
    return args
  },

  detectCLI,
}

export async function detectCLI(): Promise<CLIDetectionResult> {
  try {
    const path = execSync('which claude', { encoding: 'utf-8' }).trim()
    let version: string | undefined
    try {
      version = execSync('claude --version', { encoding: 'utf-8' }).trim()
    } catch {
      // version detection is optional
    }
    return { found: true, path, version }
  } catch {
    return { found: false, path: null }
  }
}
