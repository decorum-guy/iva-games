import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { NEUTRAL_INPUT } from '../src/core/config';
import { createSnapshotEncoder } from '../src/server-world/snapshot-encoding';
import { PHYSICS_BUILD_HASH, TyagaWorld } from '../src/server-world/world';

// The prior schema encoder is the compatibility oracle, not another copy of
// the new framing algorithm. Existing journal hashes cover these exact bytes.
const legacy = (physicsBuildHash: string, physics: Uint8Array, state: object) => JSON.stringify({
  schema: 1, physicsBuildHash, physics: Buffer.from(physics).toString('base64'), state,
});
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe('schema-1 snapshot byte compatibility', () => {
  it.each([0, 1, 2, 3, 255, 256, 257, 8193])('preserves %i bytes, base64 padding and a nonzero view offset', size => {
    const backing = new Uint8Array(size + 19).fill(0xa5);
    const bytes = backing.subarray(7, size + 7);
    for (let index = 0; index < size; index++) bytes[index] = index % 256;
    const state = { schema: 1, tick: 17, nested: { value: true } };
    const expected = legacy(PHYSICS_BUILD_HASH, bytes, state);
    const actual = createSnapshotEncoder<typeof state>(PHYSICS_BUILD_HASH)(bytes, state);
    expect(actual).toBe(expected);
    expect(hash(actual)).toBe(hash(expected));
    expect(Buffer.from(JSON.parse(actual).physics, 'base64')).toEqual(Buffer.from(bytes));
    expect(backing.subarray(0, 7)).toEqual(new Uint8Array(7).fill(0xa5));
    expect(backing.subarray(size + 7)).toEqual(new Uint8Array(12).fill(0xa5));
    bytes.fill(0);
    expect(actual).toBe(expected);
  });

  it('preserves Unicode, control escaping, optional fields and property order', () => {
    const text = 'Тяга "quoted" \\ path 💡 ' + String.fromCharCode(0, 9, 10, 13, 0x2028, 0x2029, 0xd800);
    const state = { schema: 1, text, omitted: undefined, values: [null, false, -0, undefined], nested: { 9: 'nine', 2: 'two', first: text } };
    const build = 'escaped "hash" \\ ' + String.fromCharCode(10);
    const bytes = Uint8Array.of(0, 34, 92, 255);
    const expected = legacy(build, bytes, state);
    const actual = createSnapshotEncoder<typeof state>(build)(bytes, state);
    expect(actual).toBe(expected);
    expect(hash(actual)).toBe(hash(expected));
    expect(JSON.parse(actual).state.text).toBe(text);
    expect(Object.keys(JSON.parse(actual))).toEqual(['schema', 'physicsBuildHash', 'physics', 'state']);
  });

  it('preserves a real Rapier world, legacy restoration and subsequent deterministic replay', async () => {
    const participants = Array.from({ length: 6 }, (_, seatIndex) => ({
      participantId: `p${seatIndex}`, displayName: `Тяга "${seatIndex}" 💡`, seatIndex, bot: seatIndex > 0,
    }));
    const world = await TyagaWorld.create({ matchId: 'snapshot-encoding', mapId: 'ridge', mode: 'practice', participants });
    let oldReader: TyagaWorld | undefined, newReader: TyagaWorld | undefined;
    try {
      for (let tick = 0; tick < 67; tick++) world.step({ p0: { ...NEUTRAL_INPUT, moveX: .4, moveZ: .2 } });
      const previousBytes = legacy(PHYSICS_BUILD_HASH, world.physics.takeSnapshot(), world.state);
      const currentBytes = world.serialize();
      expect(currentBytes).toBe(previousBytes);
      expect(hash(currentBytes)).toBe(hash(previousBytes));
      oldReader = await TyagaWorld.restore(previousBytes);
      newReader = await TyagaWorld.restore(currentBytes);
      expect(oldReader.serialize()).toBe(previousBytes);
      expect(newReader.serialize()).toBe(previousBytes);
      for (let tick = 0; tick < 18; tick++) {
        const inputs = { p0: { ...NEUTRAL_INPUT, moveX: tick < 9 ? -.3 : .2, moveZ: .1 } };
        world.step(inputs); oldReader.step(inputs); newReader.step(inputs);
      }
      const replayed = world.serialize();
      expect(oldReader.serialize()).toBe(replayed);
      expect(newReader.serialize()).toBe(replayed);
      expect(replayed).toBe(legacy(PHYSICS_BUILD_HASH, world.physics.takeSnapshot(), world.state));
    } finally { oldReader?.dispose(); newReader?.dispose(); world.dispose(); }
  });
});
