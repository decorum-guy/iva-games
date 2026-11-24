import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { translator } from '../i18n/catalog';
import type { Locale } from '../i18n/catalog';
import { playAuditionAudio, setAudioVolume, stopSceneAudio, unlockAudio } from '../scene/audio';
import DieThrow from '../scene/DieThrow';
import { Board } from '../ui/Board';
import { Seal } from '../ui/icons';
import { candidateFor, clipEdit, makePlayback, prepareLibrary, variantsFor } from './audio';
import type { Library, Variant } from './audio';
import { groupNames, variantName, words } from './copy';
import { createDemo, demoFrame, groups, stageOffsets } from './demos';
import type { Group } from './demos';

const selectionKey = 'remorse-audition-choices-v1';
const leadMs = 80;
const unchanged = () => {};
type Selections = Partial<Record<Group, Variant>>;
type Status = 'idle' | 'starting' | 'playing' | 'done' | 'blocked';

function readSelections(): Selections {
  try {
    const saved = JSON.parse(localStorage.getItem(selectionKey) ?? '{}') as Selections;
    return Object.fromEntries(groups.flatMap(group => {
      const value = saved[group];
      const valid = variantsFor(group).includes(value!) || group === 'promotion.queen' && variantsFor(group, true).includes(value!);
      return valid ? [[group, value]] : [];
    }));
  } catch { return {}; }
}

export function Auditions() {
  const [locale, setLocale] = useState<Locale>('ru');
  const [group, setGroup] = useState<Group>(groups[0]);
  const [full, setFull] = useState<Variant>('current');
  const [solo, setSolo] = useState<Variant>('P1-STONE-SOLO');
  const [stoneOnly, setStoneOnly] = useState(false);
  const [minor, setMinor] = useState<'bishop' | 'knight'>('bishop');
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [volume, setVolume] = useState(65);
  const [library, setLibrary] = useState<Library>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [sceneFailed, setSceneFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [status, setStatus] = useState<Status>('idle');
  const [elapsed, setElapsed] = useState(-1);
  const [epoch, setEpoch] = useState(0);
  const [motionKey, setMotionKey] = useState(0);
  const [selections, setSelections] = useState(readSelections);
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const [originalChant, setOriginalChant] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const token = useRef(0);
  const timers = useRef<number[]>([]);
  const about = useRef<HTMLDialogElement>(null);
  const summary = useRef<HTMLDialogElement>(null);
  const selectionText = useRef<HTMLTextAreaElement>(null);
  const t = useMemo(() => translator(locale), [locale]);
  const language = locale === 'ru' ? 0 : 1;
  const label = (key: keyof typeof words) => words[key][language];
  const groupName = (item: Group) => groupNames[item][language];
  const number = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 3 });
  const demo = useMemo(() => createDemo(group, minor, reduced), [group, minor, reduced]);
  const frame = useMemo(() => demoFrame(demo, elapsed, epoch), [demo, elapsed, epoch]);
  const queen = group === 'promotion.queen';
  const variant = stoneOnly ? solo : full;
  const shortChant = group === 'reaction.bloodlust' && variant === 'R2';
  const ready = Boolean(library && sceneReady && !sceneFailed && !loadFailed);
  const active = status === 'playing' || status === 'starting';
  const asset = library ? candidateFor(library, group, variant) : undefined;
  const edit = asset ? clipEdit(asset, demo) : undefined;
  const selectedCount = groups.filter(key => selections[key]).length;
  const formatChoice = (key: Group) => {
    const choice = selections[key];
    return choice ? variantName(choice, locale, key, true) : '—';
  };
  const completeChoice = groups.filter(key => selections[key]).map(key => `${groupName(key)} ${formatChoice(key)}`);
  const chosenQueen = selections['promotion.queen'];
  if (chosenQueen === 'P1' || chosenQueen === 'P2') completeChoice.push(`${label('fracture')} (${chosenQueen}) ${label('stoneInMix')}`);
  const text = completeChoice.join('; ');

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = `REMORSE · ${words.title[locale === 'ru' ? 0 : 1]}`;
  }, [locale]);
  useEffect(() => {
    let mounted = true;
    void prepareLibrary().then(assets => { if (mounted) setLibrary(assets); }, () => { if (mounted) setLoadFailed(true); });
    return () => { mounted = false; };
  }, [loadAttempt]);

  const cancel = useCallback(() => {
    const generation = ++token.current;
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
    stopSceneAudio();
    setElapsed(-1);
    setStatus('idle');
    setOriginalChant(false);
    setMotionKey(generation);
    return generation;
  }, []);
  useEffect(() => {
    const hide = () => { if (document.hidden) cancel(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', cancel);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', cancel);
      ++token.current;
      timers.current.forEach(window.clearTimeout);
      stopSceneAudio();
    };
  }, [cancel]);
  const onBoardReady = useCallback(() => setSceneReady(true), []);
  const onBoardFailure = useCallback(() => { cancel(); setSceneFailed(true); setSceneReady(false); }, [cancel]);

  async function play(event: MouseEvent<HTMLButtonElement>, chant = false) {
    if (!event.isTrusted || !ready || !library || document.hidden) return;
    const generation = cancel();
    setStatus('starting');
    setOriginalChant(chant);
    setAudioVolume(volume / 100);
    const unlocked = await unlockAudio(library.bank);
    if (generation !== token.current || document.hidden) return;
    if (!unlocked) { setStatus('blocked'); return; }
    const audio = makePlayback(library, group, variant, demo, chant);
    const startedAt = performance.now() + leadMs;
    if (!playAuditionAudio(audio.cues, audio.clip, startedAt, reduced)) {
      setStatus('blocked');
      return;
    }
    setEpoch(startedAt);
    setStatus('playing');
    if (!chant) setHasPlayed(true);
    function schedule(offset: number, run: () => void) {
      timers.current.push(window.setTimeout(() => {
        if (generation === token.current) run();
      }, Math.max(0, startedAt + offset - performance.now())));
    }
    if (!chant) for (const offset of stageOffsets(demo)) schedule(offset, () => setElapsed(offset));
    const clipEnd = audio.clip ? (audio.clip.at + audio.clip.duration) * 1000 : 0;
    const stockEnd = audio.cues.length ? (audio.cues.at(-1)!.at + .28) * 1000 : 0;
    schedule(Math.max(chant ? 0 : demo.plan.end, clipEnd, stockEnd), () => {
      setStatus('done');
      setOriginalChant(false);
      timers.current = [];
    });
  }

  function changeGroup(value: Group) {
    if (value === group) return;
    cancel();
    setGroup(value);
    setFull('current');
    setStoneOnly(false);
    setHasPlayed(false);
  }

  function choose() {
    const next = { ...selections, [group]: variant };
    setSelections(next);
    setCopied(false);
    setManualCopy(false);
    try { localStorage.setItem(selectionKey, JSON.stringify(next)); } catch { /* An in-memory list still works. */ }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setManualCopy(false);
    } catch {
      if (!summary.current?.open) summary.current?.showModal();
      setManualCopy(true);
      selectionText.current?.select();
    }
  }

  const statusText = sceneFailed ? label('graphics') : loadFailed ? label('failed') : !ready ? label('loading')
    : status === 'starting' ? label('starting') : status === 'playing' ? label('playing')
      : status === 'blocked' ? label('blocked') : status === 'done' ? label('done') : label('ready');
  const result = frame.revealed ? demo.plan.promotion ? t(`piece.${demo.result.type}`) : t(`state.${demo.result.affliction}`) : undefined;

  return <div className="audition" data-testid="audition" data-group={group} data-variant={variant}
    data-motion={reduced ? 'reduced' : 'normal'} data-status={status} data-epoch={elapsed >= 0 ? epoch : undefined}
    data-stage={frame.stage ?? (elapsed < 0 ? 'idle' : frame.rolling ? 'roll' : 'result')}
    data-dice={demo.face && elapsed >= 0 ? frame.rolling ? 'throwing' : 'settled' : 'none'}
    data-affliction={elapsed >= 0 ? frame.state.pieces.find(piece => piece.square === demo.result.square)?.affliction : undefined}>
    <header className="audition-header">
      <div className="audition-brand"><Seal /><span>REMORSE</span></div>
      <h1>{label('title')}</h1>
      <div className="language-switch" role="group" aria-label="Рус / EN">
        <button type="button" lang="ru" aria-pressed={locale === 'ru'} onClick={() => setLocale('ru')}>Рус</button>
        <button type="button" lang="en" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>EN</button>
      </div>
    </header>

    <main className="audition-layout">
      <section className="audition-stage" aria-label={label('demo')}>
        <Board key={loadAttempt} t={t} state={frame.state} events={frame.events} marks={[]}
          flipped={false} flat={false} reducedMotion={reduced} followSystemMotion={false} low={false}
          canMove={false} camera="studio" motionKey={`${demo.key}/${motionKey}`} cameraResetKey={`${demo.key}/${motionKey}`} onReady={onBoardReady}
          onSquare={unchanged} onDragSquare={unchanged} onClear={unchanged} onFailure={onBoardFailure}
          promotion={frame.promotion} />
        <div className="audition-caption">
          <div><span>{label('demo')}</span><strong>{demo.notation}</strong></div>
          <span className="audition-result" role="status">{frame.rolling ? t('die.rolling') : result}</span>
          <div className="audition-die" data-visible={Boolean(demo.face && elapsed >= 0)} aria-hidden="true">
            {demo.face && <DieThrow face={demo.face} rollKey={demo.key} startedAt={elapsed >= 0 ? epoch : 0}
              reduced={reduced} quality="low" />}
          </div>
          {demo.face && frame.revealed && <output className="audition-face" aria-label={t('die.face', { face: demo.face })}>{demo.face}</output>}
        </div>
      </section>

      <section className="audition-controls" aria-label={label('sound')}>
        <div className="audition-session">
          <label className="audition-event">
            <span className="sr-only">{label('scene')}</span>
            <select aria-label={label('scene')} value={group} onChange={event => changeGroup(event.target.value as Group)}>
              {groups.map(key => <option key={key} value={key}>{groupName(key)}</option>)}
            </select>
          </label>
          {queen && <div className="segmented audition-mode" role="group" aria-label={label('queenLayers')}>
            <button type="button" aria-pressed={!stoneOnly} onClick={() => { if (stoneOnly) { cancel(); setStoneOnly(false); } }}>{label('full')}</button>
            <button type="button" aria-pressed={stoneOnly} onClick={() => { if (!stoneOnly) { cancel(); setStoneOnly(true); } }}>{label('solo')}</button>
          </div>}
          {group === 'promotion.formation' && <div className="segmented audition-mode" role="group" aria-label={label('minor')}>
            {(['bishop', 'knight'] as const).map(kind => <button type="button" aria-pressed={minor === kind} key={kind}
              onClick={() => { if (minor !== kind) { cancel(); setMinor(kind); } }}>{label(kind)}</button>)}
          </div>}
          <div className="segmented audition-variants" role="group" aria-label={label('sound')}>
            {variantsFor(group, stoneOnly).map(item => <button key={item} type="button" aria-pressed={variant === item}
              onClick={() => { if (variant !== item) { cancel(); if (stoneOnly) setSolo(item); else setFull(item); } }}>
              {variantName(item, locale, group)}
            </button>)}
          </div>
          <div className="audition-transport" aria-label={label('play')} role="group">
            <button type="button" className="audition-primary" onClick={event => { void play(event); }} disabled={!ready}>{label('play')}</button>
            <button type="button" onClick={event => { void play(event); }} disabled={!ready || !hasPlayed}>{label('replay')}</button>
            <button type="button" onClick={cancel} disabled={!active && elapsed < 0}>{label('stop')}</button>
          </div>
          <div className="audition-status" role="status">
            {statusText}{shortChant && ready && <> · {label('shortChant')}</>}
            {(loadFailed || sceneFailed) && <button type="button" onClick={() => {
              cancel(); setLoadFailed(false); setSceneFailed(false); setLoadAttempt(value => value + 1);
            }}>{label('retry')}</button>}
          </div>
          <div className="audition-settings">
            <label className="audition-volume"><span>{label('volume')}</span>
              <input type="range" min="0" max="100" step="1" value={volume} onChange={event => {
                const value = event.target.valueAsNumber; setVolume(value); setAudioVolume(value / 100);
              }} /><output>{volume}%</output>
            </label>
            <label className="audition-motion"><input type="checkbox" checked={reduced}
              onChange={event => { cancel(); setReduced(event.target.checked); }} />{label('motion')}</label>
          </div>
          <div className="audition-actions">
            <button type="button" onClick={choose} aria-pressed={selections[group] === variant}>
              {selections[group] === variant ? label('chosen') : label('choose')}
            </button>
            <button type="button" className="audition-quiet" onClick={() => about.current?.showModal()}>{label('details')}</button>
          </div>
        </div>
        <section className="audition-picks" aria-label={label('picks')}>
          <div className="audition-picks-bar">
            <button type="button" className="audition-picks-link" onClick={() => summary.current?.showModal()}>
              {label('picks')} <span>{selectedCount}/7</span>
            </button>
            <button type="button" className="audition-quiet" onClick={() => { void copy(); }} disabled={!selectedCount}>
              {copied ? label('copied') : label('copy')}
            </button>
          </div>
          <dl className="audition-picks-list">
            {groups.map(key => <div key={key}><dt>{groupName(key)}</dt><dd>{formatChoice(key)}</dd></div>)}
          </dl>
        </section>
      </section>
    </main>

    <dialog className="audition-dialog" aria-labelledby="audition-about" ref={about} onClose={() => { if (originalChant) cancel(); }}>
      <div className="audition-dialog-head"><h2 id="audition-about">{label('details')}</h2>
        <button type="button" aria-label={label('close')} onClick={() => about.current?.close()}>×</button></div>
      <p className="audition-dialog-lead">{groupName(group)} · {variantName(variant, locale, group, true)}</p>
      {asset && edit && library ? <>
        <dl className="audition-numbers">
          <div><dt>{label('input')}</dt><dd>{asset.file} · {number(asset.decoded_duration_seconds)} {label('secondUnit')}</dd></div>
          <div><dt>{label('cut')}</dt><dd>{number(edit.offset)}–{number(edit.offset + edit.duration)} {label('secondUnit')}</dd></div>
          <div><dt>{label('offset')}</dt><dd>{number(edit.at)} {label('secondUnit')}</dd></div>
          <div><dt>{label('level')}</dt><dd>{edit.decibels} {label('decibels')}</dd></div>
          <div><dt>{label('fades')}</dt><dd>{number(edit.fadeIn)} / {number(edit.fadeOut)} {label('secondUnit')}</dd></div>
        </dl>
        <h3>{label('source')}</h3>
        <ul className="audition-sources">{asset.source_ids.map(id => {
          const source = library.catalog.sources[id];
          return <li key={id}><a href={source.page_url ?? source.source_url} target="_blank" rel="noreferrer">{source.original_filename}</a>
            <span>{source.creator ?? source.author} · <a href={source.license_url} target="_blank" rel="noreferrer">{source.license}</a></span></li>;
        })}</ul>
        {shortChant && <div className="audition-original">
          <button type="button" disabled={!ready} onClick={event => { void play(event, true); }}>{label('rawChant')}</button>
          <button type="button" disabled={!originalChant || !active} onClick={cancel}>{label('stop')}</button>
        </div>}
      </> : <p>{variant === 'current' || variant === 'CURRENT-STONE-SOLO' ? label('stockDetails') : label('loading')}</p>}
    </dialog>

    <dialog className="audition-dialog" aria-labelledby="audition-summary" ref={summary}>
      <div className="audition-dialog-head"><h2 id="audition-summary">{label('picks')}</h2>
        <button type="button" aria-label={label('close')} onClick={() => summary.current?.close()}>×</button></div>
      <dl className="audition-summary-list">{groups.map(key => <div key={key}><dt>{groupName(key)}</dt>
        <dd>{selections[key] ? formatChoice(key) : label('pending')}</dd></div>)}</dl>
      {selectedCount > 0 && <>
        <p>{manualCopy ? label('manualCopy') : label('send')}</p>
        <textarea ref={selectionText} aria-label={label('picks')} readOnly value={text} />
        <button type="button" onClick={() => { void copy(); }}>{copied ? label('copied') : label('copy')}</button>
      </>}
    </dialog>
  </div>;
}
