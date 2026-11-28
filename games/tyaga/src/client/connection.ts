import { REALTIME_PROTOCOL, applyViewChanges } from '@iva-games/realtime-kit';
import type { Snapshot, TicketResponse, WireScope } from '@iva-games/realtime-kit';
import type { TyagaAction, TyagaInput, TyagaView } from '../core/types';
import { NEUTRAL_INPUT } from '../core/config';
import { api } from './api';

export interface ConnectionState { status: 'connecting' | 'connected' | 'reconnecting' | 'closed'; snapshot: Snapshot | null; view: TyagaView | null; error: string | null }
export class GameConnection {
  private socket: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private input = { ...NEUTRAL_INPUT };
  private inputSeq = 0;
  private baselines = new Map<number, TyagaView>();
  private alive = false;
  private retryTimer = 0;
  private inputTimer = 0;
  private heartbeatTimer = 0;
  private legacyPauseSince = 0;
  private lastResyncAt = -Infinity;
  private pending = new Map<string, { action: TyagaAction; epoch: number; generation: number; sentAt: number; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }>();
  private state: ConnectionState = { status: 'connecting', snapshot: null, view: null, error: null };
  private hudState = this.state;
  private hudListeners = new Set<() => void>();
  private hudTimer = 0;
  constructor(readonly roomId: string) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getState = () => this.state;
  subscribeHud = (listener: () => void) => { this.hudListeners.add(listener); return () => { this.hudListeners.delete(listener); }; };
  getHudState = () => this.hudState;
  private flushHud = () => { clearTimeout(this.hudTimer); this.hudTimer = 0; this.hudState = this.state; this.hudListeners.forEach(listener => listener()); };
  private update(next: Partial<ConnectionState>) {
    const previous = this.state;
    this.state = { ...previous, ...next };
    // Physics snapshots feed Three.js directly. React receives a bounded HUD
    // cadence, with control/phase changes delivered without waiting.
    this.listeners.forEach(listener => listener());
    const beforeSelf = previous.view?.participants.find(p => p.participantId === previous.view?.participantId);
    const self = this.state.view?.participants.find(p => p.participantId === this.state.view?.participantId);
    const critical = previous.status !== this.state.status || previous.error !== this.state.error ||
      previous.snapshot?.epoch !== this.state.snapshot?.epoch || previous.snapshot?.controllerGeneration !== this.state.snapshot?.controllerGeneration ||
      previous.snapshot?.hasControl !== this.state.snapshot?.hasControl || previous.snapshot?.phase !== this.state.snapshot?.phase ||
      previous.view?.phase !== this.state.view?.phase || previous.view?.tutorial?.step !== this.state.view?.tutorial?.step ||
      beforeSelf?.controlling !== self?.controlling || beforeSelf?.holding !== self?.holding;
    if (critical) this.flushHud();
    else if (!this.hudTimer) this.hudTimer = window.setTimeout(this.flushHud, 100);
  }
  private scope(): WireScope | null {
    const s = this.state.snapshot;
    return s ? { protocolVersion: REALTIME_PROTOCOL, matchId: s.matchId, epoch: s.epoch, controllerGeneration: s.controllerGeneration } : null;
  }
  private send(data: Record<string, unknown>) { const scope = this.scope(); if (scope && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ ...scope, ...data })); }
  private requestResync() {
    const now = performance.now();
    // Missing baselines can affect several deltas before a full view arrives.
    // One request per 250 ms leaves room for ordinary control messages.
    if (now - this.lastResyncAt < 250) return;
    this.lastResyncAt = now; this.send({ type: 'resync' });
  }
  start() {
    if (this.alive) return;
    this.alive = true; void this.connect();
    this.inputTimer = window.setInterval(() => {
      if (this.state.status === 'connected' && this.state.snapshot?.hasControl && this.state.snapshot.phase === 'running') this.send({ type: 'input', inputSeq: ++this.inputSeq, payload: this.input });
    }, 1000 / 30);
    this.heartbeatTimer = window.setInterval(() => { this.send({ type: 'heartbeat', nonce: crypto.randomUUID() }); this.retryActions(); this.recoverLegacyPause(); }, 1000);
  }
  private recoverLegacyPause() {
    const snapshot = this.state.snapshot;
    // Older retained workers did not describe or resume overload pauses. A
    // normal reconnect preserves their exact artifact and restores control.
    if (this.state.status !== 'connected' || snapshot?.phase !== 'paused' || !snapshot.hasControl || snapshot.pauseReason || this.state.view?.phase !== 'running' || this.state.view.outcome) { this.legacyPauseSince = 0; return; }
    if (!this.legacyPauseSince) { this.legacyPauseSince = performance.now(); return; }
    if (performance.now() - this.legacyPauseSince < 1500) return;
    this.legacyPauseSince = 0; this.neutral(); this.socket?.close(1012, 'Resume saved expedition');
  }
  private async connect() {
    if (!this.alive) return;
    this.neutral(); this.update({ status: this.state.snapshot ? 'reconnecting' : 'connecting', error: null });
    try {
      const ticket = await api<TicketResponse>(`/rooms/${this.roomId}/realtime-ticket`, {});
      if (!this.alive) return;
      if (ticket.launchUrl) {
        const destination = new URL(ticket.launchUrl, location.origin);
        if (!/^[a-f0-9]{64}$/.test(ticket.clientContentHash ?? '') || destination.origin !== location.origin || destination.pathname !== `/play/tyaga/versions/${ticket.clientContentHash}/` || destination.searchParams.get('room') !== this.roomId) throw new Error('VERSION_UNAVAILABLE');
        if (location.pathname !== destination.pathname) { location.replace(destination.href); return; }
      }
      const url = new URL(ticket.websocketPath, location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(url, ticket.subprotocol); this.socket = socket;
      socket.onopen = () => socket.send(JSON.stringify({ type: 'authenticate', ticket: ticket.ticket }));
      socket.onmessage = event => {
        let message: Record<string, unknown>;
        try { message = JSON.parse(event.data); } catch { this.update({ error: 'INVALID_RESPONSE' }); return; }
        if (message.type === 'full') {
          const snapshot = message as unknown as Snapshot;
          const view = snapshot.view as TyagaView;
          if (snapshot.protocolVersion !== REALTIME_PROTOCOL || view?.gameId !== 'tyaga') { this.update({ error: 'VERSION_UNAVAILABLE' }); this.neutral(); return; }
          const oldEpoch = this.state.snapshot?.epoch, oldGeneration = this.state.snapshot?.controllerGeneration;
          if (oldEpoch !== snapshot.epoch || oldGeneration !== snapshot.controllerGeneration) { this.inputSeq = snapshot.lastConsumedInputSeq; this.input = { ...NEUTRAL_INPUT }; this.baselines.clear(); }
          else this.inputSeq = Math.max(this.inputSeq, snapshot.lastConsumedInputSeq);
          this.update({ snapshot, view, status: 'connected', error: null });
          this.lastResyncAt = -Infinity;
          this.baselines.set(snapshot.snapshotSeq, view);
          while (this.baselines.size > 64) this.baselines.delete(this.baselines.keys().next().value!);
          this.send({ type: 'ackSnapshot', snapshotSeq: snapshot.snapshotSeq });
          for (const [id, pending] of this.pending) if (pending.epoch !== snapshot.epoch || pending.generation !== snapshot.controllerGeneration || !snapshot.hasControl) { clearTimeout(pending.timer); pending.reject(new Error(pending.epoch !== snapshot.epoch ? 'WORLD_CHANGED' : 'NO_CONTROL')); this.pending.delete(id); }
          this.retryActions();
        } else if (message.type === 'delta') {
          const baseline = this.baselines.get(Number(message.baselineSnapshotSeq));
          if (!baseline || message.epoch !== this.state.snapshot?.epoch) { this.requestResync(); return; }
          try {
            const view = applyViewChanges(baseline, message.changes as Parameters<typeof applyViewChanges>[1], ['map']) as TyagaView;
            const snapshot = { ...message, type: 'full', view } as unknown as Snapshot;
            this.baselines.set(snapshot.snapshotSeq, view);
            while (this.baselines.size > 64) this.baselines.delete(this.baselines.keys().next().value!);
            this.update({ snapshot, view, status: 'connected', error: null });
            this.send({ type: 'ackSnapshot', snapshotSeq: snapshot.snapshotSeq });
          } catch { this.requestResync(); }
        } else if (message.type === 'actionAck') {
          const id = String(message.actionId); const pending = this.pending.get(id);
          if (pending) { clearTimeout(pending.timer); this.pending.delete(id); pending.resolve(message.result); }
        } else if (message.type === 'error') {
          const code = typeof message.code === 'string' ? message.code : 'NETWORK';
          const pending = this.pending.get(String(message.actionId));
          if (pending) { clearTimeout(pending.timer); pending.reject(new Error(code)); this.pending.delete(String(message.actionId)); }
          if (!['STALE_INPUT', 'STALE_SEQUENCE'].includes(code)) this.update({ error: code });
          if (['STALE_EPOCH', 'STALE_CONTROLLER'].includes(code)) { this.neutral(); this.requestResync(); }
        } else if (message.type === 'controlChanged') { this.neutral(); this.requestResync(); }
      };
      socket.onerror = () => { this.neutral(); };
      socket.onclose = () => { if (this.socket === socket && this.alive) { this.update({ status: 'reconnecting' }); this.retryTimer = window.setTimeout(() => { void this.connect(); }, 1500); } };
    } catch (error) {
      if (!this.alive) return;
      this.update({ status: 'reconnecting', error: error instanceof Error ? error.message : 'NETWORK' });
      this.retryTimer = window.setTimeout(() => { void this.connect(); }, 3000);
    }
  }
  setInput(input: TyagaInput) { this.input = input; }
  neutral() { this.input = { ...NEUTRAL_INPUT }; if (this.state.snapshot?.hasControl) this.send({ type: 'input', inputSeq: ++this.inputSeq, payload: this.input }); }
  claim() { this.neutral(); this.send({ type: 'claimControl', expectedGeneration: this.state.snapshot?.controllerGeneration ?? 0 }); }
  private retryActions() {
    if (this.state.status !== 'connected' || !this.state.snapshot?.hasControl) return;
    for (const [actionId, pending] of this.pending) if (pending.epoch === this.state.snapshot.epoch && pending.generation === this.state.snapshot.controllerGeneration && performance.now() - pending.sentAt > 2000) {
      pending.sentAt = performance.now(); this.send({ type: 'action', actionId, payload: pending.action });
    }
  }
  action(action: TyagaAction): Promise<unknown> {
    if (!this.state.snapshot?.hasControl || this.state.status !== 'connected') return Promise.reject(new Error('NO_CONTROL'));
    const actionId = crypto.randomUUID(), epoch = this.state.snapshot.epoch, generation = this.state.snapshot.controllerGeneration;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => { this.pending.delete(actionId); reject(new Error('ACTION_TIMEOUT')); }, 30000);
      this.pending.set(actionId, { action, epoch, generation, sentAt: performance.now(), resolve, reject, timer });
      this.send({ type: 'action', actionId, payload: action });
    });
  }
  close() {
    this.neutral(); this.alive = false;
    clearTimeout(this.retryTimer); clearTimeout(this.hudTimer); this.hudTimer = 0; clearInterval(this.inputTimer); clearInterval(this.heartbeatTimer);
    this.socket?.close(1000); this.socket = null;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('CLOSED')); }
    this.pending.clear(); this.update({ status: 'closed' });
  }
}
