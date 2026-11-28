import type { Commit } from './store.js';
import type { QaStoreClock, QaStoreSpan } from './qa-trace.js';

export interface StoreRequest { id: number; op: string; args: unknown[] }
export interface StoreReply { id: number; value?: unknown; error?: string; qaSpan?: QaStoreSpan }

/** Keeps RPC arrival order and acknowledges only after the batch transaction. */
export class StoreQueue {
  private readonly queue: (StoreRequest & { queuedAt: number; qaReceivedUs?: number })[] = [];
  private scheduled = false;
  private qaBatchSeq = 0;
  constructor(private readonly execute: (request: StoreRequest) => unknown,
    private readonly commit: (values: Commit[]) => { error?: string }[], private readonly reply: (reply: StoreReply) => void,
    private readonly metadata?: () => Record<string, unknown>, private readonly observeQueue?: (milliseconds: number) => void,
    private readonly qaClock?: QaStoreClock) {}

  enqueue(request: StoreRequest): void {
    this.queue.push({ ...request, queuedAt: performance.now(), ...(this.qaClock ? { qaReceivedUs: this.qaClock.nowUs() } : {}) });
    if (!this.scheduled) { this.scheduled = true; setTimeout(() => { void this.flush(); }, 2); }
  }
  private async flush(): Promise<void> {
    const work = this.queue.splice(0, 64);
    for (let i = 0; i < work.length;) {
      const request = work[i];
      if (request.op !== 'commit') {
        this.observeQueue?.(performance.now() - request.queuedAt);
        const startedUs = this.qaClock?.nowUs();
        try {
          const value = this.execute(request);
          const completed = value instanceof Promise ? await value : value;
          this.reply({ id: request.id, value: completed, ...this.span(request.qaReceivedUs, startedUs, this.qaClock?.nowUs(), 0) });
        }
        catch (error) { this.reply({ id: request.id, error: error instanceof Error ? error.message : 'STORE_FAILED',
          ...this.span(request.qaReceivedUs, startedUs, this.qaClock?.nowUs(), 0) }); }
        i++; continue;
      }
      const group: (StoreRequest & { qaReceivedUs?: number })[] = [];
      while (i < work.length && work[i].op === 'commit' && group.length < 32) {
        this.observeQueue?.(performance.now() - work[i].queuedAt); group.push(work[i++]);
      }
      const startedUs = this.qaClock?.nowUs(), batchSeq = this.qaClock ? ++this.qaBatchSeq : 0;
      try {
        const results = this.commit(group.map(item => item.args[0] as Commit));
        const endedUs = this.qaClock?.nowUs();
        for (const [index, item] of group.entries()) this.reply({ id: item.id, value: { batchSize: group.length, ...this.metadata?.() }, ...results[index],
          ...this.span(item.qaReceivedUs, startedUs, endedUs, batchSeq) });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'STORE_FAILED';
        const endedUs = this.qaClock?.nowUs();
        for (const item of group) this.reply({ id: item.id, error: message, ...this.span(item.qaReceivedUs, startedUs, endedUs, batchSeq) });
      }
    }
    if (this.queue.length) setImmediate(() => { void this.flush(); });
    else this.scheduled = false;
  }
  private span(receivedUs: number | undefined, startedUs: number | undefined, endedUs: number | undefined, batchSeq: number) {
    return receivedUs === undefined || startedUs === undefined || endedUs === undefined ? {}
      : { qaSpan: { receivedUs, startedUs, endedUs, batchSeq } };
  }
}
