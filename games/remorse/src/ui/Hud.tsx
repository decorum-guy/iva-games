import { opposite } from '../core';
import type { CaptureEvent, Side } from '../core';
import { getPreset } from '../engine/presets';
import { countText, numberText } from '../i18n/catalog';
import type { Locale, Translate } from '../i18n/catalog';
import type { ViewConfig } from '../session/view';
import { PieceIcon } from './pieces';
import { trophies } from './projections';

export function PlayerRow({ t, locale, side, config, active, captures, advantage, rating, onCaptures, teachingFocus }: {
  t: Translate; locale: Locale; side: Side; config?: ViewConfig; active: boolean;
  captures: readonly CaptureEvent[]; advantage: number; rating: number; onCaptures: (side: Side) => void;
  teachingFocus?: 'captures' | 'material';
}) {
  const list = trophies(captures, side);
  const bot = Boolean(config?.human && config.human !== side && config.mode !== 'tutorial' && config.mode !== 'online');
  const preset = bot ? getPreset(config?.level ?? 0) : undefined;
  const name = config?.names?.[side] ?? (bot ? 'Remorse Engine' : config?.human === side ? t('game.you')
    : config?.mode === 'tutorial' ? t('game.mentor') : t(`side.${side}`));
  const isHuman = config?.human === side && config.mode !== 'tutorial' && config.mode !== 'online';
  const notation = `+${numberText(locale, advantage)}`;
  const level = preset && t('setup.levelValue', { level: preset.id, elo: preset.anchor });
  return <div className={`player-row ${active ? 'player-active' : ''}`} data-side={side} data-teaching-hud={teachingFocus}>
    <span className={`side-stamp ${side}`} aria-label={t(`side.${side}`)} title={t(`side.${side}`)} />
    <div className="player-detail">
      <div className="player-heading">
        <strong title={name}>{name}</strong>
        {(level || isHuman) && <span className="player-elo">{level || t('game.playerRating', {
          rating: numberText(locale, Math.round(config?.rating?.ratingBefore ?? rating)),
        })}</span>}
        {active && <span className="active-tick" aria-hidden="true" />}
      </div>
      <div className="capture-line">
        <button type="button" className="trophies" onClick={() => onCaptures(side)}
          aria-label={`${t('hud.captured')} · ${name} · ${countText(locale, 'capture', list.reduce((n, entry) => n + entry.count, 0))}`}
          title={t(list.length ? 'hud.captured' : 'hud.none')}>
          {list.length ? list.map(({ type, count }) => <span className="trophy-group" key={type}>
            <PieceIcon type={type} side={opposite(side)} />{count > 1 && <small>{count}</small>}
          </span>) : <span className="empty-trophy" aria-hidden="true">—</span>}
        </button>
        {advantage > 0 && <button type="button" className="material" onClick={() => onCaptures(side)}
          title={t('hud.material')} aria-label={t('hud.materialBadge', { value: notation })}>{notation}</button>}
      </div>
    </div>
  </div>;
}
