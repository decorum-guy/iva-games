import { getLevel } from '../core/level';
import type { Locale, PlayerView, Vec3 } from '../core/types';

/** Training guidance uses public geometry and this participant's permitted view only. */
export function lessonGuidance(view: PlayerView, language: Locale): { label: string; rotation: number } | null {
  if (!view.tutorial || view.tutorial.completed) return null;
  const level = getLevel(view.levelId), self = view.self.position;
  const distance = (point: Vec3) => Math.hypot(point.x - self.x, point.z - self.z);
  let target: Vec3 | undefined, name = '';
  const step = view.tutorial.step;
  if (step === 2 || step === 9) {
    const pipes = level.resonators.filter(pipe => view.discoveredZones.includes(pipe.zoneId)
      && (step !== 2 || pipe.zoneId === level.safeZoneId));
    target = [...pipes].sort((a, b) => distance(a.position) - distance(b.position))[0]?.position;
    name = language === 'ru' ? 'Труба' : 'Pipe';
  } else if (step === 3) {
    target = level.portals.find(portal => portal.door && portal.initiallyClosed)?.position;
    name = language === 'ru' ? 'Дверь' : 'Door';
  } else if (step === 4) {
    target = level.zones.find(zone => zone.id === 'T')?.center;
    name = language === 'ru' ? 'За дверью' : 'Through the door';
  } else if (step === 5 && !view.self.carrying) {
    target = [...view.batteries].filter(battery => !battery.installed)
      .sort((a, b) => distance(a.position) - distance(b.position))[0]?.position;
    name = language === 'ru' ? 'Батарея' : 'Battery';
    if (!target) {
      const sector = level.zones.find(zone => zone.id === 'T');
      target = sector?.center;
      name = sector?.name[language] ?? name;
    }
  } else if (step === 7) {
    target = view.actors.find(actor => actor.status === 'downed')?.position;
    name = language === 'ru' ? 'Напарник' : 'Partner';
  }
  if (!target) return null;
  const dx = target.x - self.x, dz = target.z - self.z, yaw = view.self.yaw;
  const forward = -Math.sin(yaw) * dx - Math.cos(yaw) * dz;
  const right = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
  const angle = Math.atan2(right, forward), sector = (Math.round(angle / (Math.PI / 4)) + 8) % 8;
  const directions = language === 'ru'
    ? ['впереди', 'впереди справа', 'справа', 'позади справа', 'позади', 'позади слева', 'слева', 'впереди слева']
    : ['ahead', 'ahead right', 'right', 'behind right', 'behind', 'behind left', 'left', 'ahead left'];
  return { label: name + ' · ' + (distance(target) < 0.9 ? language === 'ru' ? 'рядом' : 'nearby' : directions[sector]),
    rotation: angle * 180 / Math.PI };
}
