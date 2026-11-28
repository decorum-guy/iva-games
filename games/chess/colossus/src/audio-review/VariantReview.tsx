import { useEffect, useRef, useState } from 'react';
import type { Language } from '../core';
import { cuesForEvents, playSound, prepareSounds, setSoundEnabled, soundForEvents, stopSounds, unlockSounds } from '../ui/audio';
import type { SoundSamples } from '../ui/audio';
import { cues } from './cues';
import { downloadReview, loadSoundBank } from './reviewFiles';
import type { BankManifest } from './reviewFiles';
import { comparisons } from './variantChoices';
import type { Comparison, ReviewSound, Variant } from './variantChoices';

type Picks = Partial<Record<ReviewSound, { id: string; sha256: string }>>;
const pickKey = 'colossus.audio-variants.v1';
const copy = {
  ru: {
    title: 'Броня и щит', intro: 'Сравни текущий звук с тремя вариантами. Каждый можно послушать отдельно или в бою.',
    all: 'Весь набор звуков', separate: 'Отдельно', combined: 'В бою', select: 'Выбрать', selected: 'Выбрано',
    stop: 'Остановить', mute: 'Выключить звук', unmute: 'Включить звук', export: 'Скачать выбор',
    pending: 'Без решения', storageError: 'Браузер не сохранил выбор. Его можно скачать.',
    loadError: 'Не удалось загрузить исходный набор.', retry: 'Обновить страницу',
    status: (count: number) => 'Выбрано ' + count + ' из 2',
  },
  en: {
    title: 'Armor and shield', intro: 'Compare the current sound with three variants. Play each on its own or in a battle sequence.',
    all: 'Full sound list', separate: 'On its own', combined: 'In battle', select: 'Choose', selected: 'Selected',
    stop: 'Stop', mute: 'Mute', unmute: 'Unmute', export: 'Download choices',
    pending: 'Undecided', storageError: 'The browser could not save your choice. You can download it.',
    loadError: 'Could not load the original sound bank.', retry: 'Reload page',
    status: (count: number) => count + ' of 2 chosen',
  },
} as const;

function loadPicks(): Picks {
  try {
    const saved = JSON.parse(localStorage.getItem(pickKey) ?? 'null') as Picks | null;
    return saved && typeof saved === 'object' ? saved : {};
  } catch { return {}; }
}

export function VariantReview() {
  const [language, setLanguage] = useState<Language>('ru');
  const [bank, setBank] = useState<BankManifest | 'error' | null>(null);
  const [picks, setPicks] = useState(loadPicks);
  const [muted, setMuted] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const sequence = useRef(0);
  const c = copy[language];

  useEffect(() => {
    const abort = new AbortController();
    void loadSoundBank(abort.signal).then(setBank)
      .catch(() => { if (!abort.signal.aborted) setBank('error'); });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = 'COLOSSUS · ' + c.title;
  }, [language, c.title]);

  function stop() {
    sequence.current++;
    stopSounds();
  }
  function toggleMute() {
    stop();
    setSoundEnabled(muted);
    if (muted) unlockSounds();
    setMuted(!muted);
  }
  async function audition(comparison: Comparison, variant: Variant, inBattle: boolean) {
    if (muted) return;
    stop();
    const ticket = sequence.current;
    setSoundEnabled(true);
    unlockSounds();
    const { sound, moment } = comparison;
    const samples: SoundSamples | undefined = variant.url ? { [sound]: variant.url } : undefined;
    const names = inBattle ? cuesForEvents(moment.events, moment.details).map(cue => cue.name) : [sound];
    await prepareSounds(names, samples);
    if (ticket !== sequence.current || document.hidden) return;
    if (inBattle) soundForEvents(moment.events, moment.details, samples);
    else playSound(sound, variant.url);
  }

  function clipHash(sound: ReviewSound, variant: Variant): string | undefined {
    return variant.sha256 ?? (bank && bank !== 'error' ? bank.sounds[sound].sha256 : undefined);
  }
  function choice(comparison: Comparison) {
    const previous = picks[comparison.sound];
    if (!previous) return;
    return comparison.variants.find(variant => variant.id === previous.id && clipHash(comparison.sound, variant) === previous.sha256);
  }
  function choose(comparison: Comparison, variant: Variant) {
    const hash = clipHash(comparison.sound, variant);
    if (!hash) return;
    const next = { ...picks };
    if (choice(comparison)?.id === variant.id) delete next[comparison.sound];
    else next[comparison.sound] = { id: variant.id, sha256: hash };
    setPicks(next);
    try {
      localStorage.setItem(pickKey, JSON.stringify(next));
      setStorageError(false);
    } catch { setStorageError(true); }
  }
  function printChoice(variant: Variant) {
    return (variant.take ? variant.take + ' · ' : '') + variant.title[language];
  }
  const picked = comparisons.filter(comparison => !!choice(comparison)).length;
  function download() {
    const lines = ['# ' + c.title, ''];
    for (const comparison of comparisons) {
      const winner = choice(comparison);
      const result = winner ? printChoice(winner) + ' · SHA-256 ' + clipHash(comparison.sound, winner) : c.pending;
      lines.push('- ' + cues[comparison.sound][language] + ' · ' + result);
    }
    downloadReview('colossus-armor-and-shield-review.md', lines);
  }

  return <main className="review variant-review">
    <header className="review-header">
      <div className="masthead"><span>COLOSSUS</span><button type="button"
        aria-label={language === 'ru' ? 'Switch to English' : 'Переключить на русский'}
        onClick={() => setLanguage(language === 'ru' ? 'en' : 'ru')}>{language === 'ru' ? 'EN' : 'RU'}</button></div>
      <h1>{c.title}</h1>
      <p>{c.intro}</p>
      <div className="toolbar">
        <button type="button" onClick={toggleMute}>{muted ? c.unmute : c.mute}</button>
        <button type="button" onClick={stop}>{c.stop}</button>
        <button type="button" className="export" disabled={!picked} onClick={download}>{c.export}</button>
        <p role="status">{c.status(picked)}</p>
      </div>
      <a className="review-link" href="/audio-review.html">{c.all}</a>
      {storageError && <p role="alert">{c.storageError}</p>}
      {bank === 'error' && <p role="alert">{c.loadError} <button type="button" onClick={() => location.reload()}>{c.retry}</button></p>}
    </header>

    {comparisons.map(comparison => {
      const { sound, variants, description } = comparison;
      const title = cues[sound][language];
      const selected = choice(comparison)?.id;
      return <section className="comparison" key={sound} data-comparison={sound} aria-labelledby={'comparison-' + sound}>
        <h2 id={'comparison-' + sound}>{title}</h2>
        <p>{description[language]}</p>
        <ul className="variant-list">{variants.map(variant => {
          const label = printChoice(variant);
          const isSelected = variant.id === selected;
          return <li className="variant" key={variant.id} data-variant={variant.id}>
            <h3>{label}</h3>
            <p>{variant.description[language]}</p>
            <div className="variant-actions">
              <button type="button" disabled={muted} data-play="solo" className="play" aria-label={title + ' · ' + label + ' · ' + c.separate}
                onClick={() => void audition(comparison, variant, false)}>{c.separate}</button>
              <button type="button" disabled={muted} data-play="context" className="play" aria-label={title + ' · ' + label + ' · ' + c.combined}
                onClick={() => void audition(comparison, variant, true)}>{c.combined}</button>
            </div>
            <button type="button" className="pick" disabled={!clipHash(sound, variant)} aria-pressed={isSelected}
              aria-label={title + ' · ' + label + ' · ' + (isSelected ? c.selected : c.select)}
              onClick={() => choose(comparison, variant)}>{isSelected ? c.selected : c.select}</button>
          </li>;
        })}</ul>
      </section>;
    })}
  </main>;
}
