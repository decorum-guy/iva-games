import { parentPort, workerData } from 'node:worker_threads';
import { RealtimeStore } from './store.js';
import type { StoredMatch, StoredStart } from './store.js';
import { StoreQueue } from './store-queue.js';
const store = new RealtimeStore((workerData as {path: string}).path);
const queue = new StoreQueue(message => {
    const a = message.args;
    let value: unknown;
    switch (message.op) {
      case 'status': value = store.status(); break;
      case 'list': value = store.list(); break;
      case 'get': value = store.get(a[0] as string); break;
      case 'byStart': value = store.byStart(a[0] as string); break;
      case 'create': value = store.create(a[0] as StoredMatch, a[1] as string, a[2] as string | undefined); break;
      case 'acquire': value = store.acquire(a[0] as string, a[1] as string); break;
      case 'starts': value = store.starts(); break;
      case 'enqueueStart': value = store.enqueueStart(a[0] as Pick<StoredStart, 'startId' | 'hostId' | 'fingerprint' | 'requestJson'>); break;
      case 'reserveStart': value = store.reserveStart(a[0] as string, a[1] as string, a[2] as string, a[3] as string); break;
      case 'releaseStart': value = store.releaseStart(a[0] as string, a[1] as string, a[2] as string); break;
      case 'cancelStart': value = store.cancelStart(a[0] as string, a[1] as string); break;
      case 'receipt': value = store.receipt(a[0] as string, a[1] as string); break;
      case 'consumeTicket': value = store.consumeTicket(a[0] as string, a[1] as number); break;
      case 'consumeBridge': value = store.consumeBridge(a[0] as string); break;
      case 'admission': value = store.admission(a[0] as string, a[1] as string, a[2] as number); break;
      case 'checkAdmission': value = store.checkAdmission(a[0] as string, a[1] as string); break;
      case 'revoke': value = store.revoke(a[0] as string); break;
      case 'release': value = store.release(a[0] as string); break;
      case 'outbox': value = store.outbox(); break;
      case 'delivered': value = store.delivered(a[0] as string, a[1] as string); break;
      case 'close': value = store.close(); break;
      default: throw new Error('UNKNOWN_STORE_OPERATION');
    }
    return value;
}, values => store.commitBatch(values), reply => parentPort!.postMessage(reply));
parentPort!.on('message', message => queue.enqueue(message));
