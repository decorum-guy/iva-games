import { readFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { describe, expect, it } from 'vitest';
import { BODY, NEUTRAL_INPUT, PHYSICS } from '../src/core/config';
import { add, clamp, distance, norm, Q, sub, V } from '../src/core/math';
import type { Vec3 } from '../src/core/types';
import { TyagaWorld } from '../src/server-world/world';
import { evidence } from './evidence';

type BoxPart = { id: string; center: [number, number, number]; halfExtents: [number, number, number] };
const manifest = JSON.parse(readFileSync(new URL('../public/assets/tyaga/models/manifest.json', import.meta.url), 'utf8')) as {
  assets: { assetId: string; collider: { parts?: BoxPart[] }; runtimeSockets?: Record<string, { local: [number, number, number] }> }[];
};
const stands = [
  { model: 'lift-control', id: 'lift-lower-control', origin: V(216, 10.8, 74), floor: 'lift-near-surface-2', floorY: 10,
    name: { ru: 'Нижний пульт подъёмника', en: 'Lower lift controls' }, start: V(214.5, 10.875, 73.2), approach: V(215.9, 10.875, 73.2) },
  { model: 'lift-transmission', id: 'lift-transmission', origin: V(222, 17.25, 69.3), floor: 'lift-top-foot-surface-2', floorY: 16,
    name: { ru: 'Приводная стойка подъёмника', en: 'Lift drive mounting stand' }, start: V(222, 16.875, 67.4), approach: V(222.1, 16.875, 68.25) },
] as const;
const participants = [
  { participantId: 'alice', displayName: 'Alice', seatIndex: 0, bot: false },
  { participantId: 'bob', displayName: 'Bob', seatIndex: 1, bot: false },
];
const vec = (value: readonly number[]) => V(value[0], value[1], value[2]);
const expectedParts = (model: string) => manifest.assets.find(asset => asset.assetId === model)!.collider.parts!;
const create = () => TyagaWorld.create({ matchId: 'lift-controls-isolated-fixture', mapId: 'ridge', mode: 'practice', participants });
function expectVector(actual: Vec3, expected: Vec3) {
  expect(actual.x).toBeCloseTo(expected.x, 5); expect(actual.y).toBeCloseTo(expected.y, 5); expect(actual.z).toBeCloseTo(expected.z, 5);
}
function setInitialPose(w: TyagaWorld, id: string, position: Vec3) {
  const body = w.body(id); body.setTranslation(position, true); body.setRotation(Q(), true); body.setLinvel(V(), true); body.setAngvel(V(), true);
}
function steps(w: TyagaWorld, count: number) { for (let i = 0; i < count; i++) w.step({ alice: NEUTRAL_INPUT }); }

describe('authored fixed lift stands (isolated physics; not route or browser acceptance)', () => {
  it.each(stands)('$model has real collision for each visible structural part and unchanged sockets', async stand => {
    const w = await create();
    try {
      const entity = w.state.entities[stand.id], body = w.body(stand.id), view = w.entityView(entity);
      const parts = expectedParts(stand.model);
      expect(body.isFixed()).toBe(true); expect(body.mass()).toBe(0); expect(entity.baseMass).toBe(BODY.ring.mass);
      expect(entity.size).toEqual(BODY.ring.size); expectVector(body.translation(), stand.origin);
      expect(view.model).toBe(stand.model); expect(view.name).toEqual(stand.name);
      expect(entity.colliders).toHaveLength(parts.length);
      const collisions = parts.map((part, index) => {
        const collider = w.physics.getCollider(entity.colliders[index]), center = vec(part.center), half = vec(part.halfExtents);
        expectVector(collider.translationWrtParent()!, center); expectVector(collider.halfExtents()!, half);
        expect(collider.mass()).toBe(0); expect(collider.friction()).toBeCloseTo(.55);
        expect(w.state.colliderMaterials[collider.handle]).toBe('steel'); expect(w.state.colliderBodies[collider.handle]).toBe(stand.id);
        const origin = w.bodyPoint(stand.id, add(center, V(-half.x - .1, 0, 0)));
        const hit = collider.castRay(new RAPIER.Ray(origin, V(1, 0, 0)), half.x * 2 + .2, true);
        // At world X≈222 m, Float32 ray coordinates have ~15 µm spacing.
        expect(Math.abs(hit - .1)).toBeLessThan(.00002);
        // A physical probe intersects every structural part, including the
        // formerly absent base/post/arm below or beside the old .4 m head.
        expect(collider.intersectsShape(new RAPIER.Ball(.01), w.bodyPoint(stand.id, center), Q())).toBe(true);
        return { part: part.id, rayEntry: hit, localCenter: collider.translationWrtParent(), halfExtents: collider.halfExtents() };
      });
      expectVector(w.physics.getCollider(entity.colliders[0]).halfExtents()!, V(.2, .2, .2));
      const sockets = manifest.assets.find(asset => asset.assetId === stand.model)!.runtimeSockets!;
      for (const [id, socket] of Object.entries(sockets)) {
        expectVector(w.socket(stand.id, id)!.local, vec(socket.local));
        expectVector(w.socket(stand.id, id)!.world, add(stand.origin, vec(socket.local)));
      }
      evidence(`lift-control-colliders-${stand.model}`, { collisions, view, sockets });
    } finally { w.dispose(); }
  });

  it.each(stands)('$model base rests on the actual authored road across its footprint', async stand => {
    const w = await create();
    try {
      const parts = expectedParts(stand.model), baseIndex = parts.findIndex(part => part.id === 'base');
      expect(w.state.entities[stand.id].colliders.length).toBeGreaterThan(baseIndex);
      const base = w.physics.getCollider(w.state.entities[stand.id].colliders[baseIndex]);
      const floorEntry = Object.entries(w.state.colliderBodies).find(([, id]) => id === `surface:${stand.floor}`)!;
      const floor = w.physics.getCollider(Number(floorEntry[0])), contact = base.contactCollider(floor, .001);
      expect(contact).not.toBeNull(); expect(Math.abs(contact!.distance)).toBeLessThan(.00001);
      const half = base.halfExtents()!, corners: unknown[] = [];
      for (const x of [-1, 1]) for (const z of [-1, 1]) {
        const center = base.translation(), origin = add(center, V(x * half.x, -half.y + .05, z * half.z));
        const hit = floor.castRay(new RAPIER.Ray(origin, V(0, -1, 0)), .1, true);
        expect(hit).toBeGreaterThan(0); expect(hit).toBeLessThan(.1);
        expect(origin.y - hit).toBeCloseTo(stand.floorY, 5);
        corners.push({ origin, hit, supportY: origin.y - hit });
      }
      evidence(`lift-control-floor-${stand.model}`, { floor: stand.floor, contact, corners });
    } finally { w.dispose(); }
  });

  it.each(stands)('$model leaves a real capsule approach and a reachable control', async stand => {
    const w = await create();
    try {
      // Only this initial local fixture places the actor near the stand. All
      // subsequent movement uses the ordinary character input and real floor.
      setInitialPose(w, 'person:alice', stand.start); w.physics.propagateModifiedBodyPositionsToColliders(); steps(w, 2);
      let reached = false;
      for (let tick = 0; tick < 240; tick++) {
        const p = w.body('person:alice').translation(), dx = stand.approach.x - p.x, dz = stand.approach.z - p.z, d = Math.hypot(dx, dz);
        if (d < .06) { reached = true; break; }
        const speed = clamp(d / .4, 0, .5);
        w.step({ alice: { ...NEUTRAL_INPUT, moveX: dx / d * speed, moveZ: dz / d * speed } });
        expect(w.state.characters.alice.rescueAt).toBeNull();
        expect(w.body('person:alice').translation().y).toBeGreaterThan(stand.floorY + .8);
      }
      steps(w, 15);
      const actor = w.body('person:alice'), reach = w.canReach('alice', stand.id, 'control');
      evidence(`lift-control-approach-${stand.model}`, { reached, actor: actor.translation(), reach, grounded: w.state.characters.alice.grounded });
      expect(reached).toBe(true); expect(w.state.characters.alice.grounded).toBe(true); expect(reach.code).toBe('OK');
      expect(w.action('alice', { type: 'operate', targetId: stand.id }).result.code).toBe('NO_DRIVE');
      const capsule = new RAPIER.Capsule((PHYSICS.characterHeight - PHYSICS.characterRadius * 2) / 2, PHYSICS.characterRadius);
      for (const handle of w.state.entities[stand.id].colliders) expect(w.physics.getCollider(handle).intersectsShape(capsule, actor.translation(), actor.rotation())).toBe(false);
    } finally { w.dispose(); }
  });

  it('aligns and installs the nearby drive using the timed action, retaining the compound and joint through recovery', async () => {
    const w = await create(); let restored: TyagaWorld | undefined;
    try {
      // Independently sweep the real drive shapes through the aligned mount
      // approach. The ordinary mating guide disables parent-body contacts;
      // this query proves the added supports do not rely on that exclusion.
      const driveStart = V(221.45, 16.7, 69.02), sweptSupports: unknown[] = [];
      for (const supportHandle of w.state.entities['lift-transmission'].colliders.slice(1)) {
        const support = w.physics.getCollider(supportHandle);
        for (const driveHandle of w.state.entities['lift-drive'].colliders) {
          const shape = w.physics.getCollider(driveHandle);
          const hit = support.castShape(V(), shape.shape, add(driveStart, shape.translationWrtParent()!), shape.rotationWrtParent()!, V(0, 0, .28), 0, 1, true);
          sweptSupports.push({ supportHandle, driveHandle, hit }); expect(hit).toBeNull();
        }
      }
      // Explicit initial fixture, not traversal: the ordinary two-second
      // operation must do all alignment after these initial pose assignments.
      setInitialPose(w, 'lift-drive', driveStart);
      // X=222.1 looked through the drive's real mounting clamp (collider 3).
      // This initial side approach remains on the existing 1.2 m walkway.
      setInitialPose(w, 'person:alice', V(222.3, 16.875, 68.25));
      w.physics.propagateModifiedBodyPositionsToColliders(); steps(w, 1);
      const chest = add(w.body('person:alice').translation(), V(0, .25, 0)), target = w.socket('lift-transmission', 'drive')!.world;
      const obstruction = w.physics.castRay(new RAPIER.Ray(chest, norm(sub(target, chest))), distance(chest, target) - .08, true, undefined, undefined, undefined, w.body('person:alice'), collider => w.state.colliderBodies[collider.handle] !== 'lift-transmission');
      const admission = { actor: { ...w.body('person:alice').translation() }, drive: { ...w.body('lift-drive').translation() }, handle: w.canReach('alice', 'lift-drive', 'handle-0'), target: w.canReach('alice', 'lift-transmission', 'drive'), gap: distance(w.socket('lift-drive', 'drive')!.world, w.socket('lift-transmission', 'drive')!.world), obstruction: obstruction ? { bodyId: w.state.colliderBodies[obstruction.collider.handle], colliderIndex: w.state.entities[w.state.colliderBodies[obstruction.collider.handle]]?.colliders.indexOf(obstruction.collider.handle), distance: obstruction.timeOfImpact } : null };
      const result = w.action('alice', { type: 'install-drive', itemId: 'lift-drive', targetId: 'lift-transmission' });
      evidence('lift-control-install-admission', { admission, sweptSupports, result });
      expect(admission.handle.code).toBe('OK'); expect(admission.target.code).toBe('OK'); expect(admission.gap).toBeGreaterThan(.2); expect(admission.gap).toBeLessThan(.3);
      expect(result.result.code).toBe('STARTED'); expect(w.state.machinery.lift!.driveId).toBeNull();
      expect(w.body('lift-drive').translation()).toEqual(admission.drive);
      let previous = { ...w.body('lift-drive').translation() }, maxStepDisplacement = 0;
      for (let tick = 0; tick < 60; tick++) {
        steps(w, 1); const p = { ...w.body('lift-drive').translation() };
        maxStepDisplacement = Math.max(maxStepDisplacement, distance(previous, p)); previous = p;
      }
      expect(w.state.machinery.lift!.driveId).toBeNull(); expect(w.state.operations.alice.action.type).toBe('install-drive');
      const snapshot = w.serialize(); restored = await TyagaWorld.restore(snapshot); expect(restored.serialize()).toBe(snapshot);
      for (let tick = 0; tick < 195; tick++) { steps(w, 1); steps(restored, 1); }
      expect(restored.serialize()).toBe(w.serialize());
      const installed = w.state.machinery.lift!, link = w.state.links['drive-lift-drive'];
      const gap = distance(w.socket('lift-drive', 'drive')!.world, w.socket('lift-transmission', 'drive')!.world);
      evidence('lift-control-install-recovery', { admission, maxStepDisplacement, gap, installed, link, drive: w.entityView(w.state.entities['lift-drive']), operations: w.state.operations, events: w.state.events });
      expect(maxStepDisplacement).toBeGreaterThan(.001); expect(maxStepDisplacement).toBeLessThan(.04);
      expect(installed.driveId).toBe('lift-drive'); expect(installed.driveJoint).not.toBeNull(); expect(link.broken).toBe(false);
      expect(w.state.inventory['lift-drive'].state).toBe('attached'); expect(w.state.operations.alice).toBeUndefined();
      expect(w.state.events.some(event => event.type === 'drive-installed' && event.entityId === 'lift-drive')).toBe(true);
      expect(w.state.events.some(event => event.type === 'operation-failed' || event.type === 'operation-cancelled')).toBe(false);
      expect(gap).toBeLessThan(.005); expect(w.body('lift-drive').mass()).toBeCloseTo(40, 4);
      for (const stand of stands) { expect(w.body(stand.id).isFixed()).toBe(true); expectVector(w.body(stand.id).translation(), stand.origin); }
    } finally { restored?.dispose(); w.dispose(); }
  });
});
