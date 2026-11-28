import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import RAPIER from '@dimforge/rapier3d-compat';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { BODY, NEUTRAL_INPUT } from '../src/core/config';
import { add, clamp, distance, length, norm, Q, rotate, sub, V, worldPoint, yawQuat } from '../src/core/math';
import type { Quat, Vec3 } from '../src/core/types';
import { TyagaWorld } from '../src/server-world/world';
import { ANCHOR_COLLIDER_PARTS, ANCHOR_MODEL_SHA256 } from '../src/server-world/anchor-geometry';
import { evidence } from './evidence';
import { observedWinchFixture } from './r04-fixtures';

const participants = [
  { participantId: 'alice', displayName: 'Alice', seatIndex: 0, bot: false },
  { participantId: 'bob', displayName: 'Bob', seatIndex: 1, bot: false },
];
const anchorPose = {
  position: V(24.059791564941406, .424968957901001, 14.004790306091309),
  rotation: { x: -1.908167064357258e-7, y: -.0008288730168715119, z: 1.1917782316572811e-8, w: .9999997019767761 },
};
const winchPose = {
  position: V(22.505407333374023, .2749137878417969, 14.863752365112305),
  rotation: { x: -3.878911769561455e-8, y: -.6392459869384766, z: -9.56348555902764e-10, w: .7690023183822632 },
};
const strapPose = {
  position: V(22.25464630126953, .06989386677742004, 17.34083366394043),
  rotation: { x: .6468991637229919, y: .2855241298675537, z: -.2855209708213806, w: .6468966603279114 },
};

/** Read the actual authored GLB hierarchy, independently of runtime constants. */
function authoredSocket(name: string): Vec3 {
  const bytes = readFileSync(new URL('../public/assets/tyaga/models/anchor.glb', import.meta.url));
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()) as {
    scene: number; scenes: { nodes: number[] }[];
    nodes: { name?: string; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  };
  let found: Vec3 | undefined;
  function visit(index: number, parent: Matrix4) {
    const node = gltf.nodes[index];
    const local = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(
      new Vector3().fromArray(node.translation ?? [0, 0, 0]),
      new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
      new Vector3().fromArray(node.scale ?? [1, 1, 1]),
    );
    const matrix = parent.clone().multiply(local);
    if (node.name === name) {
      const point = new Vector3().setFromMatrixPosition(matrix);
      found = V(point.x, point.y, point.z);
    }
    for (const child of node.children ?? []) visit(child, matrix);
  }
  for (const index of gltf.scenes[gltf.scene].nodes) visit(index, new Matrix4());
  if (!found) throw new Error(`Missing authored anchor node: ${name}`);
  return found;
}

function setPose(w: TyagaWorld, id: string, position: Vec3, rotation: Quat = Q()) {
  const body = w.body(id);
  body.setTranslation(position, true); body.setRotation(rotation, true);
  body.setLinvel(V(), true); body.setAngvel(V(), true);
}
function steps(w: TyagaWorld, count: number) {
  for (let tick = 0; tick < count; tick++) w.step();
}
function anchorHits(w: TyagaWorld, from: Vec3, to: Vec3) {
  w.physics.propagateModifiedBodyPositionsToColliders();
  const ray = new RAPIER.Ray(from, norm(sub(to, from))), maximum = distance(from, to);
  return w.state.entities['training-anchor'].colliders.flatMap(handle => {
    const hit = w.physics.getCollider(handle).castRay(ray, maximum, true);
    return hit < 0 ? [] : [{ handle, distance: hit }];
  });
}

/** Initial geometry reproduces R05 capture 031. Its anchor was already installed.
 * Only fixture construction assigns transforms/state. Actions and later motion
 * use normal game code. This is not an ordinary browser or route completion.
 * The reverse-order variant brings the loose strap and actor within reach;
 * the anchor/winch poses and their obstructed segment are the same. */
async function observedFixture(reverse = false) {
  const w = await TyagaWorld.create({ matchId: 'R05-anchor-geometry', mapId: 'tutorial', participants });
  setPose(w, 'training-anchor', anchorPose.position, anchorPose.rotation);
  const anchor = w.state.entities['training-anchor'];
  anchor.anchored = true; anchor.fixed = true; anchor.anchorLimit = 22000;
  w.body('training-anchor').setBodyType(RAPIER.RigidBodyType.Fixed, true);
  for (const [id, kind, pose] of [['winch-1', 'winch', winchPose], ['strap-11', 'strap', strapPose]] as const) {
    const item = w.state.inventory[id]; item.state = 'world'; item.bodyId = id;
    w.addBody({ id, kind, position: pose.position, rotation: pose.rotation });
  }
  setPose(w, 'person:alice', reverse ? V(23.35, .8749491572380066, 15.15) : V(22.643583297729492, .8749491572380066, 16.033905029296875));
  if (reverse) setPose(w, 'strap-11', V(23.6, .06989386677742004, 16.15), strapPose.rotation);
  w.updateMasses(); w.physics.propagateModifiedBodyPositionsToColliders();
  return w;
}

describe('R05 anchor geometry (isolated regression; not browser acceptance)', () => {
  it('keeps the baked collision vertices, mass and bounds aligned with the authored asset contract', () => {
    const authored = JSON.parse(readFileSync(new URL('../art/source/anchor-collider.json', import.meta.url), 'utf8')) as {
      geometrySourceSha256: string; massKg: number; dimensionsXYZ: number[];
      collider: { parts: { id: string; vertices: number[]; volumeM3: number }[] };
    };
    const bytes = readFileSync(new URL('../public/assets/tyaga/models/anchor.glb', import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(ANCHOR_MODEL_SHA256);
    expect(authored.geometrySourceSha256).toBe(ANCHOR_MODEL_SHA256);
    expect(ANCHOR_COLLIDER_PARTS).toEqual(authored.collider.parts.map(({ id, vertices, volumeM3 }) => ({ id, vertices, volumeM3 })));
    expect(authored.massKg).toBe(BODY.anchor.mass);
    expect(authored.dimensionsXYZ).toEqual([BODY.anchor.size.x, BODY.anchor.size.y, BODY.anchor.size.z]);
    for (const axis of [0, 1, 2]) {
      const coordinates = ANCHOR_COLLIDER_PARTS.flatMap(part => part.vertices.filter((_, index) => index % 3 === axis));
      expect(Math.min(...coordinates)).toBeCloseTo(-authored.dimensionsXYZ[axis] / 2, 6);
      expect(Math.max(...coordinates)).toBeCloseTo(authored.dimensionsXYZ[axis] / 2, 6);
    }
  });

  it('places the runtime ring and carry handle at their actual authored GLB nodes', async () => {
    const w = await TyagaWorld.create({ matchId: 'anchor-sockets', mapId: 'tutorial', participants });
    try {
      expect(w.socket('training-anchor', 'ring')!.local).toEqual(authoredSocket('socket-anchor'));
      expect(w.socket('training-anchor', 'handle-0')!.local).toEqual(authoredSocket('handle-anchor'));
      expect(w.state.entities['training-anchor'].size).toEqual(BODY.anchor.size);
      expect(w.body('training-anchor').mass()).toBeCloseTo(12, 4);
    } finally { w.dispose(); }
  });

  it('does not fill the clear R05 strap segment with the anchor bounding box', async () => {
    const w = await observedFixture();
    try {
      const from = w.socket('winch-1', 'base')!.world;
      const recordedEndpoint = worldPoint(anchorPose.position, anchorPose.rotation, V(0, .35, 0));
      const visibleEndpoint = worldPoint(anchorPose.position, anchorPose.rotation, authoredSocket('socket-anchor'));
      const recordedHits = anchorHits(w, from, recordedEndpoint), visibleHits = anchorHits(w, from, visibleEndpoint);
      evidence('R05-anchor-false-box', { from, recordedEndpoint, visibleEndpoint, recordedHits, visibleHits });
      expect(recordedHits).toEqual([]); expect(visibleHits).toEqual([]);
    } finally { w.dispose(); }
  });

  it('leaves the front eye hole open while retaining the solid shoulder and shaft', async () => {
    const w = await observedFixture();
    try {
      const eye = authoredSocket('socket-anchor');
      const castLocal = (from: Vec3, to: Vec3) => anchorHits(w, w.bodyPoint('training-anchor', from), w.bodyPoint('training-anchor', to));
      // The shoulder genuinely exists behind the eye. Only the exposed front
      // hole must be clear, not a ray through the entire body behind it.
      const hole = castLocal(V(eye.x, eye.y, .0735), V(eye.x, eye.y, .15));
      const shoulder = castLocal(V(eye.x, eye.y, -.2), V(eye.x, eye.y, .2));
      const shaft = castLocal(V(-.2, -.3, 0), V(.2, -.3, 0));
      const rim = castLocal(V(.09, eye.y, .0735), V(.09, eye.y, .15));
      evidence('R05-anchor-solid-and-hole', { hole, shoulder, shaft, rim });
      expect(hole).toEqual([]); expect(shoulder.length).toBeGreaterThan(0);
      expect(shaft.length).toBeGreaterThan(0); expect(rim.length).toBeGreaterThan(0);
    } finally { w.dispose(); }
  });

  it.each([false, true])('completes the R05 winch-to-anchor strap, including anchor as source: reverse=%s', async reverse => {
    const w = await observedFixture(reverse);
    try {
      steps(w, 2);
      const before = Object.keys(w.state.links).length;
      const result = w.action('alice', {
        type: 'attach', kind: 'strap', itemId: 'strap-11',
        fromId: reverse ? 'training-anchor' : 'winch-1', fromSocket: reverse ? 'ring' : 'base',
        toId: reverse ? 'winch-1' : 'training-anchor', toSocket: reverse ? 'base' : 'ring',
      });
      evidence(`R05-anchor-strap-admission-${reverse}`, { result, from: w.socket(reverse ? 'training-anchor' : 'winch-1', reverse ? 'ring' : 'base'), to: w.socket(reverse ? 'winch-1' : 'training-anchor', reverse ? 'base' : 'ring') });
      expect(result.result.code).toBe('STARTED');
      steps(w, 125);
      const links = Object.values(w.state.links).filter(link => link.itemId === 'strap-11' && !link.broken);
      evidence(`R05-anchor-strap-completion-${reverse}`, { links, events: w.state.events, operations: w.state.operations });
      expect(links).toHaveLength(1); expect(Object.keys(w.state.links)).toHaveLength(before + 1);
      expect(w.state.inventory['strap-11'].state).toBe('attached');
      expect(w.state.entities['strap-11'].active).toBe(false);
      expect(w.state.operations.alice).toBeUndefined();
    } finally { w.dispose(); }
  });

  it.each([false, true])('rejects the literal old R04 rearward shoulder path in either order: reverse=%s', async reverse => {
    const w = await observedWinchFixture(false, false);
    try {
      const from = w.socket('training-anchor', 'ring')!.world, to = w.socket('winch-1', 'base')!.world;
      const hits = anchorHits(w, from, to);
      expect(hits.length).toBeGreaterThan(0);
      const result = w.action('alice', {
        type: 'attach', kind: 'strap', itemId: 'strap-11',
        fromId: reverse ? 'training-anchor' : 'winch-1', fromSocket: reverse ? 'ring' : 'base',
        toId: reverse ? 'winch-1' : 'training-anchor', toSocket: reverse ? 'base' : 'ring',
      });
      evidence(`R05-anchor-old-R04-shoulder-${reverse}`, { from, to, hits, result });
      expect(result.result.code).toBe('STRAP_BLOCKED');
      expect(w.state.inventory['strap-11'].state).toBe('world');
      expect(w.state.operations.alice).toBeUndefined();
      expect(Object.values(w.state.links).some(link => link.itemId === 'strap-11')).toBe(false);
    } finally { w.dispose(); }
  });

  it.each([false, true])('checks the same real anchor parts for a rope target: throughShoulder=%s', async throughShoulder => {
    const w = await observedFixture();
    try {
      // A fixed test support places a real winch outlet toward the chosen
      // target. This isolates the anchor endpoint rule from source housing.
      const from = w.bodyPoint('training-anchor', throughShoulder ? V(-1.65, .05, -.45) : V(0, .05, 1.85));
      const to = w.socket('training-anchor', 'ring')!.world, delta = sub(to, from);
      const rotation = yawQuat(-Math.atan2(delta.z, delta.x));
      const position = sub(from, rotate(rotation, V(.35, .1, 0)));
      w.addBody({ id: 'anchor-test-winch', kind: 'winch', position, rotation, fixed: true });
      setPose(w, 'person:alice', add(from, V(.7, .4, 0)));
      steps(w, 2);
      const result = w.action('alice', { type: 'attach', kind: 'rope', fromId: 'anchor-test-winch', fromSocket: 'drum', toId: 'training-anchor', toSocket: 'ring' });
      evidence(`R05-anchor-rope-target-${throughShoulder}`, { from, to, hits: anchorHits(w, from, to), result });
      expect(result.result.code).toBe(throughShoulder ? 'ROPE_BLOCKED' : 'STARTED');
      if (throughShoulder) {
        expect(w.state.operations.alice).toBeUndefined();
        expect(Object.values(w.state.links).some(link => link.kind === 'rope')).toBe(false);
      } else {
        steps(w, 65);
        expect(Object.values(w.state.links).filter(link => link.kind === 'rope' && !link.broken)).toHaveLength(1);
      }
    } finally { w.dispose(); }
  });

  it('rejects a strap crossing the real anchor shaft instead of ignoring anchor bodies', async () => {
    const w = await observedFixture();
    try {
      const height = anchorPose.position.y - .3;
      w.addBody({ id: 'shaft-left', kind: 'ring', position: V(anchorPose.position.x - .65, height, anchorPose.position.z), size: V(.02, .02, .02), fixed: true });
      w.addBody({ id: 'shaft-right', kind: 'ring', position: V(anchorPose.position.x + .65, height, anchorPose.position.z), size: V(.02, .02, .02), fixed: true });
      setPose(w, 'person:alice', add(anchorPose.position, V(-.55, .45, .95)));
      setPose(w, 'strap-11', add(anchorPose.position, V(-.65, -.35, 1.2)), strapPose.rotation);
      steps(w, 2);
      const result = w.action('alice', { type: 'attach', kind: 'strap', itemId: 'strap-11', fromId: 'shaft-left', fromSocket: 'ring', toId: 'shaft-right', toSocket: 'ring' });
      evidence('R05-anchor-shaft-blocked', { result, hits: anchorHits(w, w.socket('shaft-left', 'ring')!.world, w.socket('shaft-right', 'ring')!.world) });
      expect(result.result.code).toBe('STRAP_BLOCKED');
      expect(w.state.inventory['strap-11'].state).toBe('world');
      expect(w.state.operations.alice).toBeUndefined();
      expect(Object.values(w.state.links).some(link => link.itemId === 'strap-11')).toBe(false);
    } finally { w.dispose(); }
  });

  it('installs on soil through the timed action and preserves the stable installed compound across recovery', async () => {
    const w = await TyagaWorld.create({ matchId: 'anchor-install-recovery', mapId: 'tutorial', participants });
    let restored: TyagaWorld | undefined;
    try {
      // Initial isolated fixture only. No transform write follows installation.
      setPose(w, 'training-anchor', anchorPose.position, anchorPose.rotation);
      setPose(w, 'person:alice', V(23.6, .875, 15.1));
      steps(w, 2);
      const result = w.action('alice', { type: 'anchor', itemId: 'training-anchor' });
      expect(result.result.code).toBe('STARTED'); steps(w, 185);
      expect(w.state.entities['training-anchor'].anchored).toBe(true);
      expect(w.body('training-anchor').isFixed()).toBe(true);
      expect(w.state.events.some(event => event.type === 'anchor-installed')).toBe(true);
      const position = { ...w.body('training-anchor').translation() }, rotation = { ...w.body('training-anchor').rotation() };
      const snapshot = w.serialize(); restored = await TyagaWorld.restore(snapshot);
      expect(restored.serialize()).toBe(snapshot);
      for (let tick = 0; tick < 90; tick++) {
        const inputs = { alice: { ...NEUTRAL_INPUT, moveX: clamp(Math.sin(tick / 30), -.3, .3) } };
        w.step(inputs); restored.step(inputs);
      }
      expect(restored.serialize()).toBe(w.serialize());
      expect(w.body('training-anchor').translation()).toEqual(position);
      expect(w.body('training-anchor').rotation()).toEqual(rotation);
      expect(length(w.body('training-anchor').linvel())).toBe(0);
      for (const handle of w.state.entities['training-anchor'].colliders) {
        expect(w.state.colliderMaterials[handle]).toBe('steel');
        expect(w.physics.getCollider(handle).friction()).toBeCloseTo(.55);
      }
      evidence('R05-anchor-install-recovery', { result, position, rotation, colliderCount: w.state.entities['training-anchor'].colliders.length, events: w.state.events });
    } finally { restored?.dispose(); w.dispose(); }
  });
});
