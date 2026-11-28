import { isGameAvailableOnDevice, registration } from '@iva-games/game-registry';
import type { ReactNode } from 'react';
import { GameArt } from './ui';
import type { Language } from './types';
import mouseIcon from './assets/mouse-recommendation.svg';
import './game-card.css';

function availableOnThisDevice(gameId: string) {
  return isGameAvailableOnDevice(gameId, typeof navigator === 'undefined' ? undefined : navigator);
}

/** Shared by the portal and standalone chess catalogue. Advice stays out of the artwork's aria-hidden tree. */
export function GameCardArt({ gameId, lang }: { gameId: string; lang: Language }) {
  return <div className="game-card-art">
    <GameArt kind={gameId} />
    {registration(gameId)?.inputRecommendation === 'mouse' && <span className="input-recommendation-sticker" data-input-recommendation="mouse">
      <img src={mouseIcon} width="24" height="28" alt="" aria-hidden="true" draggable="false" />
      <span>{lang === 'ru' ? 'Удобнее с мышью' : 'Better with a mouse'}</span>
    </span>}
  </div>;
}

export function GameCardStatus({ gameId, lang, playable }: { gameId: string; lang: Language; playable: boolean }) {
  const availableHere = availableOnThisDevice(gameId);
  return <span className={`tag ${playable && availableHere ? 'success' : ''}`}>
    {!playable ? lang === 'ru' ? 'Скоро здесь' : 'Coming soon'
      : !availableHere ? lang === 'ru' ? 'Для компьютера' : 'Computer only'
        : lang === 'ru' ? 'Можно играть' : 'Ready to play'}
  </span>;
}

/** Only explicit device availability can replace a launch action. Mouse advice never gates it. */
export function GameCardAction({ gameId, lang, children }: { gameId: string; lang: Language; children: ReactNode }) {
  return availableOnThisDevice(gameId) ? children : <span className="game-device-notice">
    {lang === 'ru' ? 'Играйте на компьютере' : 'Play on a computer'}
  </span>;
}
