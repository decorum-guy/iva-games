import * as THREE from 'three';

type BonePose = { position: THREE.Vector3; quaternion: THREE.Quaternion };
const overrides = new WeakMap<THREE.Object3D, Map<THREE.Object3D, BonePose>>();

function remember(root: THREE.Object3D, bones: THREE.Object3D[]): void {
  const saved = overrides.get(root) ?? new Map<THREE.Object3D, BonePose>();
  for (const bone of bones) if (!saved.has(bone)) saved.set(bone, { position: bone.position.clone(), quaternion: bone.quaternion.clone() });
  overrides.set(root, saved);
}

/** Restore last frame before AnimationMixer runs, including constant STEP channels. */
export function restoreRigPose(root: THREE.Object3D): void {
  const saved = overrides.get(root); if (!saved) return;
  for (const [bone, pose] of saved) { bone.position.copy(pose.position); bone.quaternion.copy(pose.quaternion); }
  overrides.delete(root);
}

function rotateBone(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3): void {
  const start = bone.getWorldPosition(new THREE.Vector3());
  const current = child.getWorldPosition(new THREE.Vector3()).sub(start).normalize();
  const wanted = target.clone().sub(start).normalize();
  const delta = new THREE.Quaternion().setFromUnitVectors(current, wanted);
  const rotation = delta.multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  if (bone.parent) rotation.premultiply(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
  bone.quaternion.copy(rotation);
}

function solveTwoBone(root: THREE.Object3D, upper: THREE.Object3D, fore: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3): void {
  remember(root, [upper, fore]);
  root.updateWorldMatrix(true, true);
  const start = upper.getWorldPosition(new THREE.Vector3()), elbow = fore.getWorldPosition(new THREE.Vector3()), wrist = end.getWorldPosition(new THREE.Vector3());
  const a = start.distanceTo(elbow), b = elbow.distanceTo(wrist); if (a < 0.01 || b < 0.01) return;
  const direction = target.clone().sub(start); const distance = Math.max(0.02, Math.min(direction.length(), a + b - 0.001)); direction.normalize();
  const along = (a * a - b * b + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, a * a - along * along));
  const bend = pole.applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())).projectOnPlane(direction).normalize();
  const goalElbow = start.clone().addScaledVector(direction, along).addScaledVector(bend, height);
  rotateBone(upper, fore, goalElbow); root.updateWorldMatrix(true, true); rotateBone(fore, end, target);
}

/** Rotate the authored shoulder/elbow chain, preserving segment lengths and hand skinning. */
export function solveArmGrip(root: THREE.Object3D, side: 'left' | 'right', target: THREE.Vector3, orientation?: THREE.Quaternion): void {
  const upper = root.getObjectByName(`${side}_upper_arm`), fore = root.getObjectByName(`${side}_forearm`), hand = root.getObjectByName(`${side}_hand`);
  if (upper && fore && hand) {
    if(orientation) remember(root,[hand]);
    solveTwoBone(root, upper, fore, hand, target, new THREE.Vector3(side === 'left' ? -0.5 : 0.5, -1, 0));
    if(orientation && hand.parent){root.updateWorldMatrix(true,true);hand.quaternion.copy(hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(orientation));}
  }
}

/** Match a physical palm contact frame, not merely the wrist joint. */
export function solvePalmGrip(root: THREE.Object3D, side: 'left'|'right', target: THREE.Vector3, orientation: THREE.Quaternion): boolean {
  const grip=root.getObjectByName(side==='left'?'PalmGrip_L':'PalmGrip_R');
  const hand=root.getObjectByName(`${side}_hand`);
  if(!grip || !hand || grip.parent!==hand) return false;
  const handOrientation=orientation.clone().multiply(grip.quaternion.clone().invert());
  const wrist=target.clone().sub(grip.position.clone().applyQuaternion(handOrientation));
  solveArmGrip(root,side,wrist,handOrientation);root.updateWorldMatrix(true,true);
  return true;
}

/** The uphill carrier crouches to the level handles; knees bend while boots stay on the floor. */
export function solveCarryStance(root: THREE.Object3D, lowering: number, ankleHeight?: (position: THREE.Vector3) => number): void {
  const pelvis = root.getObjectByName('pelvis'); if (!pelvis || !pelvis.parent) return;
  root.updateWorldMatrix(true, true);
  const legs = (['left', 'right'] as const).flatMap(side => {
    const thigh = root.getObjectByName(`${side}_thigh`), shin = root.getObjectByName(`${side}_shin`), foot = root.getObjectByName(`${side}_foot`);
    if (!thigh || !shin || !foot) return [];
    const target = foot.getWorldPosition(new THREE.Vector3()); if (ankleHeight) target.y = ankleHeight(target);
    return [{ thigh, shin, foot, target, orientation: foot.getWorldQuaternion(new THREE.Quaternion()) }];
  });
  remember(root, [pelvis, ...legs.map(leg => leg.foot)]);
  const target = pelvis.getWorldPosition(new THREE.Vector3()); target.y -= Math.max(0, Math.min(0.4, lowering));
  pelvis.position.copy(pelvis.parent.worldToLocal(target)); root.updateWorldMatrix(true, true);
  for (const leg of legs) {
    solveTwoBone(root, leg.thigh, leg.shin, leg.foot, leg.target, new THREE.Vector3(0, 0, -1));
    const parentRotation = leg.foot.parent!.getWorldQuaternion(new THREE.Quaternion());
    leg.foot.quaternion.copy(parentRotation.invert().multiply(leg.orientation));
  }
}

/** Bring the actual tool face to a permitted surface; fingers retain their grasp. */
export function solveToolContact(root: THREE.Object3D, tool: THREE.Object3D, target: THREE.Vector3, normal: THREE.Vector3, amount: number): void {
  const hand = root.getObjectByName('right_hand'), upper = root.getObjectByName('right_upper_arm');
  const fore = root.getObjectByName('right_forearm'), tip = tool.getObjectByName('StrikeTip'), rear = tool.getObjectByName('StrikeRear');
  if (!hand || !upper || !fore || !tip || !rear || amount <= 0) return;
  root.updateWorldMatrix(true, true);
  const tipWorld = tip.getWorldPosition(new THREE.Vector3());
  const axis = tipWorld.clone().sub(rear.getWorldPosition(new THREE.Vector3())).normalize();
  const handOrientation = hand.getWorldQuaternion(new THREE.Quaternion());
  const facing = new THREE.Quaternion().setFromUnitVectors(axis, normal.clone().negate()).multiply(handOrientation);
  const orientation = handOrientation.clone().slerp(facing, amount);
  const localTip = hand.worldToLocal(tipWorld.clone());
  const wrist = tipWorld.lerp(target, amount).sub(localTip.applyQuaternion(orientation));
  const shoulder = upper.getWorldPosition(new THREE.Vector3());
  const reach = shoulder.distanceTo(fore.getWorldPosition(new THREE.Vector3())) + fore.getWorldPosition(new THREE.Vector3()).distanceTo(hand.getWorldPosition(new THREE.Vector3()));
  const toward = wrist.clone().sub(shoulder);
  // A small clavicle/body lean, preserving both arm segment lengths. No camera
  // or authoritative player movement is introduced to make the contact reach.
  const lean = Math.min(.34, Math.max(0, toward.length() - reach + .002));
  if (lean > 0 && upper.parent) {
    remember(root, [upper]);
    upper.position.copy(upper.parent.worldToLocal(shoulder.addScaledVector(toward.normalize(), lean)));
    root.updateWorldMatrix(true, true);
  }
  solveArmGrip(root, 'right', wrist, orientation);
  root.updateWorldMatrix(true, true);
}
