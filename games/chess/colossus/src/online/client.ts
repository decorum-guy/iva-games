import type { Action } from '../core/types';
import { ONLINE_PROTOCOL } from './protocol';
import type { CommandEnvelope, CommandResponse, CreateRoomResponse, OnlineCommand, RoomOptions, RoomResponse, RoomSnapshot } from './protocol';

export class OnlineError extends Error {
  constructor(public readonly code: string, public readonly status = 0) { super(code); this.name = 'OnlineError'; }
}
const id = () => crypto.randomUUID();

/** Same-origin HTTP transport; authentication stays in an HttpOnly cookie. */
export class ColossusOnlineClient {
  snapshot: RoomSnapshot | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private update?: (snapshot: RoomSnapshot) => void;
  private failure?: (error: OnlineError) => void;
  private pending: CommandEnvelope | null = null;
  private pendingCreation: { payload: string; requestId: string } | null = null;
  constructor(private readonly base = '/api/colossus') {}

  private async request<T>(path: string, body?: unknown, keepalive = false): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.base + path, { method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin', cache: 'no-store', keepalive,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    } catch { throw new OnlineError('networkError'); }
    let result: T & { error?: string };
    try { result = await response.json(); } catch { throw new OnlineError(response.ok ? 'networkError' : 'serverError', response.ok ? 0 : response.status); }
    if (!response.ok) throw new OnlineError(result.error ?? 'serverError', response.status);
    return result;
  }
  private adopt(snapshot: RoomSnapshot) {
    if (snapshot.protocol !== ONLINE_PROTOCOL) throw new OnlineError('protocolMismatch');
    if (snapshot.state.secret !== null) throw new OnlineError('protocolMismatch');
    if (!this.snapshot || snapshot.id !== this.snapshot.id || snapshot.revision >= this.snapshot.revision) {
      this.snapshot = snapshot; this.update?.(snapshot);
    }
    return this.snapshot!;
  }
  async guest() { await this.request('/guest', {}); }
  private beginRoom() {
    this.stop(false); this.snapshot = null; this.pending = null;
    return this.generation;
  }
  async create(name: string, options: RoomOptions = {}, requestId?: string): Promise<CreateRoomResponse> {
    const generation = this.beginRoom();
    const payload = JSON.stringify({ name, options });
    const chosenId = requestId ?? (this.pendingCreation?.payload === payload ? this.pendingCreation.requestId : id());
    this.pendingCreation = { payload, requestId: chosenId };
    await this.guest();
    const result = await this.request<CreateRoomResponse>('/rooms', { protocol: ONLINE_PROTOCOL, requestId: chosenId, name, options });
    if (generation !== this.generation) throw new OnlineError('roomChanged');
    this.pendingCreation = null; this.adopt(result.snapshot); return result;
  }
  async join(roomId: string, invite: string, name: string): Promise<RoomSnapshot> {
    const generation = this.beginRoom();
    await this.guest();
    const result = await this.request<RoomResponse>('/rooms/' + encodeURIComponent(roomId) + '/join', { protocol: ONLINE_PROTOCOL, invite, name });
    if (generation !== this.generation) throw new OnlineError('roomChanged');
    return this.adopt(result.snapshot);
  }
  async load(roomId: string): Promise<RoomSnapshot> {
    const generation = this.beginRoom();
    await this.guest();
    const result = await this.request<RoomResponse>('/rooms/' + encodeURIComponent(roomId));
    if (generation !== this.generation) throw new OnlineError('roomChanged');
    return this.adopt(result.snapshot);
  }
  async invite(): Promise<string> {
    if (!this.snapshot) throw new OnlineError('roomMissing');
    return (await this.request<{ invite: string }>('/rooms/' + this.snapshot.id + '/invite', { protocol: ONLINE_PROTOCOL })).invite;
  }
  async presence(connected = true, keepalive = false): Promise<RoomSnapshot> {
    if (!this.snapshot) throw new OnlineError('roomMissing');
    const roomId = this.snapshot.id, generation = this.generation;
    const result = await this.request<RoomResponse>('/rooms/' + roomId + '/presence', { protocol: ONLINE_PROTOCOL, connected }, keepalive);
    return generation === this.generation && this.snapshot?.id === roomId ? this.adopt(result.snapshot) : result.snapshot;
  }
  start(onUpdate: (snapshot: RoomSnapshot) => void, onError?: (error: OnlineError) => void, intervalMs = 2000) {
    this.stop(false); this.update = onUpdate; this.failure = onError;
    const generation = ++this.generation;
    const poll = async () => {
      try { await this.presence(true); } catch (error) { if (generation === this.generation) this.failure?.(error instanceof OnlineError ? error : new OnlineError('networkError')); }
      if (generation === this.generation) this.timer = setTimeout(poll, Math.max(1000, intervalMs));
    };
    void poll();
  }
  stop(disconnect = true) {
    this.generation++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (disconnect && this.snapshot) void this.presence(false, true).catch(() => {});
    this.update = undefined; this.failure = undefined;
  }
  async send(command: OnlineCommand): Promise<CommandResponse> {
    if (!this.snapshot) throw new OnlineError('roomMissing');
    if (this.pending) throw new OnlineError('commandPending');
    this.pending = { protocol: ONLINE_PROTOCOL, commandId: id(), expectedRevision: this.snapshot.revision, command };
    return this.retryPending();
  }
  async action(action: Action) { return this.send({ type: 'action', action }); }
  /** A network failure retains the exact envelope; retry cannot spend a second command. */
  async retryPending(): Promise<CommandResponse> {
    if (!this.pending || !this.snapshot) throw new OnlineError('noPendingCommand');
    const request = this.pending, roomId = this.snapshot.id;
    try {
      const result = await this.request<CommandResponse>('/rooms/' + roomId + '/commands', request);
      if (this.pending !== request || this.snapshot?.id !== roomId) throw new OnlineError('roomChanged');
      this.pending = null; this.adopt(result.snapshot); return result;
    } catch (error) {
      if (this.pending === request && this.snapshot?.id === roomId && error instanceof OnlineError && error.status >= 400 && error.status < 500 && error.status !== 429) {
        this.pending = null;
        try { const result = await this.request<RoomResponse>('/rooms/' + roomId); if (this.snapshot?.id === roomId) this.adopt(result.snapshot); } catch { /* Retry polling later. */ }
      }
      throw error;
    }
  }
  hasPendingCommand() { return this.pending !== null; }
}
