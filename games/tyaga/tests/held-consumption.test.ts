import { describe, expect, it } from 'vitest';
import { NEUTRAL_INPUT } from '../src/core/config';
import { V } from '../src/core/math';
import { TyagaWorld } from '../src/server-world/world';
import { evidence } from './evidence';
import { observedWinchFixture, participants, steps } from './r04-fixtures';

describe('R05 held consumable lifetime', () => {
  it('finishes a strap attachment while holding that unit, then continues and restores the world', async () => {
    // Isolated observed-geometry fixture. This is a regression for R05/036,
    // not a browser journey or an expedition completion.
    const world = await observedWinchFixture(true);
    let restored: TyagaWorld | undefined;
    try {
      expect(world.action('alice', { type: 'grab', itemId: 'strap-11', handleId: 'handle-0' }).result.ok).toBe(true);
      steps(world, 100, 1);
      expect(world.state.characters.alice.holding?.itemId).toBe('strap-11');
      const started = world.action('alice', { type: 'attach', kind: 'strap', fromId: 'winch-1', fromSocket: 'base', toId: 'training-anchor', toSocket: 'ring', itemId: 'strap-11' });
      expect(started.result.code).toBe('STARTED');
      expect(() => steps(world, 180)).not.toThrow();
      const link = Object.values(world.state.links).find(candidate => candidate.itemId === 'strap-11');
      expect(link?.broken).toBe(false);
      expect(world.state.inventory['strap-11'].state).toBe('attached');
      expect(world.maybeBody('strap-11')).toBeNull();
      expect(world.state.characters.alice.holding).toBeNull();
      expect(world.view('alice').participants.find(participant => participant.participantId === 'alice')?.holding).toBeNull();
      restored = await TyagaWorld.restore(world.serialize());
      expect(restored.serialize()).toBe(world.serialize());
      for (let i = 0; i < 60; i++) {
        const input = { alice: { ...NEUTRAL_INPUT, moveX: -.2 } };
        world.step(input); restored.step(input);
      }
      expect(restored.serialize()).toBe(world.serialize());
      evidence('R05-held-strap-consumed', { started, link, holding: world.state.characters.alice.holding, tick: world.state.tick, events: world.state.events, deterministicReplay: true });
    } finally { restored?.dispose(); world.dispose(); }
  });

  it('keeps the held unit and grip when an attachment is cancelled before completion', async () => {
    const world = await observedWinchFixture(true);
    try {
      expect(world.action('alice', { type: 'grab', itemId: 'strap-11', handleId: 'handle-0' }).result.ok).toBe(true);
      steps(world, 100, 1);
      expect(world.action('alice', { type: 'attach', kind: 'strap', fromId: 'winch-1', fromSocket: 'base', toId: 'training-anchor', toSocket: 'ring', itemId: 'strap-11' }).result.code).toBe('STARTED');
      steps(world, 30);
      expect(world.state.characters.alice.holding?.itemId).toBe('strap-11');
      expect(world.action('alice', { type: 'cancel' }).result.ok).toBe(true);
      steps(world, 180);
      expect(world.state.inventory['strap-11'].state).toBe('world');
      expect(world.maybeBody('strap-11')).not.toBeNull();
      expect(world.state.characters.alice.holding?.itemId).toBe('strap-11');
      expect(Object.values(world.state.links).some(link => link.itemId === 'strap-11')).toBe(false);
    } finally { world.dispose(); }
  });

  it('also releases a held repair kit only when the repair consumes it', async () => {
    const world = await TyagaWorld.create({ matchId: 'R05-held-repair-regression', mapId: 'tutorial', participants });
    try {
      // Initial isolated fixture placement and damage; all subsequent unpack,
      // grab and repair operations use the normal authoritative actions.
      world.body('person:alice').setTranslation(V(12, .875, 20.1), true);
      world.state.entities.truck.integrity = 75;
      steps(world, 10);
      expect(world.action('alice', { type: 'unpack', itemId: 'repair-1', position: V(11.2, .3, 20.7), angle: 0 }).result.code).toBe('STARTED');
      steps(world, 75);
      expect(world.action('alice', { type: 'grab', itemId: 'repair-1', handleId: 'handle-0' }).result.ok).toBe(true);
      steps(world, 100, 1);
      expect(world.state.characters.alice.holding?.itemId).toBe('repair-1');
      expect(world.action('alice', { type: 'repair', targetId: 'truck', itemId: 'repair-1' }).result.code).toBe('STARTED');
      steps(world, 30);
      expect(world.state.characters.alice.holding?.itemId).toBe('repair-1');
      expect(() => steps(world, 400)).not.toThrow();
      expect(world.state.entities.truck.integrity).toBe(100);
      expect(world.state.inventory['repair-1'].state).toBe('destroyed');
      expect(world.maybeBody('repair-1')).toBeNull();
      expect(world.state.characters.alice.holding).toBeNull();
    } finally { world.dispose(); }
  });
});
