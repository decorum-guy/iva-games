import { bossCells, squareName, UNIT_NAMES, BOSSES } from '../core';
import type { GameState, Language, ResponsePreview } from '../core';
import { copy } from './i18n';

export interface BoardProps {
  state: GameState;
  lang: Language;
  selected: string | null;
  targets: number[];
  attackTargets: number[];
  onSquare: (square: number) => void;
  preview: ResponsePreview | null;
  reducedMotion?: boolean;
  theme?: 'ivory' | 'jade' | 'bronze';
  disabled?: boolean;
  guideSquares?: number[];
}

export function squareLabel(p: BoardProps, square: number) {
  const unit = p.state.units.find(x => x.square === square);
  const boss = bossCells(p.state.boss).includes(square);
  const labels = [squareName(square)];
  if (unit) {
    labels.push(`${UNIT_NAMES[unit.type][p.lang]} ${unit.hp}/${unit.maxHp} HP`);
    if (p.state.coop) labels.push(`${p.lang === 'ru' ? 'Командир' : 'Commander'} ${unit.owner}`);
    if (unit.activated) labels.push(copy[p.lang].spent);
    if (unit.shield) labels.push(`${p.lang === 'ru' ? 'Щит' : 'Shield'} ${unit.shield}`);
    if (unit.invulnerable) labels.push(p.lang === 'ru' ? 'Неуязвимость' : 'Invulnerability');
    const damage = p.preview?.damage[unit.id];
    if (damage) labels.push(`${p.lang === 'ru' ? 'Прогноз урона' : 'Forecast damage'} ${damage}`);
  }
  if (boss) labels.push(`${BOSSES[p.state.boss.id].name[p.lang]} ${p.state.boss.hp} HP, ${p.lang === 'ru' ? 'броня' : 'armor'} ${p.state.boss.armor}`);
  if (p.targets.includes(square)) labels.push(copy[p.lang].chooseSquare);
  if (p.attackTargets.includes(square)) labels.push(p.lang === 'ru' ? 'Можно атаковать' : 'Attack available');
  if (p.preview?.threatenedCells.includes(square)) labels.push(p.lang === 'ru' ? 'Под ударом босса' : 'Boss threat');
  if (p.state.fire.includes(square)) labels.push(p.lang === 'ru' ? 'Огонь' : 'Fire');
  return labels.join(', ');
}

export function nextBoardSquare(square: number, key: string, control = false): number | null {
  const file = square % 8, rank = Math.floor(square / 8);
  if (key === 'ArrowLeft') return file > 0 ? square - 1 : square;
  if (key === 'ArrowRight') return file < 7 ? square + 1 : square;
  if (key === 'ArrowUp') return rank < 7 ? square + 8 : square;
  if (key === 'ArrowDown') return rank > 0 ? square - 8 : square;
  if (key === 'Home') return control ? 0 : rank * 8;
  if (key === 'End') return control ? 63 : rank * 8 + 7;
  return null;
}
