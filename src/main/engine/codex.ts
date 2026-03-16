import { execSync } from 'child_process'
import type { EngineAdapter, EngineSpawnOptions, CLIDetectionResult } from './types'

export const codexAdapter: EngineAdapter = {
  name: 'codex',
  cliCommand: 'codex',

  buildSpawnArgs(options: EngineSpawnOptions): string[] {
    const args: string[] = []
    if (options.sessionId) {
      args.push('resume', options.sessionId)
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
    const path = execSync('which codex', { encoding: 'utf-8' }).trim()
    let version: string | undefined
    try {
      version = execSync('codex --version', { encoding: 'utf-8' }).trim()
    } catch {
      // version detection is optional
    }
    return { found: true, path, version }
  } catch {
    return { found: false, path: null }
  }
}
