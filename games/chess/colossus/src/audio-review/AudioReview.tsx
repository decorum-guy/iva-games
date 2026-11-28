import { useEffect, useState } from 'react';
import type { Language } from '../core';
import { playSound, setSoundEnabled, soundForEvents, SOUND_NAMES, stopSounds, unlockSounds } from '../ui/audio';
import type { SoundName } from '../ui/audio';
import { cues, cueGroups, moments } from './cues';
import type { Moment } from './cues';

type Decision = '' | 'approved' | 'revise';
interface Verdict { sha256: string; decision: Decision; note: string }
type Verdicts = Partial<Record<SoundName, Verdict>>;
interface Manifest { version: number; sounds: Record<SoundName, { sha256: string }> }

const storageKey = 'colossus.audio-review.v1';
const text = {
  ru: {
    name: 'Звуки Колосса', subtitle: 'Прослушай каждый эффект на игровой громкости и отметь решение.',
    listen: 'Слушать', stop: 'Остановить', mute: 'Выключить звук', unmute: 'Включить звук',
    approved: 'Утверждаю', revise: 'Доработать', pending: 'Без решения', decision: 'Решение',
    note: 'Что изменить?', result: 'Скачать решения', changed: 'доработать', accepted: 'утверждено',
    context: 'Как звучит бой', contextCopy: 'Послушай, как эффекты накладываются друг на друга.',
    group: { army: 'Фигуры', battle: 'Бой', cards: 'Карты и исход' },
    loading: 'Загружаем список звуков…', loadError: 'Не удалось загрузить список звуков.', retry: 'Повторить',
    storageError: 'Браузер не сохранил решения. Скачай их перед закрытием страницы.',
    count: (approved: number, total: number) => 'Утверждено ' + approved + ' из ' + total,
  },
  en: {
    name: 'Colossus sound review', subtitle: 'Listen to each cue at game volume and mark your decision.',
    listen: 'Listen', stop: 'Stop', mute: 'Mute', unmute: 'Unmute',
    approved: 'Approve', revise: 'Revise', pending: 'Undecided', decision: 'Decision',
    note: 'What should change?', result: 'Download decisions', changed: 'to revise', accepted: 'approved',
    context: 'In battle', contextCopy: 'Hear how the effects sound together.',
    group: { army: 'Pieces', battle: 'Combat', cards: 'Cards and outcomes' },
    loading: 'Loading sounds…', loadError: 'Could not load the sound list.', retry: 'Retry',
    storageError: 'The browser could not save your decisions. Download them before closing the page.',
    count: (approved: number, total: number) => approved + ' of ' + total + ' approved',
  },
} as const;

function loadVerdicts(): Verdicts {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (!data || typeof data !== 'object') return {};
    return Object.fromEntries(SOUND_NAMES.flatMap(name => {
      const value = data[name];
      return value && typeof value.sha256 === 'string'
        && ['', 'approved', 'revise'].includes(value.decision) && typeof value.note === 'string'
        ? [[name, value]] : [];
    }));
  } catch { return {}; }
}

export function AudioReview() {
  const [language, setLanguage] = useState<Language>('ru');
  const [bank, setBank] = useState<Manifest | 'error' | null>(null);
  const [verdicts, setVerdicts] = useState(loadVerdicts);
  const [muted, setMuted] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const c = text[language];

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/assets/colossus/audio/manifest.json', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Missing sound bank');
        return await response.json() as Manifest;
      })
      .then(manifest => {
        if (!SOUND_NAMES.every(name => /^[0-9a-f]{64}$/.test(manifest.sounds?.[name]?.sha256))) throw new Error('Incomplete sound bank');
        setBank(manifest);
      })
      .catch(() => { if (!controller.signal.aborted) setBank('error'); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = c.name;
  }, [language, c.name]);

  const manifest = bank === 'error' ? null : bank;
  function currentVerdict(name: SoundName): Verdict | undefined {
    const verdict = verdicts[name];
    return manifest && verdict?.sha256 === manifest.sounds[name].sha256 ? verdict : undefined;
  }
  function updateVerdict(name: SoundName, patch: Partial<Pick<Verdict, 'decision' | 'note'>>) {
    if (!manifest) return;
    const verdict = currentVerdict(name) ?? { sha256: manifest.sounds[name].sha256, decision: '', note: '' };
    const next = { ...verdicts, [name]: { ...verdict, ...patch } };
    setVerdicts(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setStorageError(false);
    } catch { setStorageError(true); }
  }

  function start(action: () => void) {
    if (muted) return;
    stopSounds();
    setSoundEnabled(true);
    unlockSounds();
    action();
  }
  function playMoment(moment: Moment) {
    start(() => soundForEvents(moment.events, moment.details));
  }
  function toggleMute() {
    setSoundEnabled(muted);
    if (muted) unlockSounds();
    setMuted(!muted);
  }

  const approved = SOUND_NAMES.filter(name => currentVerdict(name)?.decision === 'approved').length;
  const revise = SOUND_NAMES.filter(name => currentVerdict(name)?.decision === 'revise').length;
  function download() {
    if (!manifest) return;
    const lines = ['# ' + c.name, '', c.count(approved, SOUND_NAMES.length) + ' · ' + revise + ' ' + c.changed, ''];
    for (const name of SOUND_NAMES) {
      const verdict = currentVerdict(name);
      const label = verdict?.decision ? c[verdict.decision] : c.pending;
      const note = verdict?.note.trim();
      lines.push('- **' + cues[name][language] + '** · ' + label + (note ? ' · ' + note : ''));
      lines.push('  ' + name + '.wav · SHA-256 ' + manifest.sounds[name].sha256);
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'colossus-sound-review.md';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <main className="review">
    <header className="review-header">
      <div className="masthead"><span>COLOSSUS</span><button type="button" onClick={() => setLanguage(language === 'ru' ? 'en' : 'ru')}
        aria-label={language === 'ru' ? 'Switch to English' : 'Переключить на русский'}>{language === 'ru' ? 'EN' : 'RU'}</button></div>
      <h1>{c.name}</h1>
      <p>{c.subtitle}</p>
      <div className="toolbar">
        <button type="button" onClick={toggleMute}>{muted ? c.unmute : c.mute}</button>
        <button type="button" onClick={stopSounds}>{c.stop}</button>
        <button type="button" className="export" onClick={download} disabled={!manifest}>{c.result}</button>
      </div>
      <div className="review-progress">
        <progress value={approved} max={SOUND_NAMES.length} aria-label={c.count(approved, SOUND_NAMES.length)}/>
        <p role="status">{c.count(approved, SOUND_NAMES.length)}{revise > 0 && <> · {revise} {c.changed}</>}</p>
      </div>
      {storageError && <p role="alert">{c.storageError}</p>}
    </header>

    {!bank && <p role="status">{c.loading}</p>}
    {bank === 'error' && <p role="alert">{c.loadError} <button type="button" onClick={() => location.reload()}>{c.retry}</button></p>}
    {manifest && <div className="review-content">
      <div className="sounds">{cueGroups.map(group => <section key={group} aria-labelledby={'group-' + group}>
        <h2 id={'group-' + group}>{c.group[group]}</h2>
        <ul>{SOUND_NAMES.filter(name => cues[name].group === group).map(name => {
          const label = cues[name][language], verdict = currentVerdict(name);
          return <li className="sound" key={name} data-sound={name}>
            <h3>{label}</h3>
            <div className="sound-controls">
              <button type="button" className="play" disabled={muted} aria-label={c.listen + ' · ' + label}
                onClick={() => start(() => playSound(name))}><span aria-hidden="true">▶</span> {c.listen}</button>
              <select aria-label={c.decision + ' · ' + label} value={verdict?.decision ?? ''} data-decision={verdict?.decision ?? ''}
                onChange={event => updateVerdict(name, { decision: event.target.value as Decision })}>
                <option value="">{c.pending}</option><option value="approved">{c.approved}</option><option value="revise">{c.revise}</option>
              </select>
            </div>
            {(verdict?.decision === 'revise' || verdict?.note) && <input className="sound-note" maxLength={240}
              aria-label={c.note + ' · ' + label} placeholder={c.note} value={verdict?.note ?? ''}
              onChange={event => updateVerdict(name, { note: event.target.value })}/>}
          </li>;
        })}</ul>
      </section>)}</div>
      <section className="moments" aria-labelledby="moments">
        <h2 id="moments">{c.context}</h2>
        <p>{c.contextCopy}</p>
        <ul>{moments.map(moment => <li key={moment.id}>
          <button type="button" data-moment={moment.id} disabled={muted} onClick={() => playMoment(moment)}>
            <span aria-hidden="true">▶</span> {moment.title[language]}
          </button>
        </li>)}</ul>
      </section>
    </div>}
  </main>;
}
