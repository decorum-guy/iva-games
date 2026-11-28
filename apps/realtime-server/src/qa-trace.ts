/** Opt-in development diagnostics. Numeric spans only; never game or auth data. */
export const QA_TRACE_ROWS = 2048;
export const QA_TRACE_BYTES = 256 * 1024;
export const QA_TRACE_WINDOW_MS = 60_000;
export const QA_STORE_OPERATIONS = ['unknown', 'commit', 'status', 'list', 'compatibilityManifests', 'get', 'byStart',
  'starts', 'receipt', 'checkAdmission', 'outbox', 'create', 'acquire', 'enqueueStart', 'reserveStart', 'releaseStart',
  'cancelStart', 'consumeTicket', 'consumeBridge', 'admission', 'revoke', 'release', 'delivered', 'close'] as const;
export const QA_TRACE_COLUMNS = ['seq', 'kind', 'op', 'rpcSeq', 'batchSeq', 'sentOrStartUs', 'receivedUs',
  'executionStartUs', 'executionEndUs', 'ackUs', 'dueUs', 'workerEndUs', 'commitEndUs', 'backlogUs', 'result'] as const;
const WIDTH = QA_TRACE_COLUMNS.length;
type Scope = 'overload' | 'window-expired' | 'shutdown-before-overload';
type PauseStatus = 'confirmed' | 'failed' | 'not-applicable';
export interface QaStoreSpan { receivedUs: number; startedUs: number; endedUs: number; batchSeq: number }
export interface QaStoreClock { nowUs(): number }
export interface QaWorkerData { originNs: bigint }
const enabled = () => process.env.NODE_ENV === 'development' && process.env.REALTIME_QA_TRACE === '1';
const microseconds = (originNs: bigint) => Math.round(Number(process.hrtime.bigint() - originNs) / 1000);
const finiteInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function qaStoreClock(value: unknown): QaStoreClock | undefined {
  if (!enabled() || !value || typeof value !== 'object' || !('originNs' in value) || typeof value.originNs !== 'bigint') return;
  const originNs = value.originNs;
  if (originNs < 0n || originNs > process.hrtime.bigint()) return;
  return { nowUs: () => microseconds(originNs) };
}

/** The factory is the only entry: production never allocates a buffer or timer. */
export function createQaTrace(identity: { buildRevision?: string; artifactId: string },
  dependencies: { nowNs?: () => bigint; write?: (text: string) => void } = {}): QaTrace | undefined {
  if (!enabled()) return;
  return new QaTrace(identity, dependencies);
}

class QaTrace {
  private readonly originNs: bigint;
  private readonly clock: () => bigint;
  private readonly write: (text: string) => void;
  private readonly data = new Float64Array(QA_TRACE_ROWS * WIDTH);
  private readonly timer: ReturnType<typeof setTimeout>;
  private sequence = 0;
  private scope: Scope | null = null;
  private freezeUs = 0;
  private freezeSeq = 0;
  private freezeBacklogUs: number | null = null;
  private triggerTickSeq: number | null = null;
  private evictedUpdates = 0;
  private emitted = false;
  constructor(private readonly identity: { buildRevision?: string; artifactId: string },
    dependencies: { nowNs?: () => bigint; write?: (text: string) => void }) {
    this.clock = dependencies.nowNs ?? process.hrtime.bigint;
    this.originNs = this.clock();
    this.write = dependencies.write ?? (text => { process.stderr.write(text); });
    this.timer = setTimeout(() => { this.freeze('window-expired'); this.emit('not-applicable'); }, QA_TRACE_WINDOW_MS);
    this.timer.unref();
  }
  workerData(): QaWorkerData { return { originNs: this.originNs }; }
  private nowUs(): number { return Math.max(0, Math.round(Number(this.clock() - this.originNs) / 1000)); }
  private stopped(): boolean {
    if (this.scope) return true;
    if (this.nowUs() < QA_TRACE_WINDOW_MS * 1000) return false;
    this.freeze('window-expired'); setImmediate(() => this.emit('not-applicable')); return true;
  }
  private allocate(kind: number, op = 0, rpcSeq = 0): number | undefined {
    if (this.stopped()) return;
    const seq = ++this.sequence, offset = (seq - 1) % QA_TRACE_ROWS * WIDTH;
    this.data.fill(-1, offset, offset + WIDTH);
    this.data[offset] = seq; this.data[offset + 1] = kind; this.data[offset + 2] = op;
    this.data[offset + 3] = rpcSeq; this.data[offset + 4] = 0; this.data[offset + 14] = 0;
    return seq;
  }
  private offset(seq: number | undefined): number | undefined {
    if (this.stopped() || seq === undefined) return;
    const offset = (seq - 1) % QA_TRACE_ROWS * WIDTH;
    if (this.data[offset] !== seq) { this.evictedUpdates++; return; }
    return offset;
  }
  beginTick(deadlineMs: number, startedMs: number): number | undefined {
    const seq = this.allocate(1), offset = this.offset(seq);
    if (offset !== undefined) {
      const at = this.nowUs(); this.data[offset + 5] = at;
      this.data[offset + 10] = at + Math.round((deadlineMs - startedMs) * 1000);
    }
    return seq;
  }
  workerDone(seq: number | undefined): void {
    const offset = this.offset(seq); if (offset !== undefined) this.data[offset + 11] = this.nowUs();
  }
  linkCommit(seq: number, rpcSeq: number): void {
    const offset = this.offset(seq); if (offset !== undefined) this.data[offset + 3] = rpcSeq;
  }
  tickCommitted(seq: number | undefined, backlogMs: number): void {
    const offset = this.offset(seq);
    if (offset !== undefined) {
      this.data[offset + 12] = this.nowUs(); this.data[offset + 13] = Math.round(Math.max(0, backlogMs) * 1000);
      this.data[offset + 14] = 1;
    }
  }
  storeSent(op: string, rpcSeq: number, tickSeq?: number): number | undefined {
    const code = QA_STORE_OPERATIONS.indexOf(op as typeof QA_STORE_OPERATIONS[number]);
    const seq = this.allocate(2, Math.max(0, code), rpcSeq), offset = this.offset(seq);
    if (offset !== undefined) this.data[offset + 5] = this.nowUs();
    if (tickSeq !== undefined) this.linkCommit(tickSeq, rpcSeq);
    return seq;
  }
  storeReplied(seq: number | undefined, span: unknown, failed: boolean): void {
    const offset = this.offset(seq); if (offset === undefined) return;
    const ack = this.nowUs(); this.data[offset + 9] = ack; this.data[offset + 14] = failed ? 2 : 1;
    if (!span || typeof span !== 'object') return;
    const value = span as Partial<QaStoreSpan>;
    if (![value.receivedUs, value.startedUs, value.endedUs, value.batchSeq].every(finiteInteger) ||
      value.receivedUs! < this.data[offset + 5] || value.startedUs! < value.receivedUs! ||
      value.endedUs! < value.startedUs! || value.endedUs! > ack) return;
    this.data[offset + 4] = value.batchSeq!; this.data[offset + 6] = value.receivedUs!;
    this.data[offset + 7] = value.startedUs!; this.data[offset + 8] = value.endedUs!;
  }
  private freeze(scope: Scope, backlogMs?: number, triggerTickSeq?: number): void {
    if (this.scope) return;
    this.scope = scope; this.freezeUs = scope === 'window-expired' ? QA_TRACE_WINDOW_MS * 1000 : this.nowUs(); this.freezeSeq = this.sequence;
    this.freezeBacklogUs = backlogMs === undefined ? null : Math.round(Math.max(0, backlogMs) * 1000);
    this.triggerTickSeq = scope === 'overload' && finiteInteger(triggerTickSeq) && triggerTickSeq > 0 ? triggerTickSeq : null;
    clearTimeout(this.timer);
  }
  freezeOverload(backlogMs: number, triggerTickSeq?: number): void { if (!this.stopped()) this.freeze('overload', backlogMs, triggerTickSeq); }
  emit(pauseStatus: PauseStatus): void {
    if (!this.scope || this.emitted) return;
    this.emitted = true;
    const rows: number[][] = [];
    for (let seq = Math.max(1, this.freezeSeq - QA_TRACE_ROWS + 1); seq <= this.freezeSeq; seq++) {
      const offset = (seq - 1) % QA_TRACE_ROWS * WIDTH;
      rows.push(Array.from(this.data.subarray(offset, offset + WIDTH)));
    }
    let truncatedRows = 0;
    const report = () => {
      const presentRpc = new Set(rows.filter(row => row[1] === 2).map(row => row[3]));
      const missingCommitSpans = rows.filter(row => row[1] === 1 && row[3] > 0 && !presentRpc.has(row[3])).length;
      const incompleteRows = rows.filter(row => row[14] === 0 || row[1] === 2 && row[6] < 0 ||
        row[1] === 1 && (row[3] <= 0 || row[11] < 0 || row[12] < 0)).length;
      const droppedRows = Math.max(0, this.freezeSeq - QA_TRACE_ROWS);
      const trigger = rows.find(row => row[0] === this.triggerTickSeq);
      const triggerTickStatus = this.scope !== 'overload' ? 'not-applicable' : this.triggerTickSeq === null ? 'unknown-not-recorded'
        : !trigger ? 'unknown-evicted-or-truncated' : trigger[1] !== 1 ? 'unknown-not-a-tick' : 'retained';
      return { format: 'iva-runtime-correlation-1', scope: this.scope,
        buildRevision: /^[0-9a-f]{40}$/.test(this.identity.buildRevision ?? '') ? this.identity.buildRevision : 'unknown',
        artifactId: /^sha256:[0-9a-f]{64}$/.test(this.identity.artifactId) ? this.identity.artifactId : 'unknown',
        clock: 'process.hrtime relative microseconds; shared origin',
        limits: { rows: QA_TRACE_ROWS, outputBytes: QA_TRACE_BYTES, windowMs: QA_TRACE_WINDOW_MS },
        freeze: { atUs: this.freezeUs, seq: this.freezeSeq, backlogUs: this.freezeBacklogUs,
          triggerTickSeq: this.triggerTickSeq, triggerTickStatus,
          durablePause: this.scope === 'overload' ? pauseStatus : 'not-applicable' },
        retained: { firstSeq: rows[0]?.[0] ?? null, lastSeq: rows.at(-1)?.[0] ?? null, rows: rows.length, droppedRows,
          truncatedRows, evictedUpdates: this.evictedUpdates, incompleteRows, missingCommitSpans,
          completeFromStart: rows.length > 0 && !droppedRows && !truncatedRows && !this.evictedUpdates && !incompleteRows && !missingCommitSpans &&
            (this.scope !== 'overload' || triggerTickStatus === 'retained') },
        kind: { tick: 1, store: 2 }, result: { pending: 0, success: 1, error: 2 }, absent: -1,
        operations: QA_STORE_OPERATIONS, columns: QA_TRACE_COLUMNS, rows,
        interpretation: { fsyncAttribution: 'unknown', checkpointCorrelation: 'not-recorded', productionCapacityAccepted: false,
          causality: 'not established by timing correlation; incomplete or evicted intervals remain unknown',
          timingIncludesInstrumentation: true, order: 'seq is allocation order; span timestamps describe execution' } };
    };
    let text = JSON.stringify(report()) + '\n';
    while (Buffer.byteLength(text) > QA_TRACE_BYTES && rows.length) {
      const remove = Math.min(128, rows.length); rows.splice(0, remove); truncatedRows += remove;
      text = JSON.stringify(report()) + '\n';
    }
    // The fixed header is smaller than the cap. A diagnostic output failure
    // must never alter a durable game transition.
    if (Buffer.byteLength(text) <= QA_TRACE_BYTES) try { this.write(text); } catch { /* Diagnostic output unavailable. */ }
  }
  close(): void { this.stopped(); this.freeze('shutdown-before-overload'); this.emit('not-applicable'); }
}
export type { QaTrace };
