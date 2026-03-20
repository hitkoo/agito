export interface EngineAdapter {
  readonly name: string
  readonly cliCommand: string
  buildSpawnArgs(options: EngineSpawnOptions): string[]
  detectCLI(): Promise<CLIDetectionResult>
}

export interface EngineSpawnOptions {
  sessionId?: string
  startSessionId?: string
  soulPath?: string
  workingDirectory: string
  additionalArgs?: string[]
}

export interface CLIDetectionResult {
  found: boolean
  path: string | null
  version?: string
}
