import type { BossCardDefinition, BossDefinition, BossId, CardDefinition, CardId, Difficulty, HuntBossId, Localized, UnitType } from './types';

export const UNIT_HP: Record<UnitType, number> = { K: 20, Q: 6, R: 4, B: 3, N: 3, P: 2 };
export const UNIT_STRIKES = {
  K: { damage: 1, range: 1 },
  Q: { damage: 3, range: 3 },
  R: { damage: 3, range: 3, removeArmor: 1 },
  B: { damage: 2, range: 4, exposedDamage: 3 },
  N: { damage: 2 },
  P: { damage: 2 },
} as const;
export const UNIT_NAMES: Record<UnitType, Localized> = {
  K: { ru: 'Король', en: 'King' }, Q: { ru: 'Ферзь', en: 'Queen' },
  R: { ru: 'Ладья', en: 'Rook' }, B: { ru: 'Слон', en: 'Bishop' },
  N: { ru: 'Конь', en: 'Knight' }, P: { ru: 'Пешка', en: 'Pawn' },
};
export const DIFFICULTIES: Record<Difficulty, { name: Localized; numerator: number; denominator: number; commands: number }> = {
  initiate: { name: { ru: 'Посвящение', en: 'Initiation' }, numerator: 4, denominator: 5, commands: 4 },
  knight: { name: { ru: 'Рыцарь', en: 'Knight' }, numerator: 1, denominator: 1, commands: 3 },
  veteran: { name: { ru: 'Ветеран', en: 'Veteran' }, numerator: 23, denominator: 20, commands: 3 },
  abyss: { name: { ru: 'Бездна', en: 'Abyss' }, numerator: 27, denominator: 20, commands: 3 },
};
export const BOSSES: Record<BossId, BossDefinition> = {
  regent: { id: 'regent', name: { ru: 'Каменный Регент', en: 'The Stone Regent' }, description: { ru: 'Таран, лучи и круговой удар.', en: 'Charges, rays and a surrounding shockwave.' }, width: 2, height: 2, anchor: 43, armor: 12, hp: 28 },
  spire: { id: 'spire', name: { ru: 'Шпиль', en: 'The Spire' }, description: { ru: 'Рывки, насечки и прыжки.', en: 'Dashes, slashes and leaps.' }, width: 1, height: 1, anchor: 44, armor: 6, hp: 24 },
  archivist: { id: 'archivist', name: { ru: 'Пепельный Архивариус', en: 'The Ash Archivist' }, description: { ru: 'Огонь по линиям и прыжки двухклеточного тела.', en: 'Burning lines and a leaping two-square body.' }, width: 1, height: 2, anchor: 43, armor: 8, hp: 24 },
  sentinel: { id: 'sentinel', name: { ru: 'Смотритель', en: 'The Warden' }, description: { ru: 'Учебный страж для первых ходов.', en: 'A training guardian for your first moves.' }, width: 2, height: 2, anchor: 43, armor: 4, hp: 12, tutorialOnly: true },
};
/** The public roster is derived once, so every menu can share the same boundary. */
export const HUNT_BOSSES: HuntBossId[] = Object.values(BOSSES).filter(b => !b.tutorialOnly).map(b => b.id as HuntBossId);

const card = (id: CardId, ru: string, en: string, descriptionRu: string, descriptionEn: string,
  rarity: CardDefinition['rarity'], cost: number, target: CardDefinition['target'], maxTargets = 1): CardDefinition =>
  ({ id, name: { ru, en }, description: { ru: descriptionRu, en: descriptionEn }, rarity, cost, icon: id, target, maxTargets });

export const CARD_LIST: CardDefinition[] = [
  card('bandage', 'Перевязка', 'Bandage', 'Восстановить 2 HP живой фигуре, кроме короля.', 'Restore 2 HP to a living non-king piece.', 'common', 1, 'unit'),
  card('stone-skin', 'Каменная кожа', 'Stone Skin', 'Щит 2 одной фигуре на ближайший ответ босса.', 'Shield 2 for one piece through the next boss response.', 'common', 1, 'unit'),
  card('sharp-edge', 'Острый край', 'Sharp Edge', 'Готовой фигуре: +1 урона к следующему удару в этом раунде.', 'A ready piece’s next strike this round deals +1 damage.', 'common', 1, 'unit'),
  card('armor-tip', 'Бронебойный наконечник', 'Armor-Piercing Tip', 'После следующего удара готовой фигуры в этом раунде снять ещё до 2 брони.', 'After a ready piece’s next strike this round, remove up to 2 remaining armor.', 'common', 1, 'unit'),
  card('focus', 'Сосредоточение', 'Concentration', 'Фокус +2, максимум 5. Использует карту раунда.', 'Gain 2 focus, up to 5. Uses this round’s card play.', 'common', 0, 'none', 0),
  card('reposition', 'Перестроение', 'Reposition', 'Переместить готовую фигуру, кроме короля, на свободную клетку по стороне. Это её действие на раунд.', 'Move a ready non-king piece to an empty orthogonal neighbor. Uses its action this round.', 'common', 1, 'move'),
  card('swap', 'Смена караула', 'Changing the Guard', 'Поменять местами двух готовых соседей по стороне. Это действие обеих фигур на раунд.', 'Swap two ready, orthogonally adjacent pieces. Uses both pieces’ actions this round.', 'rare', 2, 'swap', 2),
  card('minor-vow', 'Малый обет', 'Lesser Vow', 'Неуязвимость одной фигуре на ближайший ответ босса.', 'One piece is invulnerable through the next boss response.', 'rare', 3, 'unit'),
  card('hospital', 'Полевой лазарет', 'Field Hospital', 'Восстановить по 2 HP для 1–2 живых фигур, кроме короля.', 'Restore 2 HP each to 1–2 living non-king pieces.', 'rare', 2, 'units', 2),
  card('hunt-mark', 'Метка охоты', 'Hunt Mark', 'Следующие три удара разных фигур: +1 урона в этом раунде.', 'The next three strikes by different pieces deal +1 damage this round.', 'rare', 2, 'none', 0),
  card('wedge', 'Клин между плит', 'Wedge Between Plates', 'Снять до 4 брони босса.', 'Remove up to 4 boss armor.', 'rare', 2, 'boss', 0),
  card('formation', 'Несокрушимый строй', 'Unbroken Formation', 'Щит 3 для 1–3 фигур, кроме короля, на ближайший ответ босса.', 'Shield 3 for 1–3 non-king pieces through the next boss response.', 'epic', 4, 'units', 3),
  card('disrupt', 'Сбой ритма', 'Break the Rhythm', 'Отменить одну атаку в намерении: лучи, удар по площади или новый огонь.', 'Cancel one attack in the current intent: rays, an area strike or new fire.', 'epic', 4, 'intent', 0),
  card('counterorder', 'Контрприказ', 'Counterorder', 'Ещё одна команда для готовой фигуры в этом раунде.', 'Gain one command for a ready piece this round.', 'epic', 3, 'none', 0),
  card('marble-vow', 'Мраморный обет', 'Marble Vow', 'Неуязвимость одной фигуре на два ответа босса.', 'One piece is invulnerable through two boss responses.', 'legendary', 5, 'unit'),
  card('shell-break', 'Разрыв панциря', 'Shatter the Shell', 'Снять до 8 брони. По боссу с нулевой бронёй — 4 урона в HP.', 'Remove up to 8 armor. Against a boss at 0 armor, deal 4 HP damage.', 'legendary', 5, 'boss', 0),
];
export const CARDS = Object.fromEntries(CARD_LIST.map(c => [c.id, c])) as Record<CardId, CardDefinition>;
export const STARTER_CARDS: CardId[] = ['bandage', 'stone-skin', 'sharp-edge'];
export const BASE_DECK: CardId[] = ['bandage', 'stone-skin', 'sharp-edge', 'armor-tip', 'focus', 'reposition', 'minor-vow', 'hospital', 'wedge', 'formation', 'counterorder', 'marble-vow'];

const bossCard = (id: string, boss: HuntBossId, rarity: BossCardDefinition['rarity'], ru: string, en: string, dru: string, den: string): BossCardDefinition =>
  ({ id, boss, rarity, name: { ru, en }, description: { ru: dru, en: den }, icon: id });
export const BOSS_CARD_LIST: BossCardDefinition[] = [
  bossCard('regent_reposition', 'regent', 'rare', 'Смена опоры', 'Shift of Support', 'Шаг без контактного урона, затем удар 2 вокруг тела. Приём требует свободного места.', 'Step without contact damage, then strike the adjacent ring for 2. Requires a clear landing.'),
  bossCard('regent_far_gong', 'regent', 'epic', 'Дальний гонг', 'Distant Gong', 'Удар 2 по кольцу на расстоянии двух клеток от тела.', 'Deal 2 to the ring exactly two squares from the body.'),
  bossCard('regent_crossfire', 'regent', 'legendary', 'Двусторонний раскол', 'Opposing Fracture', 'Четыре луча по 2 с противоположных сторон.', 'Four rays of 2 damage from opposite faces.'),
  bossCard('spire_retreat', 'spire', 'rare', 'Скользящий отход', 'Gliding Retreat', 'После приёма — шаг без контактного урона на отмеченную клетку.', 'After the maneuver, step to the marked square without contact damage.'),
  bossCard('spire_fork', 'spire', 'epic', 'Коневая вилка', 'Knight Fork', 'Последний удар заменяется площадью ходов коня с уроном 2.', 'Replace the final attack with a 2-damage area on all knight-move destinations.'),
  bossCard('spire_bent_dash', 'spire', 'legendary', 'Ломаный выпад', 'Bent Lunge', 'Луч 1 → рывок с поворотом на 90° и контактом 1 → луч 2 при завершении рывка.', 'Ray 1 → dash with a right-angle turn and contact 1 → ray 2 if the dash finishes.'),
  bossCard('archivist_parallel', 'archivist', 'rare', 'Двойная строка', 'Double Line', 'Огонь на двух параллельных вертикалях или горизонталях.', 'Fire across two parallel files or ranks.'),
  bossCard('archivist_cross', 'archivist', 'epic', 'Перекрёстная правка', 'Crossed Revision', 'Поджечь вертикаль и горизонталь. На каждой клетке — 1 урон сейчас и 1 в следующем ответе.', 'Ignite a file and rank. Each square deals 1 now and 1 on the next response.'),
  bossCard('archivist_border', 'archivist', 'legendary', 'Обугленный край', 'Charred Edge', 'Поджечь край доски: 1 урон сейчас и 1 при следующем ответе.', 'Ignite the board’s edge: 1 damage now and 1 on the next response.'),
];
export const BOSS_CARDS = Object.fromEntries(BOSS_CARD_LIST.map(c => [c.id, c])) as Record<string, BossCardDefinition>;
export const CAMPAIGN_BOSSES: readonly [HuntBossId, ...HuntBossId[]] = ['regent', 'spire', 'archivist'];
