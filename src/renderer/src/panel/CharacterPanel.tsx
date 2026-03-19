import { type ReactElement, useEffect, useState, useCallback } from 'react'
import { useCharacterStore } from '../stores/character-store'
import { useRuntimeStore } from '../stores/runtime-store'
import { useUIStore } from '../stores/ui-store'
import { TerminalView } from './TerminalView'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import { getCharacterMarkerStatus } from '../../../shared/character-runtime-state'
import { Button } from '../components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '../components/ui/dropdown-menu'

const STATUS_EMOJI: Record<string, string> = {
  no_session: '\u{26AA}',
  idle: '\u{1F4A4}',
  need_input: '\u{1F4AD}',
  running: '\u{26A1}',
  unknown: '\u{1F7E1}',
  error: '\u{2757}',
  done: '\u{2705}',
}

interface CharacterPanelProps {
  characterId: string
}

export function CharacterPanel({ characterId }: CharacterPanelProps): ReactElement | null {
  const character = useCharacterStore((s) =>
    s.characters.find((c) => c.id === characterId)
  )
  const runtimeState = useRuntimeStore((s) => s.states[characterId])
  const panelWidth = useUIStore((s) => s.panelWidth)
  const selectCharacter = useUIStore((s) => s.selectCharacter)
  const loadCharacters = useCharacterStore((s) => s.loadFromMain)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setIsVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const handleStartSession = useCallback(async () => {
    const dir = await window.api.invoke<string | null>(IPC_COMMANDS.DIALOG_OPEN_FOLDER)
    if (!dir) return
    await window.api.invoke(IPC_COMMANDS.SESSION_START, {
      characterId,
      workingDirectory: dir,
    })
    await loadCharacters()
  }, [characterId, loadCharacters])

  const handleStopSession = useCallback(async () => {
    await window.api.invoke(IPC_COMMANDS.SESSION_STOP, { characterId })
    await loadCharacters()
  }, [characterId, loadCharacters])

  const handleResumeSession = useCallback(
    async (sessionId: string) => {
      const dir = await window.api.invoke<string | null>(IPC_COMMANDS.DIALOG_OPEN_FOLDER)
      if (!dir) return
      await window.api.invoke(IPC_COMMANDS.SESSION_RESUME, {
        characterId,
        sessionId,
        workingDirectory: dir,
      })
      await loadCharacters()
    },
    [characterId, loadCharacters]
  )

  if (!character) return null

  const hasActiveSession =
    runtimeState?.hasLiveRuntime === true || character.currentSessionId !== null
  const historyEntries = character.sessionHistory ?? []
  const status = getCharacterMarkerStatus(runtimeState, character.currentSessionId)

  return (
    <div
      className="absolute top-0 right-0 h-full bg-background border-l border-border flex flex-col z-[100] transition-transform duration-300 ease-in-out"
      style={{
        width: `${panelWidth}%`,
        transform: isVisible ? 'translateX(0)' : 'translateX(100%)',
      }}
    >
      {/* Panel Header */}
      <div className="flex items-center justify-between p-3 bg-secondary border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-xl">
            {STATUS_EMOJI[status] || STATUS_EMOJI.idle}
          </span>
          <span className="font-bold text-base">
            {character.name}
          </span>
          <span className="text-xs text-muted-foreground uppercase">
            {status}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Session control */}
          {hasActiveSession ? (
            <Button variant="destructive" size="sm" onClick={handleStopSession}>
              Stop
            </Button>
          ) : (
            <Button variant="default" size="sm" onClick={handleStartSession}>
              Start
            </Button>
          )}

          {/* Session history dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" title="Session history">
                History
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[220px]">
              <DropdownMenuLabel>Session History</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {historyEntries.length === 0 ? (
                <DropdownMenuItem disabled>No session history</DropdownMenuItem>
              ) : (
                historyEntries.slice(0, 10).map((sessionId) => {
                  const isActive = sessionId === character.currentSessionId
                  return (
                    <DropdownMenuItem
                      key={sessionId}
                      onClick={() => {
                        if (!isActive) handleResumeSession(sessionId)
                      }}
                      className={isActive ? 'bg-accent font-semibold' : ''}
                    >
                      <span className="truncate flex-1 font-mono text-xs">
                        {sessionId.length > 16 ? `${sessionId.slice(0, 16)}...` : sessionId}
                      </span>
                      {isActive && (
                        <span className="ml-2 text-xs text-muted-foreground">active</span>
                      )}
                    </DropdownMenuItem>
                  )
                })
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Close button */}
          <Button variant="ghost" size="sm" onClick={() => selectCharacter(null)}>
            ESC
          </Button>
        </div>
      </div>

      {/* Terminal */}
      <TerminalView characterId={characterId} engine={character.engine} />
    </div>
  )
}
