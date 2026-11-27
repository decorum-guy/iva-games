import { suggestAction } from './search';
import type { GameState } from '../core';

self.addEventListener('message', (event: MessageEvent<{ requestId: string; revision: number; state: GameState }>) => {
  const { requestId, revision, state } = event.data;
  try { self.postMessage({ requestId, revision, result: suggestAction(state) }); }
  catch { self.postMessage({ requestId, revision, error: 'hint-unavailable' }); }
});
