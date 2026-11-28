import type { Action, ActionResult, BotLevel, Input, MapId, Tool, Weapon, WorldView } from '../core/types'
import { predictFighter, type PendingInput, type PredictedFighter } from './prediction'

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'paused' | 'spectating' | 'error'
export interface PracticeOptions { mapId: MapId; teamSize: 1 | 2 | 3; mode: 'training' | 'tutorial'; displayName: string; botLevel: BotLevel; weapon: Weapon; tool: Tool }
export interface JoinInfo { matchId: string; participantId: string; ticket: string; websocketPath: string; protocolVersion: number; route?: string }
export interface SessionClient {
  input(value: Input): void
  action(value: Action): Promise<ActionResult>
  claim(): void
  close(): void
  getView(): WorldView | null
  getPrediction?(): PredictedFighter | null
}
export async function requestJson<T>(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let response: Response
  try { response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) }) }
  catch { throw new Error('NETWORK') }
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error?.code ?? result.code ?? `HTTP_${response.status}`)
  return result as T
}
export const createPractice = (options: PracticeOptions): Promise<JoinInfo> => requestJson('/api/realtime/v1/practice', options)
export const practiceTicket = (matchId: string): Promise<JoinInfo> => requestJson(`/api/realtime/v1/practice/${encodeURIComponent(matchId)}/ticket`, {})
export const abandonPractice = (matchId: string): Promise<{ ok: boolean }> => requestJson(`/api/realtime/v1/practice/${encodeURIComponent(matchId)}/abandon`, {})
export async function roomTicket(roomId: string): Promise<JoinInfo> {
  const session = await requestJson<{ csrfToken: string; user: unknown }>('/api/platform/v1/session')
  if (!session.user) throw new Error('AUTH_REQUIRED')
  return requestJson(`/api/platform/v1/rooms/${encodeURIComponent(roomId)}/realtime-ticket`, {}, { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': crypto.randomUUID() })
}
interface Pending { action: Action; resolve: (value: ActionResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

export class OnlineSession implements SessionClient {
  private socket: WebSocket | null = null
  private view: WorldView | null = null
  private epoch = 1
  private generation = 1
  private sequence = 0
  private closed = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private pending = new Map<string, Pending>()
  private connected = false
  private controlling = false
  private hostPhase = 'loading'
  private snapshotSeq = 0
  private baselines = new Map<number, WorldView>()
  private inputHistory: PendingInput[] = []
  private predicted: PredictedFighter | null = null
  private predictionLife = ''
  private retries = 0
  constructor(private info: JoinInfo, private renew: () => Promise<JoinInfo>, private onView: (view: WorldView) => void, private onStatus: (status: ConnectionState, code?: string) => void) { this.connect() }
  private send(value: unknown): void { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value)) }
  private envelope(type: string): Record<string, unknown> { return { type, protocolVersion: 1, matchId: this.info.matchId, epoch: this.epoch, controllerGeneration: this.generation } }
  private readPhase(value: unknown): void {
    if (typeof value === 'string') this.hostPhase = value
    if (this.hostPhase !== 'running') { this.inputHistory = []; this.predicted = null }
  }
  private reportStatus(code?: string): void {
    this.onStatus(this.hostPhase === 'paused' || this.hostPhase === 'recovering' ? 'paused' : this.controlling ? 'connected' : 'spectating', code)
  }
  private connect(): void {
    if (this.closed) return
    this.hostPhase = 'loading'
    this.onStatus(this.retries ? 'reconnecting' : 'connecting')
    const url = new URL(this.info.websocketPath, location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url, 'iva-realtime-v1'); this.socket = socket
    socket.onopen = () => this.send({ type: 'authenticate', ticket: this.info.ticket })
    socket.onmessage = event => {
      let message: Record<string, unknown>
      try { message = JSON.parse(String(event.data)) as Record<string, unknown> } catch { return }
      if (message.type === 'hello') {
        this.epoch = Number(message.epoch); this.generation = Number(message.controllerGeneration); this.connected = true; this.retries = 0
        this.controlling = message.controlling === true; this.sequence = 0; this.baselines.clear(); this.inputHistory = []; this.predicted = null
        this.readPhase(message.phase); this.reportStatus()
        if (this.heartbeat) clearInterval(this.heartbeat)
        this.heartbeat = setInterval(() => this.send({ ...this.envelope('heartbeat') }), 1000)
        if (this.controlling && this.hostPhase === 'running') for (const [actionId, pending] of this.pending) this.send({ ...this.envelope('action'), actionId, payload: pending.action })
      }
      if (message.type === 'full') {
        const nextEpoch = Number(message.epoch)
        if (nextEpoch !== this.epoch) { this.epoch = nextEpoch; this.sequence = 0; this.baselines.clear(); this.inputHistory = []; this.predicted = null }
        this.readPhase(message.phase)
        this.snapshotSeq = Number(message.snapshotSeq); this.view = message.view as WorldView; this.remember(this.snapshotSeq, this.view); this.onView(this.view)
        this.send({ ...this.envelope('ackSnapshot'), snapshotSeq: this.snapshotSeq })
        this.reportStatus()
      }
      if (message.type === 'delta') {
        const baseline = this.baselines.get(Number(message.baselineSnapshotSeq))
        if (Number(message.epoch) !== this.epoch || !baseline || !message.patch || typeof message.patch !== 'object') { this.send({ ...this.envelope('resync') }); return }
        this.readPhase(message.phase)
        this.snapshotSeq = Number(message.snapshotSeq); this.view = { ...baseline, ...message.patch as Partial<WorldView> }; this.remember(this.snapshotSeq, this.view); this.onView(this.view); this.send({ ...this.envelope('ackSnapshot'), snapshotSeq: this.snapshotSeq }); this.reportStatus()
      }
      if (message.type === 'actionAck') {
        const id = String(message.actionId); const pending = this.pending.get(id)
        if (pending) { clearTimeout(pending.timer); this.pending.delete(id); pending.resolve(message.result as ActionResult) }
      }
      if (message.type === 'controlChanged') { this.generation = Number(message.controllerGeneration); this.sequence = 0; this.inputHistory = []; this.predicted = null; this.controlling = message.controlling === true; this.reportStatus() }
      if (message.type === 'error') {
        const code = String(message.code ?? 'NETWORK')
        if (code === 'MATCH_PAUSED') this.readPhase('paused')
        if (this.connected) this.reportStatus(code); else this.onStatus('error', code)
      }
      if (message.type === 'phaseChanged') { this.readPhase(message.phase); this.reportStatus() }
    }
    socket.onclose = () => {
      this.connected = false; this.controlling = false; this.inputHistory = []; this.predicted = null; if (this.heartbeat) clearInterval(this.heartbeat)
      if (this.closed) return
      this.onStatus('reconnecting'); this.retries++
      this.reconnectTimer = setTimeout(() => { void this.renew().then(info => { this.info = info; this.connect() }).catch((error: Error) => { this.onStatus('error', error.message) }) }, Math.min(500 * this.retries, 5000))
    }
    socket.onerror = () => this.onStatus('reconnecting')
  }
  private remember(sequence: number, view: WorldView): void {
    this.baselines.set(sequence, view); while (this.baselines.size > 32) this.baselines.delete(this.baselines.keys().next().value!)
    const life = `${this.epoch}:${view.operation}:${view.phase}:${view.units.find(u => u.ownerId === view.you && u.kind === 'fighter')?.id ?? ''}`
    if (life !== this.predictionLife) { this.inputHistory = []; this.predicted = null; this.predictionLife = life }
    const consumed = view.participants.find(p => p.id === view.you)?.lastConsumedInputSeq ?? 0
    this.inputHistory = this.inputHistory.filter(item => item.sequence > consumed)
    this.predicted = this.controlling && this.hostPhase === 'running' ? predictFighter(view, this.inputHistory) : null
  }
  input(value: Input): void {
    if (!this.connected || !this.controlling || this.hostPhase !== 'running') return
    const sequence = ++this.sequence
    this.inputHistory.push({ sequence, input: { ...value } }); if (this.inputHistory.length > 30) this.inputHistory.shift()
    this.predicted = this.view ? predictFighter(this.view, this.inputHistory) : null
    this.send({ ...this.envelope('input'), inputSeq: sequence, payload: { ...value, inputSeq: sequence } })
  }
  action(value: Action): Promise<ActionResult> {
    if (!this.connected) return Promise.reject(new Error('NETWORK'))
    if (!this.controlling) return Promise.reject(new Error('VIEW_ONLY'))
    if (this.hostPhase !== 'running') return Promise.reject(new Error(this.hostPhase === 'finished' ? 'MATCH_FINISHED' : 'MATCH_PAUSED'))
    const actionId = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(actionId); reject(new Error('NETWORK')) }, 20000)
      this.pending.set(actionId, { action: value, resolve, reject, timer }); this.send({ ...this.envelope('action'), actionId, payload: value })
    })
  }
  claim(): void { this.send({ ...this.envelope('claimControl') }) }
  getView(): WorldView | null { return this.view }
  getPrediction(): PredictedFighter | null { return this.predicted }
  close(): void {
    this.input({ moveX: 0, moveZ: 0, aimX: 1, aimZ: 0, fireHeld: false, firePressSeq: 0 })
    this.closed = true; if (this.reconnectTimer) clearTimeout(this.reconnectTimer); if (this.heartbeat) clearInterval(this.heartbeat)
    this.socket?.close(); for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('NETWORK')) }; this.pending.clear()
  }
}
