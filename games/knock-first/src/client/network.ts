import type { CommandPayload, CommandReceipt, PlayerInput, PlayerView } from '../core/types';
import { KNOCK_CONTENT, KNOCK_RULES, KNOCK_WIRE } from '../core/version';
import { LIVE_PROTOCOL } from '@iva-games/session-kit';
import type { LiveScope } from '@iva-games/session-kit';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'superseded' | 'closed';
interface Pending { payload: { payload: CommandPayload; expectedRevision?: number }; expectedRevision: number; resolve: (receipt: CommandReceipt) => void; reject: (error: Error) => void; sent: boolean }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, minimum = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
const epoch = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9:_-]{8,128}$/.test(value);
export class KnockConnection {
  private socket: WebSocket | null = null;
  private reconnect?: ReturnType<typeof setTimeout>;
  private inputTimer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private started = false;
  private suspended = false;
  private scope: LiveScope | null = null;
  private sequence = 0;
  private lastTick = -1;
  private lastRevision = 0;
  private retry = 0;
  private pending = new Map<string, Pending>();
  private inputValue: Omit<PlayerInput, 'seq' | 'controllerEpoch'> = { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, run: false, quiet: false, hand: false };
  constructor(private roomId: string, private matchId: string, private onView: (view: PlayerView) => void, private onState: (state: ConnectionState) => void, private onError: (code: string) => void) {}
  start(): void {
    if (this.stopped || this.started) return;
    this.started = true; this.open(); this.startInput();
  }
  private startInput(): void { clearInterval(this.inputTimer); this.inputTimer = setInterval(() => this.sendInput(), 34); }
  private open(): void {
    if (this.stopped || this.suspended) return;
    this.onState(this.retry ? 'reconnecting' : 'connecting');
    const url = new URL(`/api/platform/v1/rooms/${encodeURIComponent(this.roomId)}/live`, location.origin);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url); this.socket = socket;
    this.scope = null; this.lastTick = -1;
    for (const pending of this.pending.values()) pending.sent = false;
    socket.onmessage = event => {
      if (this.stopped || socket !== this.socket) return;
      let frame: unknown;
      try { frame = JSON.parse(String(event.data)); } catch { return; }
      if (!record(frame)) return;
      if (frame.protocol !== LIVE_PROTOCOL || frame.wireVersion !== KNOCK_WIRE || frame.rulesVersion !== KNOCK_RULES || frame.contentVersion !== KNOCK_CONTENT) { this.onError('INCOMPATIBLE_VERSION'); this.close(); return; }
      if (frame.roomId !== this.roomId || frame.matchId !== this.matchId || frame.gameId !== 'knock-first') { this.onError('MATCH_CHANGED'); this.close(); return; }
      if (!epoch(frame.epoch) || (this.scope && frame.epoch !== this.scope.epoch)) return;
      if (frame.type === 'snapshot') {
        const value = frame.view;
        if (!integer(frame.tick) || typeof frame.serverTime !== 'number' || !Number.isFinite(frame.serverTime) || !integer(frame.lastAcceptedSeq, -1) ||
            !record(value) || value.version !== KNOCK_RULES || value.wireVersion !== KNOCK_WIRE || value.tick !== frame.tick || !integer(value.revision) ||
            !record(value.self) || value.self.acknowledgedSeq !== frame.lastAcceptedSeq || !integer(value.self.controllerEpoch) || frame.tick < this.lastTick) return;
        const view = value as unknown as PlayerView;
        if (!this.scope) {
          this.scope = { protocol: LIVE_PROTOCOL, wireVersion: KNOCK_WIRE, roomId: this.roomId, matchId: this.matchId, epoch: frame.epoch };
          this.sequence = frame.lastAcceptedSeq; this.retry = 0; this.onState('connected');
        }
        this.lastTick = view.tick; this.lastRevision = view.revision; this.onView(view);
        for (const [actionId, pending] of this.pending) if (!pending.sent) this.sendCommand(actionId, pending);
      } else if (frame.type === 'receipt' && this.scope && typeof frame.actionId === 'string') {
        const receipt = frame.result;
        if (!record(receipt) || receipt.actionId !== frame.actionId || typeof receipt.ok !== 'boolean' || typeof receipt.code !== 'string' || !integer(receipt.tick) || !integer(receipt.revision)) return;
        const pending = this.pending.get(frame.actionId); this.pending.delete(frame.actionId);
        if (pending) pending.resolve(receipt as unknown as CommandReceipt);
      } else if (frame.type === 'error') {
        const code = typeof frame.code === 'string' ? frame.code : 'NETWORK';
        // A gateway deadline is not cancellation: persistence may still finish.
        // The forced reconnect must retry the same ID and recover its receipt.
        if (typeof frame.actionId === 'string' && code !== 'GAME_TIMEOUT') {
          const pending = this.pending.get(frame.actionId); this.pending.delete(frame.actionId); pending?.reject(new Error(code));
        }
        if (code !== 'INPUT_RATE') this.onError(code);
      }
    };
    socket.onclose = event => {
      if (socket !== this.socket || this.stopped) return;
      this.scope = null; this.neutral();
      if (event.code === 4001) { this.onState('superseded'); return; }
      this.onState('reconnecting');
      this.reconnect = setTimeout(() => this.open(), Math.min(4000, 350 * ++this.retry));
    };
    socket.onerror = () => { /* close owns retries and never duplicates an in-flight command */ };
  }
  input(value: Omit<PlayerInput, 'seq' | 'controllerEpoch'>): void {
    if (this.stopped || this.suspended) return;
    const { moveX, moveZ, yaw, pitch, run, quiet, hand } = value;
    // Scene inputs also contain `interact`. Structural typing does not remove
    // extra fields, so construct the exact shared-runtime payload here.
    this.inputValue = { moveX, moveZ, yaw, pitch, run, quiet, hand };
  }
  neutral(): void { this.inputValue = { ...this.inputValue, moveX: 0, moveZ: 0, run: false, hand: false }; }
  private sendInput(): void {
    if (this.socket?.readyState !== WebSocket.OPEN || !this.scope || this.socket.bufferedAmount > 32_768) return;
    this.socket.send(JSON.stringify({ ...this.scope, type: 'input', seq: ++this.sequence, payload: this.inputValue }));
  }
  private sendCommand(actionId: string, pending: Pending): void {
    if (this.socket?.readyState !== WebSocket.OPEN || !this.scope) return;
    pending.sent = true;
    this.socket.send(JSON.stringify({ ...this.scope, type: 'command', actionId, expectedRevision: pending.expectedRevision, payload: { ...pending.payload, epoch: this.scope.epoch } }));
  }
  command(payload: CommandPayload, expectedRevision?: number): Promise<CommandReceipt> {
    if (this.stopped) return Promise.reject(new Error('CLOSED'));
    if (this.pending.size >= 8) return Promise.reject(new Error('BUSY'));
    // Keydown/keyup commands precede the next rendered control sample. Keep
    // the independent input timer in the same hand state, or its old neutral
    // frame can cancel a rescue/install immediately after the command starts it.
    if (payload.type === 'hand') this.inputValue = { ...this.inputValue, hand: payload.down };
    return new Promise((resolve, reject) => {
      const actionId = crypto.randomUUID(), pending: Pending = { payload: { payload, ...(expectedRevision === undefined ? {} : { expectedRevision }) }, expectedRevision: this.lastRevision, resolve, reject, sent: false };
      this.pending.set(actionId, pending); this.sendCommand(actionId, pending);
    });
  }
  reclaim(): void {
    if (this.stopped || this.suspended) return;
    clearTimeout(this.reconnect); const socket = this.socket; this.socket = null; socket?.close(); this.retry = 0; this.open();
  }
  /** Graphics recovery releases control but retains unacknowledged action IDs. */
  suspend(): void {
    if (this.stopped || this.suspended) return;
    this.suspended = true; clearTimeout(this.reconnect); clearInterval(this.inputTimer); this.neutral(); this.scope = null;
    const socket = this.socket; this.socket = null; socket?.close(1000, 'Graphics recovery'); this.onState('reconnecting');
  }
  resume(): void {
    if (this.stopped || !this.suspended) return;
    this.suspended = false; this.retry = 1; this.open(); this.startInput();
  }
  close(): void {
    if (this.stopped) return;
    this.stopped = true; clearTimeout(this.reconnect); clearInterval(this.inputTimer); this.neutral();
    this.scope = null; const socket = this.socket; this.socket = null; socket?.close(1000, 'Leaving mission'); this.onState('closed');
    for (const pending of this.pending.values()) pending.reject(new Error('CLOSED'));
    this.pending.clear();
  }
}
