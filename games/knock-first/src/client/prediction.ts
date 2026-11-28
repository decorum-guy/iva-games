import { floorAt } from '../core/level';
import { distanceXZ, moveCapsule, pointInLift } from '../core/geometry';
import type { KnockLevel, PlayerView, Vec3 } from '../core/types';
import type { KnockControlInput } from './sceneTypes';

/** Presentation prediction uses static geometry and only permitted PlayerView actors. */
export function predictPlayerPosition(level: KnockLevel, view: PlayerView, input: KnockControlInput, age: number): Vec3 {
  const self = view.self;
  if (self.carrying || self.status === 'returning') return { ...self.position };
  const speed = self.status === 'downed' ? 0.65 : input.quiet ? 1.55 : input.run && self.stamina > 0 ? 4.45 : 2.9;
  const x = Math.cos(input.yaw) * input.moveX - Math.sin(input.yaw) * input.moveZ;
  const z = -Math.sin(input.yaw) * input.moveX - Math.cos(input.yaw) * input.moveZ;
  const surface = floorAt(level, self.position.x, self.position.z);
  const pace = speed * (input.moveZ < 0 ? 0.78 : 1) * (surface?.material === 'water' ? 0.9 : 1);
  const elapsed = Math.max(0, Math.min(0.14, age));
  const next = moveCapsule(level, view.doors, self.position, x * pace * elapsed, z * pace * elapsed);
  if (view.phase === 'preparation' && !pointInLift(level, next)) return { ...self.position };
  const blocked = view.actors.some(actor => actor.status !== 'returning' && Math.abs(actor.position.y - next.y) < 1 &&
    distanceXZ(actor.position, next) < 0.54 && distanceXZ(actor.position, self.position) >= distanceXZ(actor.position, next));
  return blocked ? { ...self.position } : next;
}
