import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { PROMOTIONS } from '../core';
import type { CaptureEvent, Promotion, Side } from '../core';
import { DEFAULT_LEVEL, PRESETS } from '../engine/presets';
import { countText, dateText, numberText } from '../i18n/catalog';
import type { Locale, Translate } from '../i18n/catalog';
import { digitalRules, quickRules, reactionRules, rulesMeta, sourceRules } from '../i18n/rules';
import './rules.css';
import { displayDelta } from '../rating/elo';
import type { Profile, RatingEntry } from '../rating/elo';
import type { MatchRecord, SessionConfig } from '../session/match';
import { randomSide } from '../session/random';
import { Icon } from './icons';
import { PieceIcon } from './pieces';
import { trophies } from './projections';

export function Dialog({ title, closeLabel, onClose, children, className }: {
  title: string; closeLabel: string; onClose: () => void; children: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className={`dialog ${className ?? ''}`} aria-labelledby={id}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="dialog-title">
      <h2 id={id}>{title}</h2>
      <button className="icon-button" type="button" onClick={onClose}
        data-testid="dialog-close" aria-label={closeLabel}>
        <Icon name="close" />
      </button>
    </div>
    <div className="dialog-body">{children}</div>
  </dialog>;
}

export function LanguagePicker({ t, locale, onLocale }: { t: Translate; locale: Locale; onLocale: (locale: Locale) => void }) {
  return <div className="language-switch" aria-label={t('settings.language')} role="group">
    <button lang="ru" type="button" data-testid="lang-ru" aria-pressed={locale === 'ru'} onClick={() => onLocale('ru')}>Рус</button>
    <button lang="en" type="button" data-testid="lang-en" aria-pressed={locale === 'en'} onClick={() => onLocale('en')}>EN</button>
  </div>;
}

export function LevelPicker({ t, value, onChange }: { t: Translate; value: number; onChange: (value: number) => void }) {
  return <label className="field">
    <span>{t('setup.level')}</span>
    <select value={value} onChange={event => onChange(Number(event.target.value))} data-testid="setup-level">
      {PRESETS.map(preset => <option key={preset.id} value={preset.id}>{t('setup.levelValue', { level: preset.id, elo: preset.anchor })}</option>)}
    </select>
  </label>;
}

export function SetupDialog({ t, hotseat, durable, busy, pending, onStart, onClose, onResume, onRelease, onMode }: {
  t: Translate; hotseat: boolean; durable: boolean; busy: boolean; pending?: MatchRecord;
  onStart: (config: SessionConfig) => void; onClose: () => void;
  onResume: (id: string) => void; onRelease: (id: string) => void; onMode?: (hotseat: boolean) => void;
}) {
  const [rated, setRated] = useState(durable);
  const [side, setSide] = useState<Side | 'random'>('white');
  const [level, setLevel] = useState(DEFAULT_LEVEL);
  const [whiteName, setWhiteName] = useState('');
  const [blackName, setBlackName] = useState('');
  const [replace, setReplace] = useState(false);
  const locked = !hotseat && rated && pending;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || busy) return;
    const human = hotseat ? null : side === 'random' ? randomSide() : side;
    const names = hotseat ? { white: whiteName.trim() || undefined, black: blackName.trim() || undefined }
      : human && whiteName.trim() ? { [human]: whiteName.trim() } : undefined;
    onStart({ mode: hotseat ? 'hotseat' : rated ? 'rated' : 'practice', level: hotseat ? null : level, human, names, provenance: 'standard' });
  }

  return <Dialog closeLabel={t('nav.close')} title={t(hotseat ? 'home.hotseat' : 'home.playAI')} onClose={onClose}>
    <form className="setup-form" onSubmit={submit}>
      {onMode && <div className="segmented" aria-label={t('home.new')} role="group">
        <button type="button" aria-pressed={!hotseat} onClick={() => onMode(false)}>{t('home.playAI')}</button>
        <button type="button" aria-pressed={hotseat} onClick={() => onMode(true)}>{t('home.hotseat')}</button>
      </div>}
      {!hotseat && <>
        <div className="segmented" role="group" aria-label={t('home.new')}>
          <button type="button" aria-pressed={rated} disabled={!durable} onClick={() => setRated(true)} data-testid="setup-rated">{t('setup.rated')}</button>
          <button type="button" aria-pressed={!rated} onClick={() => setRated(false)} data-testid="setup-practice">{t('setup.practice')}</button>
        </div>
        <p className="field-note">{t(!durable ? 'error.storage' : rated ? 'setup.ratedPolicy' : 'setup.practicePolicy')}</p>
        <LevelPicker t={t} value={level} onChange={setLevel} />
        <details className="setup-rating-help"><summary>{t('setup.aboutRating')}</summary><p className="field-note">{t('setup.botScale')}</p></details>
        <fieldset>
          <legend>{t('setup.yourSide')}</legend>
          <div className="segmented side-picker">
            {(['white', 'black', 'random'] as const).map(choice => <button type="button" key={choice}
              data-testid={`setup-${choice}`} aria-pressed={side === choice} onClick={() => setSide(choice)}>
              {choice !== 'random' && <span className={`mini-stamp ${choice}`} aria-hidden="true" />}
              {t(choice === 'random' ? 'setup.random' : `side.${choice}`)}
            </button>)}
          </div>
        </fieldset>
      </>}
      <label className="field">
        <span>{t(hotseat ? 'setup.whiteName' : 'setup.name')}</span>
        <input name="player" type="text" value={whiteName} onChange={event => setWhiteName(event.target.value)}
          maxLength={48} placeholder={t(hotseat ? 'side.white' : 'game.you')} autoComplete="off" />
      </label>
      {hotseat && <label className="field">
        <span>{t('setup.blackName')}</span>
        <input name="secondPlayer" type="text" value={blackName} onChange={event => setBlackName(event.target.value)}
          maxLength={48} placeholder={t('side.black')} autoComplete="off" />
      </label>}
      {locked && <div className="resume-warning">
        <strong>{t('setup.activeRated')}</strong>
        <button type="button" className="button" onClick={() => onResume(pending.id)} disabled={busy} data-testid="resume-rated">{t('home.resumeRated')}</button>
        {replace ? <>
          <p>{t(pending.activated ? 'setup.replaceActive' : 'setup.replaceReserved')}</p>
          <button type="button" className="button danger" onClick={() => onRelease(pending.id)} disabled={busy}>{t(pending.activated ? 'setup.resignOld' : 'setup.cancelOld')}</button>
        </> : <button type="button" className="text-button" onClick={() => setReplace(true)}>{t(pending.activated ? 'setup.resignOld' : 'setup.cancelOld')}</button>}
      </div>}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose} data-testid="setup-cancel">{t('nav.cancel')}</button>
        <button type="submit" className="button primary" disabled={busy || Boolean(locked)} data-testid="setup-start">{t('setup.start')}</button>
      </div>
    </form>
  </Dialog>;
}

export type BoardMode = '3d' | '2d';
export type CameraMode = 'studio' | 'tactical' | 'top';
export interface Settings {
  readonly locale: Locale;
  readonly board: BoardMode;
  readonly camera: CameraMode;
  readonly quality: 'auto' | 'high' | 'low';
  readonly autoFlip: boolean;
  readonly reduce: boolean;
  readonly sound: boolean;
  readonly volume: number;
}

export function SettingsDialog({ t, settings, onChange, onClose, exportFile, importFile, changeLevel, level }: {
  t: Translate; settings: Settings; onChange: (fields: Partial<Settings>) => void; onClose: () => void;
  exportFile?: () => void; importFile: (text: string) => void; changeLevel?: (level: number) => void; level?: number;
}) {
  const file = useRef<HTMLInputElement>(null);
  return <Dialog closeLabel={t('nav.close')} title={t('nav.settings')} onClose={onClose}>
    <div className="settings-list">
      <div className="setting"><span>{t('settings.language')}</span>
        <LanguagePicker t={t} locale={settings.locale} onLocale={locale => onChange({ locale })} />
      </div>
      <div className="setting"><span>{t('settings.view')}</span>
        <div className="segmented" role="group" aria-label={t('settings.view')}>
          <button type="button" aria-pressed={settings.board === '3d'} onClick={() => onChange({ board: '3d' })}>3D</button>
          <button type="button" aria-pressed={settings.board === '2d'} onClick={() => onChange({ board: '2d' })}>2D</button>
        </div>
      </div>
      <label className="setting">
        <span>{t('settings.camera')}</span>
        <select value={settings.camera} onChange={event => onChange({ camera: event.target.value as CameraMode })}>
          {(['studio', 'tactical', 'top'] as const).map(value => <option key={value} value={value}>{t(`settings.${value}`)}</option>)}
        </select>
      </label>
      <label className="setting">
        <span>{t('settings.quality')}</span>
        <select value={settings.quality} onChange={event => onChange({ quality: event.target.value as Settings['quality'] })}>
          {(['auto', 'high', 'low'] as const).map(value => <option key={value} value={value}>{t(`settings.${value}`)}</option>)}
        </select>
      </label>
      {(['autoFlip', 'reduce', 'sound'] as const).map(key => <label className="setting" key={key}>
        <span>{t(`settings.${key}`)}</span><input type="checkbox" checked={settings[key]} onChange={event => onChange({ [key]: event.target.checked })} />
      </label>)}
      <label className="setting volume-setting"><span>{t('settings.volume')}</span>
        <input type="range" min="0" max="100" step="5" value={Math.round(settings.volume * 100)}
          disabled={!settings.sound} aria-valuetext={`${Math.round(settings.volume * 100)}%`}
          onChange={event => onChange({ volume: Number(event.target.value) / 100 })} />
      </label>
      {changeLevel && level && <LevelPicker t={t} value={level} onChange={changeLevel} />}
    </div>
    <div className="dialog-actions">
      {exportFile && <button className="button" type="button" onClick={exportFile}>{t('settings.export')}</button>}
      <button className="button" type="button" onClick={() => file.current?.click()}>{t('settings.import')}</button>
      <input ref={file} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1}
        aria-label={t('settings.import')} data-testid="import-file"
        onChange={event => {
          const input = event.currentTarget;
          const data = input.files?.[0];
          if (data) void (data.size < 12_000_000 ? data.text() : Promise.resolve('')).then(importFile, () => importFile(''));
          input.value = '';
        }} />
    </div>
  </Dialog>;
}

export function PromotionDialog({ t, side, onPick, onClose, locale, onLocale, allowed }: {
  t: Translate; side: Side; onPick: (piece: Promotion) => void; onClose: () => void; locale: Locale; onLocale: (locale: Locale) => void;
  allowed?: readonly Promotion[];
}) {
  return <Dialog closeLabel={t('nav.close')} className="promotion-dialog" title={t('game.promotion')} onClose={onClose}>
    <div className="promotion-options">{PROMOTIONS.map(piece => <button type="button" className="button" key={piece}
      data-testid={`promotion-${piece}`} disabled={allowed !== undefined && !allowed.includes(piece)} onClick={() => onPick(piece)}>
      <PieceIcon type={piece} side={side} /><span>{t(`piece.${piece}`)}</span>
    </button>)}</div>
    <LanguagePicker t={t} locale={locale} onLocale={onLocale} />
  </Dialog>;
}

export function RulesDialog({ t, locale, onClose }: { t: Translate; locale: Locale; onClose: () => void }) {
  return <Dialog closeLabel={t('nav.close')} title={t('nav.rules')} onClose={onClose} className="reading-dialog">
    <div className="reading">
      <section className="rules-quickstart" aria-label={quickRules.title[locale]}>
        <h3>{quickRules.title[locale]}</h3>
        <p>{quickRules.intro[locale]}</p>
        <table className="rules-reactions">
          <caption>{quickRules.die[locale]}</caption>
          <thead><tr><th scope="col">{rulesMeta.face[locale]}</th><th scope="col">{rulesMeta.effect[locale]}</th></tr></thead>
          <tbody>{reactionRules.map(row => <tr key={row.reaction}>
            <th scope="row">{row.faces.join('–')}</th>
            <td><strong className={`affliction-label ${row.reaction}`}>{t(`state.${row.reaction}`)}</strong>
              <span>{row.description[locale]}</span></td>
          </tr>)}</tbody>
        </table>
        <p>{quickRules.cycle[locale]}</p>
        <p>{quickRules.memory[locale]}</p>
        <p>{quickRules.support[locale]}</p>
        <p>{quickRules.bloodlust[locale]}</p>
        <p className="rules-inspection">{quickRules.inspection[locale]}</p>
      </section>
      <h3>{rulesMeta.detail[locale]}</h3>
      {sourceRules.map(section => <details key={section.id}>
        <summary>{section.title[locale]}</summary>
        {section.body.map((paragraph, index) => <p key={index}>{paragraph[locale]}</p>)}
      </details>)}
      <h3>{rulesMeta.digital[locale]}</h3>
      {digitalRules.map(section => <details key={section.id}>
        <summary>{section.title[locale]}</summary>
        {section.body.map((paragraph, index) => <p key={index}>{paragraph[locale]}</p>)}
      </details>)}
      <p className="source-credit">{rulesMeta.credit[locale]}</p>
    </div>
  </Dialog>;
}

export function eloChange(locale: Locale, entry: RatingEntry) {
  const delta = displayDelta(entry.before, entry.after);
  const format = (value: number) => numberText(locale, Math.round(value));
  return `${format(entry.before)} → ${format(entry.after)} (${delta > 0 ? '+' : ''}${format(delta)})`;
}

export function ProfileDialog({ t, locale, profile, ledger, onClose }: {
  t: Translate; locale: Locale; profile: Profile; ledger: readonly RatingEntry[]; onClose: () => void;
}) {
  return <Dialog closeLabel={t('nav.close')} title={t('nav.profile')} onClose={onClose}>
    <div className="rating-overview">
      <div><span>{t('profile.current')}</span><strong>{numberText(locale, profile.rating)}</strong></div>
      <div><span>{t('profile.best')}</span><strong>{numberText(locale, profile.best)}</strong></div>
    </div>
    <dl className="record-line">
      {([['win', profile.wins], ['draw', profile.draws], ['loss', profile.losses]] as const).map(([name, value]) =>
        <div key={name}><dt>{t(`profile.${name}`)}</dt><dd>{numberText(locale, value)}</dd></div>)}
    </dl>
    <p className="field-note">{t('profile.local')}</p>
    {ledger.length ? <ul className="save-list">{ledger.map(entry => <li key={entry.matchId}>
      <div>
        <strong>{t(entry.score === 1 ? 'game.win' : entry.score === 0 ? 'game.loss' : 'game.draw')}</strong>
        <small>{dateText(locale, entry.timestamp)} · {t('profile.against', { level: entry.level, elo: entry.anchor })}</small>
      </div>
      <span>{eloChange(locale, entry)}</span>
    </li>)}</ul> : <p>{t('profile.empty')}</p>}
  </Dialog>;
}

export function SavesDialog({ t, locale, matches, busy, onOpen, onClose }: {
  t: Translate; locale: Locale; matches: readonly MatchRecord[]; busy: boolean; onOpen: (id: string) => void; onClose: () => void;
}) {
  return <Dialog closeLabel={t('nav.close')} title={t('home.saved')} onClose={onClose}>
    {matches.length === 0 ? <p>{t('saves.empty')}</p> : <ul className="save-list">{matches.map(match => <li key={match.id}>
      <div><strong>{t(`setup.${match.config.mode}`)}</strong>
        <small>{dateText(locale, match.updatedAt)} · {t(match.status === 'open' ? 'saves.inProgress' :
          match.status === 'finished' ? 'game.finish' : `saves.${match.status}`)}</small>
      </div>
      {(match.status === 'open' || match.status === 'finished') && <button type="button" className="button compact" onClick={() => onOpen(match.id)} disabled={busy}>
        {t(match.status === 'open' ? 'home.resume' : 'saves.review')}
      </button>}
    </li>)}</ul>}
  </Dialog>;
}

export function CaptureDialog({ t, locale, captures, side, onClose }: {
  t: Translate; locale: Locale; captures: readonly CaptureEvent[]; side: Side; onClose: () => void;
}) {
  const entries = trophies(captures, side);
  return <Dialog closeLabel={t('nav.close')} title={`${t('hud.captured')} · ${t(`side.${side}`)}`} onClose={onClose}>
    <p className="field-note">{t('hud.captureRoot')}</p>
    {entries.length ? <ul className="save-list">{entries.map(({ type, count }) => <li key={type}>
      <strong><PieceIcon type={type} />{t(`piece.${type}`)}</strong><span>{countText(locale, 'capture', count)}</span>
    </li>)}</ul> : <p>{t('hud.none')}</p>}
    <p>{t('hud.material')}</p>
  </Dialog>;
}
