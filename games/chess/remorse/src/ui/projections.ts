import type { CaptureEvent, GameEvent, GameState, PieceType, Side } from '../core';
import type { Translate } from '../i18n/catalog';

const pieceValues: Readonly<Record<PieceType, number>> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };
const trophyOrder: readonly PieceType[] = ['pawn', 'knight', 'bishop', 'rook', 'queen'];

export function materialBalance(state: GameState): number {
  return state.pieces.reduce((score, piece) => score + pieceValues[piece.type] * (piece.side === 'white' ? 1 : -1), 0);
}

export function trophies(events: readonly CaptureEvent[], side: Side) {
  const counts = new Map<PieceType, number>();
  for (const capture of events) {
    if (!capture.friendly && capture.capturer.side === side) {
      const type = capture.victim.type;
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
  }
  return trophyOrder.filter(type => counts.has(type)).map(type => ({ type, count: counts.get(type)! }));
}

export function describeEvent(t: Translate, event: GameEvent): string {
  switch (event.type) {
    case 'move': return t(event.castle ? 'log.castle' : 'log.move',
      { piece: t(`piece.${event.piece.type}`), from: event.from, to: event.to });
    case 'capture': return t(event.friendly ? 'log.friendly'
      : event.kind === 'enPassant' ? event.mercy ? 'log.enPassantMercy' : 'log.enPassant'
        : event.mercy ? 'log.mercy' : 'log.capture',
      { square: event.victim.square, piece: t(`piece.${event.victim.type}`) });
    case 'reaction': return t(event.face ? 'log.roll'
      : event.cause === 'bishop' ? 'log.bishopPenalty' : 'log.memory',
      { face: event.face ?? 0, state: t(event.affliction === 'neutral' ? 'state.unaffected' : `state.${event.affliction}`),
        square: event.piece.square });
    case 'affliction': return t(event.cause === 'shame' ? 'log.shame' : 'log.bloodlust',
      { state: t(`state.${event.affliction}`), square: event.piece.square });
    case 'cure': return t(event.cause === 'bishop' ? 'log.absolution' : 'log.rally', { square: event.piece.square });
    case 'convert': return t('log.convert', { square: event.piece.square, side: t(`side.${event.side}`) });
    case 'remove': return t('log.remove', { square: event.piece.square, piece: t(`piece.${event.piece.type}`) });
    case 'promotion': return t('log.promote', { square: event.piece.square, piece: t(`piece.${event.promotion}`) });
    case 'bonus': return t('log.bonus', { square: event.piece.square });
    case 'turn': return event.check ? t('game.check') : t('log.boundary', { number: event.turnSerial });
    case 'outcome': return t(`result.${event.outcome.reason}`);
  }
}
