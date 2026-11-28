import { createGame } from '../core';
import type { GameEvent, Localized } from '../core';
import type { SoundContext, SoundName } from '../ui/audio';

export type Group = 'army' | 'battle' | 'cards';
export const cueGroups: Group[] = ['army', 'battle', 'cards'];

export const cues = {
  move: { group: 'army', ru: 'Ход фигуры', en: 'Piece move' },
  capture: { group: 'army', ru: 'Гибель фигуры', en: 'Piece falls' },
  'promotion-minor': { group: 'army', ru: 'Превращение в коня или слона', en: 'Promotion to knight or bishop' },
  'promotion-rook': { group: 'army', ru: 'Превращение в ладью', en: 'Promotion to rook' },
  'promotion-queen': { group: 'army', ru: 'Превращение в ферзя', en: 'Promotion to queen' },
  'boss-move': { group: 'battle', ru: 'Движение босса', en: 'Boss moves' },
  telegraph: { group: 'battle', ru: 'Новое намерение босса', en: 'New boss intent' },
  armour: { group: 'battle', ru: 'Удар по броне', en: 'Armor hit' },
  'armor-break': { group: 'battle', ru: 'Разрушение брони', en: 'Armor breaks' },
  stone: { group: 'battle', ru: 'Удар по боссу без брони', en: 'Hit on an exposed boss' },
  wound: { group: 'battle', ru: 'Ранение фигуры', en: 'Piece takes damage' },
  shield: { group: 'battle', ru: 'Щит или неуязвимость', en: 'Shield or invulnerability' },
  fire: { group: 'battle', ru: 'Огонь', en: 'Fire' },
  card: { group: 'cards', ru: 'Розыгрыш карты', en: 'Card played' },
  heal: { group: 'cards', ru: 'Лечение или привал', en: 'Healing or camp' },
  victory: { group: 'cards', ru: 'Победа', en: 'Victory' },
  defeat: { group: 'cards', ru: 'Поражение', en: 'Defeat' },
} as const satisfies Record<SoundName, Localized & { group: Group }>;

export interface Moment { id: string; title: Localized; events: GameEvent[]; details?: SoundContext }

function promotion(key: 'N' | 'R' | 'Q', title: Localized): Moment {
  return { id: 'promotion-' + key, title, events: [{ type: 'move', unitId: 'pawn-c' }, { type: 'promote', key }] };
}

const beforeBreak = createGame({ seed: 'colossus-audio-review' });
const afterBreak = { ...beforeBreak, boss: { ...beforeBreak.boss, armor: 0 } };

export const moments: Moment[] = [
  promotion('N', { ru: 'Ход и превращение в коня или слона', en: 'Move and promote to knight or bishop' }),
  promotion('R', { ru: 'Ход и превращение в ладью', en: 'Move and promote to rook' }),
  promotion('Q', { ru: 'Ход и превращение в ферзя', en: 'Move and promote to queen' }),
  {
    id: 'ward',
    title: { ru: 'Карта и срабатывание щита', en: 'Card play and a shield block' },
    events: [{ type: 'card' }, { type: 'damage', amount: 0, absorbed: 2 }, { type: 'round' }],
  },
  {
    id: 'charge',
    title: { ru: 'Таран и гибель фигуры', en: 'Boss charge and a fallen piece' },
    events: [{ type: 'move', unitId: 'boss' }, { type: 'damage', amount: 2 }, { type: 'death' }, { type: 'round' }],
  },
  {
    id: 'armor-victory',
    title: { ru: 'Пробитие брони и победа', en: 'Armor breaks and the army wins' },
    events: [{ type: 'attack', armor: 1, hp: 3 }, { type: 'victory' }],
    details: { before: beforeBreak, after: afterBreak },
  },
  {
    id: 'fire-defeat',
    title: { ru: 'Огонь и поражение', en: 'Fire and defeat' },
    events: [{ type: 'fire' }, { type: 'damage', amount: 1 }, { type: 'death' }, { type: 'defeat' }],
  },
];
