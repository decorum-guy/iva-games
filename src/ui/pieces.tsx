import type { Affliction, PieceType, Side } from '../core';

const silhouettes: Record<PieceType, string> = {
  pawn: 'M12 4.2a3.5 3.5 0 0 0-2.1 6.3c-.25 1.5-1.25 3.4-2.65 5.1h9.5c-1.4-1.7-2.4-3.6-2.65-5.1A3.5 3.5 0 0 0 12 4.2ZM7 17h10l1.3 3H5.7L7 17Z',
  knight: 'm8 5.3 4.2 1.1 2.6-2.6.8 3.4c3.3 2.7 3.6 6.1 2.4 9.3H7.2c.5-2.6 1.7-4.3 4-5.7l-.6-1.2-3.5 2-2.8-1.9L8 5.3Zm-.4 12.4h10.7l1.1 2.4H6.5l1.1-2.4Z',
  bishop: 'M12 3.4c-2.6 2.2-4.9 4.9-4.9 7.5 0 2.3 1.4 3.9 3 4.5h3.8c1.8-.6 3-2.4 3-4.5 0-1.2-.5-2.4-1.3-3.5l-2.8 3.3-.9-.8 2.9-3.5L12 3.4ZM8.8 16.8h6.4l2 3.3H6.8l2-3.3Z',
  rook: 'M5.8 4.9h3.3v3h1.4v-3h3v3h1.4v-3h3.3v4.3l-2 2.3-.8 4.8H8.6l-.8-4.8-2-2.3V4.9ZM8.1 17.6h7.8l2.2 2.6H5.9l2.2-2.6Z',
  queen: 'M5.5 9.9a1.6 1.6 0 1 1 1.2-.6l3.2 3.2 1.5-5a1.6 1.6 0 1 1 1.2 0l1.5 5 3.2-3.2a1.6 1.6 0 1 1 1.2.6l-2.1 6.4H7.6L5.5 9.9Zm2.2 7.7h8.6l2 2.5H5.7l2-2.5Z',
  king: 'M11.1 2.8h1.8v2h2.2v1.8h-2.2v2h-1.8v-2H8.9V4.8h2.2v-2Zm.9 6.8c1.6-1.7 4.4-2.3 6-.5 1.9 2.2.1 4.6-2.4 7.3H8.4c-2.5-2.7-4.3-5.1-2.4-7.3 1.6-1.8 4.4-1.2 6 .5Zm-3.6 8.1h7.2l2.1 2.4H6.3l2.1-2.4Z',
};

export function PieceIcon({ type, side, className = '' }: { type: PieceType; side?: Side; className?: string }) {
  return <svg aria-hidden="true" className={`piece-icon ${side ?? ''} ${className}`} viewBox="0 0 24 24">
    <path d={silhouettes[type]} fillRule="evenodd" />
  </svg>;
}

const mark: Record<Affliction, string> = {
  neutral: '', guilt: '◔', devastated: '◫', berserk: '»', bloodlust: '◆',
};
export function StateMark({ state }: { state: Affliction }) {
  return <span className={`state-mark ${state}`} aria-hidden="true">{mark[state]}</span>;
}
