import type { BossCardDefinition, BossDefinition, BossId, CardDefinition, CardId, Difficulty, Localized, UnitType } from './types';

export const UNIT_HP: Record<UnitType, number> = { K: 20, Q: 6, R: 4, B: 3, N: 3, P: 2 };
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
  regent: { id: 'regent', name: { ru: 'Каменный Регент', en: 'The Stone Regent' }, description: { ru: 'Тяжёлый таран, лучи и удар вокруг тела.', en: 'A heavy ram, blocked rays and a surrounding shockwave.' }, width: 2, height: 2, anchor: 43, armor: 12, hp: 28 },
  spire: { id: 'spire', name: { ru: 'Шпиль', en: 'The Spire' }, description: { ru: 'Рывки, насечки и прыжки с фиксированной целью.', en: 'Dashes, slashes and leaps with a committed target.' }, width: 1, height: 1, anchor: 44, armor: 6, hp: 24 },
  archivist: { id: 'archivist', name: { ru: 'Пепельный Архивариус', en: 'The Ash Archivist' }, description: { ru: 'Огонь по линиям и прыжки двухклеточного тела.', en: 'Burning lines and a leaping two-square body.' }, width: 1, height: 2, anchor: 43, armor: 8, hp: 24 },
};

const card = (id: CardId, ru: string, en: string, descriptionRu: string, descriptionEn: string,
  rarity: CardDefinition['rarity'], cost: number, target: CardDefinition['target'], maxTargets = 1): CardDefinition =>
  ({ id, name: { ru, en }, description: { ru: descriptionRu, en: descriptionEn }, rarity, cost, icon: id, target, maxTargets });

export const CARD_LIST: CardDefinition[] = [
  card('bandage', 'Перевязка', 'Bandage', 'Восстановить фигуре 2 здоровья. Король не может быть целью.', 'Restore 2 health to one living piece other than the king.', 'common', 1, 'unit'),
  card('stone-skin', 'Каменная кожа', 'Stone Skin', 'Щит 2 одной фигуре до конца ответа босса.', 'Give one piece a consumable shield of 2 through the next boss response.', 'common', 1, 'unit'),
  card('sharp-edge', 'Острый край', 'Sharp Edge', 'Следующая атака выбранной фигуры в этом раунде: +1 урона.', 'The chosen unactivated piece’s next attack this round deals +1 damage.', 'common', 1, 'unit'),
  card('armor-tip', 'Бронебойный наконечник', 'Armor-Piercing Tip', 'После следующего удара снять ещё до 2 оставшейся брони.', 'After the chosen piece’s next attack, remove up to 2 remaining armor.', 'common', 1, 'unit'),
  card('focus', 'Сосредоточение', 'Concentration', 'Получить 2 фокуса, максимум 5. Занимает карту раунда.', 'Gain 2 focus, up to 5. Uses this round’s card play.', 'common', 0, 'none', 0),
  card('reposition', 'Перестроение', 'Reposition', 'Сдвинуть неактивированную фигуру на клетку по стороне; она считается активированной. Король исключён.', 'Move an unactivated non-king one orthogonal square and activate it.', 'common', 1, 'move'),
  card('swap', 'Смена караула', 'Changing the Guard', 'Поменять местами двух соседей по стороне. Обе фигуры считаются активированными.', 'Swap two adjacent orthogonal unactivated pieces. Both become activated.', 'rare', 2, 'swap', 2),
  card('minor-vow', 'Малый обет', 'Lesser Vow', 'Неуязвимость одной фигуры на ближайший ответ босса.', 'One piece becomes invulnerable through the next boss response.', 'rare', 3, 'unit'),
  card('hospital', 'Полевой лазарет', 'Field Hospital', 'Восстановить по 2 здоровья одной или двум фигурам, кроме короля.', 'Restore 2 health each to one or two living non-king pieces.', 'rare', 2, 'units', 2),
  card('hunt-mark', 'Метка охоты', 'Hunt Mark', 'Первые три атаки разных фигур в этой фазе получают +1 урона.', 'The first three attacks by different pieces this phase deal +1 damage.', 'rare', 2, 'none', 0),
  card('wedge', 'Клин между плит', 'Wedge Between Plates', 'Снять до 4 брони. В здоровье урон не переходит.', 'Remove up to 4 armor. No overflow into health.', 'rare', 2, 'boss', 0),
  card('formation', 'Несокрушимый строй', 'Unbroken Formation', 'Дать до трёх некоролевских фигур щит 3 на ближайший ответ.', 'Give up to three non-king pieces a shield of 3 through the next response.', 'epic', 4, 'units', 3),
  card('disrupt', 'Сбой ритма', 'Break the Rhythm', 'Отменить одно показанное атакующее действие. Движение, контакт и старый огонь сохраняются.', 'Cancel one announced attack group. Movement, contact and old fire remain.', 'epic', 4, 'intent', 0),
  card('counterorder', 'Контрприказ', 'Counterorder', 'Ещё одна команда в этой фазе. Повторная активация запрещена.', 'Gain one command this phase. Each piece still activates only once.', 'epic', 3, 'none', 0),
  card('marble-vow', 'Мраморный обет', 'Marble Vow', 'Неуязвимость одной фигуры на два ответа босса.', 'One piece becomes invulnerable through two boss responses.', 'legendary', 5, 'unit'),
  card('shell-break', 'Разрыв панциря', 'Shatter the Shell', 'Снять до 8 брони; если брони уже нет — нанести 4 урона здоровью.', 'Remove up to 8 armor; if armor is already gone, deal 4 health damage.', 'legendary', 5, 'boss', 0),
];
export const CARDS = Object.fromEntries(CARD_LIST.map(c => [c.id, c])) as Record<CardId, CardDefinition>;
export const STARTER_CARDS: CardId[] = ['bandage', 'stone-skin', 'sharp-edge'];
export const BASE_DECK: CardId[] = ['bandage', 'stone-skin', 'sharp-edge', 'armor-tip', 'focus', 'reposition', 'minor-vow', 'hospital', 'wedge', 'formation', 'counterorder', 'marble-vow'];

const bossCard = (id: string, boss: BossId, rarity: BossCardDefinition['rarity'], ru: string, en: string, dru: string, den: string): BossCardDefinition =>
  ({ id, boss, rarity, name: { ru, en }, description: { ru: dru, en: den }, icon: id });
export const BOSS_CARD_LIST: BossCardDefinition[] = [
  bossCard('regent_reposition', 'regent', 'rare', 'Смена опоры', 'Shift of Support', 'Шаг без контакта, затем удар 2 по соседнему кольцу. Занятая клетка срывает весь приём.', 'A non-contact step, then a 2-damage adjacent ring. An occupied destination stops the entire maneuver.'),
  bossCard('regent_far_gong', 'regent', 'epic', 'Дальний гонг', 'Distant Gong', 'Удар 2 по кольцу на расстоянии двух клеток от тела.', 'Deal 2 to the ring exactly two squares from the body.'),
  bossCard('regent_crossfire', 'regent', 'legendary', 'Двусторонний раскол', 'Opposing Fracture', 'Четыре блокируемых луча по 2 с противоположных граней.', 'Four blockable 2-damage rays from opposite faces.'),
  bossCard('spire_retreat', 'spire', 'rare', 'Скользящий отход', 'Gliding Retreat', 'После приёма — шаг без контакта на указанную клетку.', 'After the maneuver, take a non-contact step to the marked square.'),
  bossCard('spire_fork', 'spire', 'epic', 'Коневая вилка', 'Knight Fork', 'Последний удар заменяется площадью ходов коня с уроном 2.', 'Replace the final attack with a 2-damage area on all knight-move destinations.'),
  bossCard('spire_bent_dash', 'spire', 'legendary', 'Ломаный выпад', 'Bent Lunge', 'Начальный луч 1, затем рывок с одним прямоугольным поворотом и контактом 1; при полном завершении — конечный луч 2.', 'An opening ray of 1, then a dash with one right-angle turn and contact 1; a closing ray of 2 if the whole dash completes.'),
  bossCard('archivist_parallel', 'archivist', 'rare', 'Двойная строка', 'Double Line', 'Огонь на двух параллельных вертикалях или горизонталях.', 'Fire across two parallel files or ranks.'),
  bossCard('archivist_cross', 'archivist', 'epic', 'Перекрёстная правка', 'Crossed Revision', 'Огонь по вертикали и горизонтали. Пересечение получает одно попадание за пакет.', 'Fire across one file and one rank. The intersection is hit once per packet.'),
  bossCard('archivist_border', 'archivist', 'legendary', 'Обугленный край', 'Charred Edge', 'Поджечь весь внешний периметр: 28 клеток, углы один раз. Огонь наносит 1 сейчас и 1 при следующем ответе.', 'Ignite the entire outer perimeter: 28 squares, counting corners once. Fire deals 1 now and 1 on the next response.'),
];
export const BOSS_CARDS = Object.fromEntries(BOSS_CARD_LIST.map(c => [c.id, c])) as Record<string, BossCardDefinition>;
export const CAMPAIGN_BOSSES: BossId[] = ['regent', 'spire', 'archivist'];
