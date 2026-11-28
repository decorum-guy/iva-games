import { Worker } from 'node:worker_threads';
import type { QaTrace } from './qa-trace.js';
export class WorkerRpc {
  private next = 0;
  private pending = new Map<number, { resolve(value: unknown): void; reject(reason: Error): void; timer: ReturnType<typeof setTimeout>; qaSeq?: number }>();
  readonly worker: Worker;
  constructor(url: URL, workerData?: unknown, private readonly qaTrace?: QaTrace) {
    if (qaTrace) workerData = { ...(workerData && typeof workerData === 'object' ? workerData : {}), qaTrace: qaTrace.workerData() };
    this.worker = new Worker(url, { workerData });
    this.worker.on('message', (reply: {id: number; value?: unknown; error?: string; qaSpan?: unknown}) => {
      const task = this.pending.get(reply.id); if (!task) return;
      this.qaTrace?.storeReplied(task.qaSeq, reply.qaSpan, reply.error !== undefined);
      clearTimeout(task.timer); this.pending.delete(reply.id);
      if (reply.error) task.reject(new Error(reply.error)); else task.resolve(reply.value);
    });
    const fail = () => { for (const task of this.pending.values()) {
      this.qaTrace?.storeReplied(task.qaSeq, undefined, true); clearTimeout(task.timer); task.reject(new Error('WORKER_UNAVAILABLE'));
    } this.pending.clear(); };
    this.worker.on('error', fail); this.worker.on('exit', fail);
  }
  call<T>(op: string, ...args: unknown[]): Promise<T> {
    return this.request(op, args);
  }
  callForTick<T>(tickTraceSeq: number, op: string, ...args: unknown[]): Promise<T> {
    return this.request(op, args, tickTraceSeq);
  }
  private request<T>(op: string, args: unknown[], tickTraceSeq?: number): Promise<T> {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const qaSeq = this.qaTrace?.storeSent(op, id, tickTraceSeq);
      const timer = setTimeout(() => { this.qaTrace?.storeReplied(qaSeq, undefined, true); this.pending.delete(id); reject(new Error('WORKER_DEADLINE')); }, 5000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer, ...(qaSeq === undefined ? {} : { qaSeq }) });
      this.worker.postMessage({ id, op, args });
    });
  }
  async stop(): Promise<void> { await this.worker.terminate(); }
}
