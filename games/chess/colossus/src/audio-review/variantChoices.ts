import type { Localized } from '../core';
import { armorVictory, wardBlock } from './cues';
import type { Moment } from './cues';
import manifest from './variants/manifest.json';
import armourA from './variants/armour-a.wav?url';
import armourB from './variants/armour-b.wav?url';
import armourC from './variants/armour-c.wav?url';
import shieldA from './variants/shield-a.wav?url';
import shieldB from './variants/shield-b.wav?url';
import shieldC from './variants/shield-c.wav?url';

export type ReviewSound = 'armour' | 'shield';
type Take = 'A' | 'B' | 'C';
export interface Variant {
  id: string;
  title: Localized;
  description: Localized;
  take?: Take;
  url?: string;
  sha256?: string;
}
export interface Comparison {
  sound: ReviewSound;
  moment: Moment;
  description: Localized;
  variants: Variant[];
}

function clip(id: keyof typeof manifest, take: Take, url: string, title: Localized, description: Localized): Variant {
  return { id, take, url, title, description, sha256: manifest[id].sha256 };
}

const current: Variant = {
  id: 'current',
  title: { ru: 'Текущий звук', en: 'Current sound' },
  description: { ru: 'Для сравнения.', en: 'For comparison.' },
};

export const comparisons: Comparison[] = [
  {
    sound: 'armour', moment: armorVictory,
    description: { ru: 'Сравни попадание отдельно и в связке с разрушением брони.', en: 'Compare the impact on its own and as the armor breaks.' },
    variants: [
      current,
      clip('armour-a', 'A', armourA, { ru: 'Круглый щит', en: 'Round shield' },
        { ru: 'Прямое попадание в металлическую пластину с коротким звоном.', en: 'Direct impact on a metal plate with a short ring.' }),
      clip('armour-b', 'B', armourB, { ru: 'Сталь и дерево', en: 'Steel and wood' },
        { ru: 'Тяжёлый деревянный удар и дребезг обода.', en: 'A heavy wooden hit with a rattling rim.' }),
      clip('armour-c', 'C', armourC, { ru: 'Скользящий удар', en: 'Glancing strike' },
        { ru: 'Резкий контакт и короткий металлический отскок.', en: 'A sharp contact with a brief metallic rebound.' }),
    ],
  },
  {
    sound: 'shield', moment: wardBlock,
    description: { ru: 'Сравни, как звучит защита, когда она поглощает урон.', en: 'Compare how the defense sounds when it absorbs a hit.' },
    variants: [
      current,
      clip('shield-a', 'A', shieldA, { ru: 'Мягкий блок', en: 'Soft block' },
        { ru: 'Приглушённый удар с коротким выдохом.', en: 'A padded impact and a short breath.' }),
      clip('shield-b', 'B', shieldB, { ru: 'Каменная преграда', en: 'Stone barrier' },
        { ru: 'Плотный низкий отклик, который быстро затихает.', en: 'A dense low response that dies away quickly.' }),
      clip('shield-c', 'C', shieldC, { ru: 'Оберег', en: 'Ward' },
        { ru: 'Мягкий удар с коротким стеклянным отголоском.', en: 'A soft impact with a brief glassy aftertone.' }),
    ],
  },
];
