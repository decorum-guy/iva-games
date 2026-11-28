import { UNIT_NAMES, UNIT_STRIKES } from '../core';
import type { Language, UnitType } from '../core';

const pieces: UnitType[] = ['P', 'N', 'B', 'R', 'Q', 'K'];
const { P, N, B, R, Q, K } = UNIT_STRIKES;
const guide = {
  ru: {
    title: 'Удары фигур', piece: 'Фигура', damage: 'Базовый урон', range: 'Дальность',
    strikes: {
      P: [P.damage, 'Клетка по передней диагонали. Перед ударом можно шагнуть вперёд.'],
      N: [N.damage, 'Буквой «Г», затем отход.'],
      B: [B.damage + ' при наличии брони, ' + B.exposedDamage + ' без неё', 'До ' + B.range + ' клеток по диагонали.'],
      R: [R.damage + ' после снятия до ' + R.removeArmor + ' брони', 'До ' + R.range + ' клеток по вертикали или горизонтали.'],
      Q: [Q.damage, 'До ' + Q.range + ' клеток по прямой или диагонали.'],
      K: [K.damage, K.range + ' клетка в любую сторону.'],
    },
  },
  en: {
    title: 'Piece strikes', piece: 'Piece', damage: 'Base damage', range: 'Range',
    strikes: {
      P: [P.damage, 'One square diagonally forward. Can step forward before striking.'],
      N: [N.damage, 'An L-shaped jump, then retreat.'],
      B: [B.damage + ' while armored, ' + B.exposedDamage + ' when exposed', 'Up to ' + B.range + ' squares diagonally.'],
      R: [R.damage + ' after removing up to ' + R.removeArmor + ' armor', 'Up to ' + R.range + ' squares horizontally or vertically.'],
      Q: [Q.damage, 'Up to ' + Q.range + ' squares in a straight line or diagonally.'],
      K: [K.damage, K.range + ' square in any direction.'],
    },
  },
} as const;

export function StrikeGuide({ lang }: { lang: Language }) {
  const { title, piece, damage, range, strikes } = guide[lang];
  return <table className="strike-guide">
    <caption>{title}</caption>
    <thead><tr><th scope="col">{piece}</th><th scope="col">{damage}</th><th scope="col">{range}</th></tr></thead>
    <tbody>{pieces.map(type => <tr key={type}>
      <th scope="row">{UNIT_NAMES[type][lang]}</th>
      <td>{strikes[type][0]}</td>
      <td>{strikes[type][1]}</td>
    </tr>)}</tbody>
  </table>;
}
