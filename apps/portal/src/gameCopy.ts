import { registration } from '@iva-games/game-registry';
import type { Game, Language } from './types';

export function gameTitle(game: Game, lang: Language) {
  return registration(game.gameId)?.title[lang] ?? game.title;
}
export function gameDescription(gameId: string, lang: Language) {
  return registration(gameId)?.description[lang] ?? '';
}
