import { Buffer } from 'node:buffer';
import type { SavedWorld } from './state';

/** Encodes the existing schema-1 envelope for the game's plain JSON state. */
export function createSnapshotEncoder<State extends object>(physicsBuildHash: string) {
  const header = { schema: 1, physicsBuildHash } satisfies Pick<SavedWorld, 'schema' | 'physicsBuildHash'>;
  const prefix = JSON.stringify(header).slice(0, -1) + ',"physics":"';
  return (bytes: Uint8Array, state: State): string => {
    // Rapier returns an owned snapshot. This view avoids another binary copy;
    // base64 is materialized now and cannot retain a mutable physics buffer.
    const physics = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
    // Buffer's base64 alphabet needs no JSON escaping. Keep the exact field
    // order/bytes while avoiding a second scan of this large encoded string.
    return prefix + physics + '","state":' + JSON.stringify(state) + '}';
  };
}
