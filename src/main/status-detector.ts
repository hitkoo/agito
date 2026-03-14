import type { CharacterStatus } from '../shared/types'

interface CharacterState {
  currentStatus: CharacterStatus
  lastDataTime: number
  onStatusChange: (status: CharacterStatus) => void
}

const IDLE_THRESHOLD_MS = 2000
const CHECK_INTERVAL_MS = 1000

export class StatusDetector {
  private states = new Map<string, CharacterState>()
  private timer: ReturnType<typeof setInterval> | null = null

  attach(characterId: string, onStatusChange: (status: CharacterStatus) => void): void {
    this.states.set(characterId, {
      currentStatus: 'idle',
      lastDataTime: 0,
      onStatusChange,
    })

    if (this.timer === null) {
      this.timer = setInterval(() => this.checkIdleTransitions(), CHECK_INTERVAL_MS)
    }
  }

  detach(characterId: string): void {
    this.states.delete(characterId)

    if (this.states.size === 0 && this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  feedData(characterId: string, _data: string): void {
    const state = this.states.get(characterId)
    if (!state) return

    state.lastDataTime = Date.now()

    if (state.currentStatus !== 'working') {
      state.currentStatus = 'working'
      state.onStatusChange('working')
    }
  }

  private checkIdleTransitions(): void {
    const now = Date.now()

    for (const [, state] of this.states) {
      if (state.currentStatus === 'working' && state.lastDataTime > 0) {
        if (now - state.lastDataTime >= IDLE_THRESHOLD_MS) {
          state.currentStatus = 'idle'
          state.onStatusChange('idle')
        }
      }
    }
  }
}
