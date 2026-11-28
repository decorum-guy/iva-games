import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { restoreRigPose, solveArmGrip, solveCarryStance, solvePalmGrip } from '../src/client/rig';

interface GltfNode { name?: string; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }
interface GltfAccessor { bufferView: number; byteOffset?: number; count: number; type: string; componentType: number }
interface GltfAnimation { name: string; samplers: { input: number; output: number; interpolation?: string }[]; channels: { sampler: number; target: { node: number; path: 'translation' | 'rotation' | 'scale' } }[] }
interface GltfFile { nodes: GltfNode[]; scenes: { nodes: number[] }[]; scene?: number; accessors: GltfAccessor[]; bufferViews: { byteOffset?: number; byteStride?: number }[]; animations: GltfAnimation[] }

/** Read actual exported joints and animation channels. No GPU, DOM or simulated rendered frames. */
function actualCarryRig(name: 'arms' | 'operative'): THREE.Group {
  const bytes = readFileSync(new URL(`../public/knock-first/models/${name}.glb`, import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const file = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString()) as GltfFile;
  const binary = bytes.subarray(28 + jsonLength);
  const nodes = file.nodes.map(node => {
    const object = new THREE.Object3D(); object.name = node.name ?? '';
    if (node.matrix) new THREE.Matrix4().fromArray(node.matrix).decompose(object.position, object.quaternion, object.scale);
    else {
      if (node.translation) object.position.fromArray(node.translation);
      if (node.rotation) object.quaternion.fromArray(node.rotation);
      if (node.scale) object.scale.fromArray(node.scale);
    }
    return object;
  });
  file.nodes.forEach((node, index) => { for (const child of node.children ?? []) nodes[index].add(nodes[child]); });
  const root = new THREE.Group();
  for (const node of file.scenes[file.scene ?? 0].nodes) root.add(nodes[node]);
  const values = (index: number): number[] => {
    const accessor = file.accessors[index], view = file.bufferViews[accessor.bufferView];
    if (accessor.componentType !== 5126) throw new Error('Expected exported float animation');
    const size = accessor.type === 'VEC4' ? 4 : accessor.type === 'VEC3' ? 3 : 1;
    const stride = view.byteStride ?? size * 4, start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    return Array.from({ length: accessor.count * size }, (_, i) => binary.readFloatLE(start + Math.floor(i / size) * stride + i % size * 4));
  };
  const carry = file.animations.find(animation => animation.name === 'carry')!;
  const tracks = carry.channels.map(channel => {
    const sampler = carry.samplers[channel.sampler], path = channel.target.path === 'translation' ? 'position' : channel.target.path === 'rotation' ? 'quaternion' : 'scale';
    const name = `${nodes[channel.target.node].uuid}.${path}`, times = values(sampler.input), output = values(sampler.output);
    const interpolation = sampler.interpolation === 'STEP' ? THREE.InterpolateDiscrete : THREE.InterpolateLinear;
    return path === 'quaternion' ? new THREE.QuaternionKeyframeTrack(name, times, output, interpolation) : new THREE.VectorKeyframeTrack(name, times, output, interpolation);
  });
  const mixer = new THREE.AnimationMixer(root); mixer.clipAction(new THREE.AnimationClip('carry', -1, tracks)).play(); mixer.setTime(0.5); root.updateWorldMatrix(true, true);
  return root;
}

describe('actual GLB handle reach (CPU joint transforms)', () => {
  for (const name of ['arms', 'operative'] as const) it(`${name}: both grips reach level handles at eight yaws and three ramp offsets`, () => {
    for (const angle of [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, -Math.PI / 4, -Math.PI / 2, -3 * Math.PI / 4]) for (const handle of [0, 1]) for (const uphill of [-0.31, 0, 0.31]) {
      const root = actualCarryRig(name), yaw = angle + (handle === 0 ? -Math.PI / 2 : Math.PI / 2);
      const battery = new THREE.Vector3(3, 2.6, -7), side = handle === 0 ? -1 : 1;
      const feet = battery.clone().add(new THREE.Vector3(side * 0.93 * Math.cos(angle), uphill, -side * 0.93 * Math.sin(angle)));
      const parent = new THREE.Group(); parent.position.copy(feet); parent.rotation.y = yaw; parent.add(root);
      if (name === 'arms') {
        parent.position.y = Math.min(feet.y, battery.y) + 1.48;
        parent.position.add(new THREE.Vector3(-Math.sin(yaw) * 0.03, 0, -Math.cos(yaw) * 0.03));
      }
      parent.updateWorldMatrix(true, true);
      if (name === 'operative') solveCarryStance(root, Math.max(0, uphill));
      const center = battery.clone().add(new THREE.Vector3(side * 0.62 * Math.cos(angle), 0.65, -side * 0.62 * Math.sin(angle)));
      const crossbar = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(handle === 0 ? 0.11 : -0.11);
      for (const arm of ['left', 'right'] as const) {
        const target = center.clone().addScaledVector(crossbar, arm === 'left' ? -1 : 1);
        const orientation=parent.getWorldQuaternion(new THREE.Quaternion());
        const chain=['upper_arm','forearm','hand'].map(bone=>root.getObjectByName(`${arm}_${bone}`)!);
        const lengths=[chain[0].getWorldPosition(new THREE.Vector3()).distanceTo(chain[1].getWorldPosition(new THREE.Vector3())),chain[1].getWorldPosition(new THREE.Vector3()).distanceTo(chain[2].getWorldPosition(new THREE.Vector3()))];
        if(name==='arms')expect(solvePalmGrip(root,arm,target,orientation)).toBe(true);else solveArmGrip(root, arm, target);
        root.updateWorldMatrix(true, true);
        for(const i of [0,1])expect(chain[i].getWorldPosition(new THREE.Vector3()).distanceTo(chain[i+1].getWorldPosition(new THREE.Vector3()))).toBeCloseTo(lengths[i],6);
        if(name==='arms')expect(root.getObjectByName(arm==='left'?'PalmGrip_L':'PalmGrip_R')!.getWorldQuaternion(new THREE.Quaternion()).angleTo(orientation)).toBeLessThan(.00001);
        const wrist = root.getObjectByName(name==='arms'?(arm==='left'?'PalmGrip_L':'PalmGrip_R'):`${arm}_hand`)!.getWorldPosition(new THREE.Vector3());
        expect(wrist.distanceTo(target), `${name} ${arm}, yaw=${angle}, handle=${handle}, floorDelta=${uphill}`).toBeLessThan(0.005);
      }
      if (name === 'operative') for (const leg of ['left', 'right']) expect(root.getObjectByName(`${leg}_foot`)!.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(feet.y + 0.105, 3);
    }
  });

  it('120 procedural stance frames do not accumulate pelvis or ankle drift', () => {
    const root = actualCarryRig('operative');
    const pelvis = root.getObjectByName('pelvis')!, original = pelvis.position.clone();
    const ankles = ['left_foot', 'right_foot'].map(name => root.getObjectByName(name)!.getWorldPosition(new THREE.Vector3()));
    for (let frame = 0; frame < 120; frame++) {
      restoreRigPose(root); solveCarryStance(root, 0.31); root.updateWorldMatrix(true, true);
      for (const [index, name] of ['left_foot', 'right_foot'].entries()) expect(root.getObjectByName(name)!.getWorldPosition(new THREE.Vector3()).distanceTo(ankles[index])).toBeLessThan(0.005);
    }
    restoreRigPose(root); expect(pelvis.position.distanceTo(original)).toBeLessThan(0.000001);
  });
});
