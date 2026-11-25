import { useEffect, useRef, useState } from 'react'
import { commandKey, legalCommands, RULES_VERSION, validateCommand } from '../core'
import type { Command, GameState, Side } from '../core'
import { ENGINE_VERSION, getPreset, PRESET_VERSION } from '../engine/presets'
import type { SearchRequest, SearchResponse } from '../engine/protocol'
import { matchesSearchIdentity } from '../../sdk'

export interface UseBotOptions {
  readonly state: GameState
  readonly gameId: string
  readonly level: number
  readonly humanSide: Side
  readonly enabled: boolean
  readonly onCommand: (command: Command) => void
  readonly onError: () => void
}

type SearchPosition = Omit<UseBotOptions, 'onCommand' | 'onError'>

/** Injectable boundary used by the lifecycle tests; production always uses Worker. */
export interface BotWorkerPort {
  start(request: SearchRequest, onMessage: (message: unknown) => void, onError: () => void): void
  terminate(): void
}

export interface BotEnvironment {
  now(): number
  random(): number
  makeWorker(): BotWorkerPort
  setDelay(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>
  clearDelay(timer: ReturnType<typeof setTimeout>): void
}

function browserEnvironment(): BotEnvironment {
  return {
    now: () => performance.now(), random: Math.random,
    setDelay: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearDelay: timer => clearTimeout(timer),
    makeWorker: () => {
      const worker = new Worker(new URL('../engine/search.worker.ts', import.meta.url), { type: 'module' })
      return {
        start: (request, onMessage, onError) => {
          worker.addEventListener('message', event => onMessage(event.data))
          worker.addEventListener('error', onError)
          worker.postMessage(request)
        },
        terminate: () => worker.terminate(),
      }
    },
  }
}

let generation = 0

/**
 * Search + readable pacing. A hidden tab cancels work and a visible return
 * starts a fresh request/delay. No synchronous main-thread search fallback.
 */
export class BotController {
  private position: SearchPosition | null = null
  private worker: BotWorkerPort | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private request: SearchRequest | null = null
  private visible: boolean
  private thinking = false
  private disposed = false

  constructor(
    private readonly callbacks: {
      readonly onCommand: (command: Command) => void
      readonly onError: () => void
      readonly onThinking: (thinking: boolean) => void
    },
    private readonly environment: BotEnvironment = browserEnvironment(),
    visible = true,
  ) { this.visible = visible }

  start(position: SearchPosition) {
    if (this.disposed) return
    this.stop()
    this.position = position
    this.begin()
  }

  setVisible(visible: boolean) {
    if (this.disposed || this.visible === visible) return
    this.visible = visible
    if (!visible) this.stop()
    else this.begin()
  }

  dispose() {
    this.stop()
    this.position = null
    this.disposed = true
  }

  private setThinking(value: boolean) {
    if (value === this.thinking) return
    this.thinking = value
    this.callbacks.onThinking(value)
  }

  private stop() {
    this.request = null
    this.worker?.terminate()
    this.worker = null
    if (this.timer !== null) this.environment.clearDelay(this.timer)
    this.timer = null
    this.setThinking(false)
  }

  private begin() {
    const position = this.position
    if (this.disposed || !this.visible || !position?.enabled || position.state.outcome ||
      position.state.side === position.humanSide) return
    if (!getPreset(position.level)) { this.callbacks.onError(); return }

    const sessionGeneration = ++generation
    const request: SearchRequest = {
      type: 'search', requestId: `overdrive-${sessionGeneration}`, gameId: position.gameId,
      gameRevision: position.state.turnSerial, sessionGeneration, rulesVersion: RULES_VERSION,
      engineVersion: ENGINE_VERSION, presetId: position.level, presetVersion: PRESET_VERSION,
      publicState: position.state,
    }
    const started = this.environment.now()
    const minimumVisibleTime = 500 + Math.floor(Math.max(0, Math.min(.999999, this.environment.random())) * 351)
    this.request = request
    this.setThinking(true)
    let answered = false

    const current = () => !this.disposed && this.visible && this.request === request
    const failed = () => {
      if (!current() || answered) return
      this.stop()
      this.callbacks.onError()
    }
    try {
      this.worker = this.environment.makeWorker()
      this.worker.start(request, raw => {
        if (!current() || answered || !raw || typeof raw !== 'object' || !matchesSearchIdentity(raw as SearchResponse, request)) return
        const response = raw as SearchResponse
        if (response.type === 'error') { failed(); return }
        if (response.type !== 'result') return
        if (!validateCommand(response.command) ||
          !legalCommands(position.state).some(command => commandKey(command) === commandKey(response.command!))) {
          failed(); return
        }
        answered = true
        // Search has finished; retain the visible thinking interval, not an idle worker.
        this.worker?.terminate()
        this.worker = null
        const command = response.command
        const remaining = Math.max(0, started + minimumVisibleTime - this.environment.now())
        this.timer = this.environment.setDelay(() => {
          if (!current()) return
          this.stop()
          this.callbacks.onCommand(command)
        }, remaining)
      }, failed)
    } catch { failed() }
  }
}

/** Callback changes update refs without restarting an otherwise identical search. */
export function useBot(options: UseBotOptions): boolean {
  const { state, gameId, level, humanSide, enabled, onCommand, onError } = options
  const callbacks = useRef({ onCommand, onError })
  callbacks.current = { onCommand, onError }
  const [thinking, setThinking] = useState(false)
  useEffect(() => {
    const controller = new BotController({
      onCommand: command => callbacks.current.onCommand(command),
      onError: () => callbacks.current.onError(),
      onThinking: setThinking,
    }, undefined, !document.hidden)
    const visibility = () => controller.setVisible(!document.hidden)
    document.addEventListener('visibilitychange', visibility)
    controller.start({ state, gameId, level, humanSide, enabled })
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      controller.dispose()
    }
  }, [state, gameId, level, humanSide, enabled])
  return thinking
}
