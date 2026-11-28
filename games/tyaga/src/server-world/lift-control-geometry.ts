import RAPIER from '@dimforge/rapier3d-compat';

export type LiftControlModel = 'lift-control' | 'lift-transmission';
export type LiftControlPart = {
  readonly id: string;
  readonly center: readonly [number, number, number];
  readonly halfExtents: readonly [number, number, number];
};

/** Fixed structural boxes authored in lift-control.glb / lift-transmission.glb.
 * Origins stay at their canonical ports. The .4 m mating/control head is
 * unchanged; the supports reach the real lower road and upper foot walkway. */
export const LIFT_CONTROL_COLLIDER_PARTS: Readonly<Record<LiftControlModel, readonly LiftControlPart[]>> = {
  'lift-control': [
    { id: 'head', center: [0, 0, 0], halfExtents: [.2, .2, .2] },
    { id: 'base', center: [0, -.77, -.16], halfExtents: [.16, .03, .14] },
    { id: 'post', center: [0, -.46, -.12], halfExtents: [.03, .28, .03] },
  ],
  'lift-transmission': [
    { id: 'head', center: [0, 0, 0], halfExtents: [.2, .2, .2] },
    { id: 'base', center: [.5, -1.22, -.12], halfExtents: [.08, .03, .14] },
    { id: 'post', center: [.5, -.665, -.12], halfExtents: [.04, .525, .04] },
    { id: 'support-arm', center: [.315, -.17, -.12], halfExtents: [.225, .03, .04] },
  ],
};

export function liftControlParts(model: LiftControlModel): RAPIER.ColliderDesc[] {
  return LIFT_CONTROL_COLLIDER_PARTS[model].map(part => RAPIER.ColliderDesc.cuboid(...part.halfExtents).setTranslation(...part.center));
}
