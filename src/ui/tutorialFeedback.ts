import type { GameState } from '../core';
import { countText } from '../i18n/catalog';
import type { Locale } from '../i18n/catalog';
import { instruction } from '../tutorial/controller';
import type { Learning } from '../tutorial/controller';
import { effectTiming } from './effectTiming';

type ChoiceFeedback = {
  readonly kind: 'healing' | 'last-moment-healing' | 'late-healing' | 'unassisted' | 'recovered' | 'absent';
  readonly text: string;
  readonly rule?: string;
};

function whenTurnsFinish(state: GameState, turns: number, locale: Locale) {
  const white = state.side === 'white';
  if (locale === 'ru') {
    const side = white ? 'белых' : 'чёрных';
    const reply = white ? 'чёрных' : 'белых';
    if (turns === 1) return `после следующего хода ${side}`;
    if (turns === 2) return `после хода ${side} и ответа ${reply}`;
    return `через ${countText(locale, 'turn', turns)}`;
  }
  const side = white ? 'White' : 'Black';
  const reply = white ? 'Black' : 'White';
  if (turns === 1) return `after ${side}’s next turn`;
  if (turns === 2) return `after ${side}’s turn and ${reply}’s reply`;
  return `in ${countText(locale, 'turn', turns)}`;
}

/** Explain the actual free choice; do not turn one prescribed move into a quiz. */
export function tutorialChoiceFeedback(learning: Learning, locale: Locale): ChoiceFeedback | undefined {
  if (learning.pendingTeaching || instruction(learning)?.id !== 'practice-ready') return undefined;
  const { state, record } = learning.session;
  const original = record.root.pieces.find(piece => piece.side === 'white' && piece.type === 'knight' && piece.square === 'c3');
  if (!original) return undefined;
  const knight = state.pieces.find(piece => piece.id === original.id);
  if (!knight) return {
    kind: 'absent',
    text: locale === 'ru' ? 'Коня с c3 больше нет на доске. Можно доиграть эту позицию или начать новую партию.'
      : 'The c3 knight is no longer on the board. You can play on from this position or start a new game.',
  };
  if (knight.affliction !== 'devastated') return {
    kind: 'recovered',
    text: locale === 'ru' ? `Конь ${knight.square} больше не опустошён. Угроза исчезновения снята.`
      : `The knight on ${knight.square} is no longer devastated. It is no longer at risk of disappearing.`,
  };
  const { removal, cure } = effectTiming(knight, state);
  if (removal === null) return undefined;
  const expiry = whenTurnsFinish(state, removal, locale);
  if (cure === null) return {
    kind: 'unassisted',
    text: locale === 'ru' ? `Конь ${knight.square} остался без лечения. Без помощи он исчезнет ${expiry}.`
      : `The knight on ${knight.square} is not being healed. Without help, it will disappear ${expiry}.`,
  };
  const healing = whenTurnsFinish(state, cure, locale);
  if (cure > removal) return {
    kind: 'late-healing',
    text: locale === 'ru' ? `Слон начал лечить коня ${knight.square}, но на лечение нужно ещё ${countText(locale, 'turn', cure)}.`
      : `The bishop has started healing the knight on ${knight.square}, but healing needs ${countText(locale, 'turn', cure)} more.`,
    rule: locale === 'ru' ? `Конь исчезнет раньше — ${expiry}, если его не спасти другим способом.`
      : `The knight will disappear first, ${expiry}, unless it is saved another way.`,
  };
  return {
    kind: cure === removal ? 'last-moment-healing' : 'healing',
    text: locale === 'ru' ? `Слон начал лечить коня ${knight.square}. Если они останутся рядом, конь восстановится ${healing}.`
      : `The bishop has started healing the knight on ${knight.square}. If they stay next to each other, the knight will recover ${healing}.`,
    rule: cure === removal
      ? locale === 'ru' ? 'Исцеление сработает в последний момент и спасёт коня от исчезновения.'
        : 'The cure will finish at the deadline and save the knight from disappearing.'
      : locale === 'ru' ? `До исчезновения: ${countText(locale, 'turn', removal)}. Лечение успевает раньше.`
        : `Removal is due in ${countText(locale, 'turn', removal)}. The cure will finish first.`,
  };
}
