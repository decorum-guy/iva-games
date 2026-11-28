import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQaTrace, QA_STORE_OPERATIONS, QA_TRACE_BYTES, QA_TRACE_COLUMNS, QA_TRACE_ROWS, qaStoreClock } from '../src/qa-trace';
import { WorkerRpc } from '../src/worker-rpc';
import { StoreQueue } from '../src/store-queue';
import type { StoreReply } from '../src/store-queue';

const identity = { buildRevision: 'a'.repeat(40), artifactId: 'sha256:' + 'b'.repeat(64) };
const column = (name: typeof QA_TRACE_COLUMNS[number]) => QA_TRACE_COLUMNS.indexOf(name);
type Report = { scope: string; freeze: { atUs: number; seq: number; durablePause: string; triggerTickSeq: number | null; triggerTickStatus: string }; rows: number[][];
  retained: { rows: number; droppedRows: number; truncatedRows: number; evictedUpdates: number; incompleteRows: number; missingCommitSpans: number; completeFromStart: boolean } };
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
function enabled() { vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('REALTIME_QA_TRACE', '1'); }
function controlled() {
  enabled(); let now = 0n; const output: string[] = [];
  const trace = createQaTrace(identity, { nowNs: () => now, write: text => output.push(text) })!;
  return { trace, output, at: (ns: bigint) => { now = ns; }, nowUs: () => Number(now / 1000n), report: () => JSON.parse(output[0]) as Report };
}

describe('bounded development-only runtime correlation', () => {
  it('never enables in production/test or without the exact opt-in, including the writer clock', () => {
    const write = vi.fn();
    for (const [environment, flag] of [['production', '1'], ['test', '1'], ['development', '0'], ['development', 'true']]) {
      vi.stubEnv('NODE_ENV', environment); vi.stubEnv('REALTIME_QA_TRACE', flag);
      expect(createQaTrace(identity, { write })).toBeUndefined(); expect(qaStoreClock({ originNs: 0n })).toBeUndefined();
    }
    expect(write).not.toHaveBeenCalled();
  });

  it('records every FIFO store operation and the common execution span of a commit batch without args/results/errors', async () => {
    vi.useFakeTimers(); const fixture = controlled(), { trace } = fixture;
    const receipts: StoreReply[] = [], calls: string[] = [], sequences = new Map<number, number | undefined>();
    const queue = new StoreQueue(request => {
      calls.push(request.op); fixture.at(BigInt(fixture.nowUs() + 20_000) * 1000n);
      if (request.op === 'revoke') throw new Error('PRIVATE_ERROR_AND_KEY');
      return { ticket: 'PRIVATE_TICKET', world: 'PRIVATE_WORLD' };
    }, values => { calls.push('commit'); fixture.at(BigInt(fixture.nowUs() + 5000) * 1000n); return values.map(() => ({})); },
    reply => { receipts.push(reply); trace.storeReplied(sequences.get(reply.id), reply.qaSpan, reply.error !== undefined); },
    undefined, undefined, { nowUs: fixture.nowUs });
    for (const [index, op] of ['consumeBridge', 'commit', 'commit', 'admission', 'revoke'].entries()) {
      sequences.set(index + 1, trace.storeSent(op, index + 1));
      queue.enqueue({ id: index + 1, op, args: [{ roomId: 'PRIVATE_ROOM', userId: 'PRIVATE_USER', payload: 'PRIVATE_PAYLOAD' }] });
    }
    fixture.at(2_000_000n); await vi.advanceTimersByTimeAsync(2);
    expect(calls).toEqual(['consumeBridge', 'commit', 'admission', 'revoke']);
    expect(receipts.map(reply => reply.id)).toEqual([1, 2, 3, 4, 5]);
    expect(receipts[1].qaSpan).toEqual(receipts[2].qaSpan); expect(receipts[1].qaSpan!.batchSeq).toBe(1);
    expect(receipts[0].qaSpan).toMatchObject({ receivedUs: 0, startedUs: 2000, endedUs: 22_000, batchSeq: 0 });
    trace.close();
    const report = fixture.report(); expect(report.rows).toHaveLength(5);
    expect(report.rows.map(row => QA_STORE_OPERATIONS[row[column('op')]])).toEqual(['consumeBridge', 'commit', 'commit', 'admission', 'revoke']);
    expect(report.rows[4][column('result')]).toBe(2); expect(report.retained.completeFromStart).toBe(true);
    expect(fixture.output[0]).not.toMatch(/PRIVATE_|roomId|userId|payload|"ticket"|"world"/);
  });

  it('links each tick to its own real worker RPC despite interleaved service calls and out-of-order replies', async () => {
    enabled(); const output: string[] = [], trace = createQaTrace(identity, { write: text => output.push(text) })!;
    const script = `import { parentPort, workerData } from 'node:worker_threads';
      const now = () => Math.round(Number(process.hrtime.bigint() - workerData.qaTrace.originNs) / 1000);
      parentPort.on('message', message => { const receivedUs = now();
        setTimeout(() => { const startedUs = now(); parentPort.postMessage({ id: message.id,
          value: { world: 'PRIVATE_WORKER_WORLD' }, qaSpan: { receivedUs, startedUs, endedUs: now(), batchSeq: message.op === 'commit' ? message.id : 0,
            roomId: 'PRIVATE_IGNORED_SPAN_FIELD' } }); }, message.args[0].delay);
      });`;
    const rpc = new WorkerRpc(new URL('data:text/javascript,' + encodeURIComponent(script)), undefined, trace);
    try {
      const firstTick = trace.beginTick(performance.now(), performance.now())!; trace.workerDone(firstTick);
      const first = rpc.callForTick(firstTick, 'commit', { delay: 40, ticket: 'PRIVATE_TICKET' }).then(() => trace.tickCommitted(firstTick, 0));
      const bridge = rpc.call('consumeBridge', { delay: 10, requestId: 'PRIVATE_BRIDGE' });
      const secondTick = trace.beginTick(performance.now(), performance.now())!; trace.workerDone(secondTick);
      const second = rpc.callForTick(secondTick, 'commit', { delay: 0, userId: 'PRIVATE_USER' }).then(() => trace.tickCommitted(secondTick, 0));
      const admission = rpc.call('admission', { delay: 5, admissionId: 'PRIVATE_ADMISSION' });
      await Promise.all([first, bridge, second, admission]); trace.freezeOverload(1100, firstTick); trace.emit('confirmed');
      const report = JSON.parse(output[0]) as Report, ticks = report.rows.filter(row => row[column('kind')] === 1);
      const stores = report.rows.filter(row => row[column('kind')] === 2);
      expect(ticks.map(row => row[column('rpcSeq')])).toEqual([1, 3]);
      expect(stores.map(row => row[column('rpcSeq')])).toEqual([1, 2, 3, 4]);
      expect(report.freeze).toMatchObject({ triggerTickSeq: firstTick, triggerTickStatus: 'retained' });
      expect(report.freeze.seq).toBeGreaterThan(firstTick);
      expect(stores[2][column('ackUs')]).toBeLessThan(stores[0][column('ackUs')]);
      for (const tick of ticks) {
        const store = stores.find(row => row[column('rpcSeq')] === tick[column('rpcSeq')])!;
        expect(store[column('op')]).toBe(QA_STORE_OPERATIONS.indexOf('commit'));
        expect(store[column('receivedUs')]).toBeGreaterThanOrEqual(store[column('sentOrStartUs')]);
        expect(store[column('ackUs')]).toBeLessThanOrEqual(tick[column('commitEndUs')]);
      }
      expect(report.retained.completeFromStart).toBe(true); expect(output[0]).not.toContain('PRIVATE_');
    } finally { await rpc.stop(); trace.close(); }
  });

  it('freezes the exact cutoff before emit and never fills pending spans from late replies', () => {
    const fixture = controlled(), { trace } = fixture;
    const tick = trace.beginTick(0, 0)!, request = trace.storeSent('commit', 1, tick);
    fixture.at(1_500_000_000n); trace.freezeOverload(1200, tick); expect(fixture.output).toEqual([]);
    fixture.at(5_000_000_000n); trace.storeReplied(request, { receivedUs: 1, startedUs: 2, endedUs: 4_000_000, batchSeq: 1 }, false);
    trace.tickCommitted(tick, 0); expect(trace.storeSent('admission', 2)).toBeUndefined();
    trace.freezeOverload(9999); trace.emit('confirmed'); trace.close(); trace.emit('failed');
    expect(fixture.output).toHaveLength(1);
    expect(fixture.report().freeze).toEqual({ atUs: 1_500_000, seq: 2, backlogUs: 1_200_000,
      triggerTickSeq: tick, triggerTickStatus: 'retained', durablePause: 'confirmed' });
    expect(fixture.report().retained).toMatchObject({ incompleteRows: 2, completeFromStart: false });
    expect(fixture.report().rows[1][column('ackUs')]).toBe(-1);
  });

  it('bounds rows and bytes, identifies the evicted prefix and missing commit links, and exposes only the operation whitelist', () => {
    const fixture = controlled(), { trace } = fixture;
    const firstTick = trace.beginTick(0, 0)!; trace.workerDone(firstTick); trace.linkCommit(firstTick, 1); trace.tickCommitted(firstTick, 0);
    const first = trace.storeSent('PRIVATE_UNKNOWN_OPERATION', 1);
    // Large safe integer call/batch sequences exercise byte bounds while the
    // monotonic capture time stays within the real sixty-second limit.
    fixture.at(59_000_000_000n);
    for (let index = 0; index < QA_TRACE_ROWS + 20; index++) {
      const seq = trace.storeSent('commit', 9_000_000_000_000_000 - index);
      trace.storeReplied(seq, { receivedUs: fixture.nowUs(), startedUs: fixture.nowUs(), endedUs: fixture.nowUs(), batchSeq: 9_000_000_000_000_000 }, false);
    }
    trace.storeReplied(first, undefined, true);
    const tick = trace.beginTick(0, 0)!; trace.workerDone(tick); trace.linkCommit(tick, 1); trace.tickCommitted(tick, 0);
    trace.freezeOverload(1100, firstTick); trace.emit('confirmed'); const report = fixture.report();
    expect(Buffer.byteLength(fixture.output[0])).toBeLessThanOrEqual(QA_TRACE_BYTES);
    expect(report.retained.rows).toBeLessThanOrEqual(QA_TRACE_ROWS);
    expect(report.retained.droppedRows).toBe(23); expect(report.retained.truncatedRows).toBeGreaterThanOrEqual(0);
    expect(report.freeze).toMatchObject({ triggerTickSeq: firstTick, triggerTickStatus: 'unknown-evicted-or-truncated' });
    expect(report.retained.evictedUpdates).toBe(1); expect(report.retained.missingCommitSpans).toBe(1);
    expect(report.retained.completeFromStart).toBe(false); expect(fixture.output[0]).not.toContain('PRIVATE_');
    const seqs = report.rows.map(row => row[0]); expect(seqs.slice(1).every((seq, index) => seq === seqs[index] + 1)).toBe(true);
  });

  it('labels an empty expired window as unknown instead of an overload capture and emits once', async () => {
    vi.useFakeTimers(); const fixture = controlled(); fixture.at(60_000_000_000n);
    await vi.advanceTimersByTimeAsync(60_000); fixture.trace.freezeOverload(1100); fixture.trace.emit('confirmed'); fixture.trace.close();
    expect(fixture.output).toHaveLength(1); expect(fixture.report().scope).toBe('window-expired');
    expect(fixture.report().freeze.durablePause).toBe('not-applicable');
    expect(fixture.report().retained).toMatchObject({ rows: 0, completeFromStart: false });
  });

  it('rejects late records even if the sixty-second timer has not been dispatched', () => {
    const fixture = controlled(), seq = fixture.trace.storeSent('consumeBridge', 1);
    fixture.at(61_000_000_000n);
    fixture.trace.storeReplied(seq, { receivedUs: 1, startedUs: 2, endedUs: 60_500_000, batchSeq: 0 }, false);
    expect(fixture.trace.storeSent('admission', 2)).toBeUndefined();
    fixture.trace.freezeOverload(1100); fixture.trace.emit('confirmed');
    expect(fixture.report().scope).toBe('window-expired');
    expect(fixture.report().freeze).toMatchObject({ atUs: 60_000_000, seq: 1, durablePause: 'not-applicable' });
    expect(fixture.report().rows[0][column('ackUs')]).toBe(-1);
    expect(fixture.report().retained).toMatchObject({ incompleteRows: 1, completeFromStart: false });
  });

  it('omits invalid identity and span fields rather than serializing arbitrary strings', () => {
    enabled(); const output: string[] = [], trace = createQaTrace({ buildRevision: 'PRIVATE_REVISION', artifactId: 'PRIVATE_TOKEN' }, { write: value => output.push(value) })!;
    const seq = trace.storeSent('PRIVATE_OP', 1);
    trace.storeReplied(seq, { receivedUs: 'PRIVATE_ROOM', startedUs: NaN, endedUs: Infinity, batchSeq: 'PRIVATE_USER', payload: 'PRIVATE_WORLD' }, true);
    trace.freezeOverload(1100); trace.emit('failed');
    expect(output[0]).not.toContain('PRIVATE_'); expect(JSON.parse(output[0])).toMatchObject({ buildRevision: 'unknown', artifactId: 'unknown', freeze: { durablePause: 'failed' } });
  });
});
