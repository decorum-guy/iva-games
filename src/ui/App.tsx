import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { canClaimRepetition, createInitialState, fileOf, isInCheck, opposite, pieceAt } from '../core';
import type { Command, GameEvent, Move, Promotion, Side, Square } from '../core';
import { translator } from '../i18n/catalog';
import { Cabinet } from '../session/cabinet';
import { captureLedger } from '../session/match';
import { exportMatch } from '../session/save';
import { guideCommands, instruction, teachingBeat } from '../tutorial/controller';
import { muteAudio, playSceneCue, prepareSceneAudio, setAudioVolume, stopSceneAudio, unlockAudio } from '../scene/audio';
import type { SceneFocus, SceneMark } from '../scene/types';
import { Board } from './Board';
import {
  CaptureDialog, Dialog, LanguagePicker, ProfileDialog, PromotionDialog, RulesDialog, SavesDialog, SettingsDialog, SetupDialog,
} from './Dialogs';
import type { Settings } from './Dialogs';
import { PlayerRow } from './Hud';
import { Icon, Seal } from './icons';
import { History, Inspector, LessonPanel, PanelNotice, prepareDieRenderer, Result, RollCard, RollReveal } from './PlayPanel';
import { materialBalance } from './projections';
import { maskRollResult, rollSceneEvents } from './rollPresentation';

type Modal =
  | { kind: 'settings' | 'rules' | 'profile' | 'saves' | 'resign' | 'draw' | 'exit' | 'restart' | 'restart-all' | 'repeat' | 'technical' }
  | { kind: 'setup'; hotseat: boolean; choice?: boolean }
  | { kind: 'capture'; side: Side };

const cabinet = new Cabinet();
const preview = createInitialState();
const noEvents: readonly GameEvent[] = [];
const PREFS_KEY = 'remorse-settings-v1';
const defaults: Settings = { locale: 'ru', board: '3d', camera: 'studio', quality: 'auto', autoFlip: false, reduce: false, sound: true, volume: .65 };

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Settings>;
    return {
      locale: saved.locale === 'en' ? 'en' : 'ru', board: saved.board === '2d' ? '2d' : '3d',
      camera: saved.camera === 'tactical' || saved.camera === 'top' ? saved.camera : 'studio',
      quality: saved.quality === 'high' || saved.quality === 'low' ? saved.quality : 'auto',
      autoFlip: saved.autoFlip === true, reduce: saved.reduce === true, sound: saved.sound !== false,
      volume: typeof saved.volume === 'number' && Number.isFinite(saved.volume) ? Math.max(0, Math.min(1, saved.volume)) : defaults.volume,
    };
  } catch { return defaults; }
}

function useQuery(query: string) {
  const [value, setValue] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const sync = () => setValue(media.matches);
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [query]);
  return value;
}

export function App() {
  const snap = useSyncExternalStore(cabinet.subscribe, cabinet.getSnapshot);
  const [settings, setSettings] = useState(loadSettings);
  const sounded = useRef<string | undefined>(undefined);
  const [modal, setModal] = useState<Modal | null>(null);
  const [selection, setSelection] = useState<{ key: string; id: string } | null>(null);
  const [promotion, setPromotion] = useState<{ key: string; move: Move } | null>(null);
  const [review, setReview] = useState<{ key: string; cursor: number } | null>(null);
  const [flip, setFlip] = useState(false);
  const [graphicsFailed, setGraphicsFailed] = useState(false);
  const [mobileDetails, setMobileDetails] = useState(false);
  const [inspectedStep, setInspectedStep] = useState<string | null>(null);
  const narrow = useQuery('(max-width: 740px)');
  const systemMotion = useQuery('(prefers-reduced-motion: reduce)');
  const reduced = settings.reduce || systemMotion;
  const t = useMemo(() => translator(settings.locale), [settings.locale]);
  const { view, learning, game } = snap;
  const lesson = view === 'learn' ? learning : null;
  const session = view === 'game' ? game : lesson?.session ?? null;
  const reviewing = review && review.key === snap.motionKey && session ? review.cursor : null;
  const position = (reviewing !== null ? session?.review(reviewing).state : session?.state) ?? preview;
  const config = session?.record.config;
  const actor = position.side;
  const flat = settings.board === '2d' || graphicsFailed;
  const low = settings.quality === 'low' || (settings.quality === 'auto' && narrow);
  const reversed = (config?.mode === 'hotseat' && settings.autoFlip ? actor === 'black' : config?.human === 'black') !== flip;
  const nearSide = reversed ? 'black' : 'white';
  const farSide = opposite(nearSide);
  const beat = lesson ? teachingBeat(lesson) : undefined;
  // A required observation owns the screen until the learner acknowledges it.
  // Do not leak the next opponent move or exercise into that explanation.
  const step = lesson && !beat ? instruction(lesson) : null;
  const moves = useMemo(() => session && !position.outcome ? session.legal() : [], [session, position.outcome]);
  const guidance = useMemo(() => lesson ? guideCommands(lesson) : [], [lesson]);
  const active = Boolean(session && !position.outcome && reviewing === null);
  const humanActing = config?.mode === 'hotseat' || config?.human === actor;
  const boosted = active && position.phase === 'bonus';
  const selectedId = selection?.key === snap.motionKey ? selection.id : boosted ? position.bonusPieceId : null;
  const selected = position.pieces.find(piece => piece.id === selectedId);
  const tutorialMode = !lesson ? 'none' : beat ? 'result' : lesson.complete ? 'complete' : step?.kind ?? 'position-complete';
  const teachingMove = !lesson || step?.kind === 'move' || step?.kind === 'illegal';
  const canInput = active && snap.ready && !snap.storageProblem && !snap.animating && !snap.teachingReturning && !snap.busy && humanActing && !snap.thinking && teachingMove && !lesson?.complete;
  const canLeaveForPractice = !position.outcome && !beat && !snap.animating && !snap.teachingReturning;
  const shownMoves = lesson ? step?.kind === 'move' ? guidance : [] : moves;
  const mayEnd = moves.some(move => move.type === 'endTurn') && (!lesson || guidance.some(move => move.type === 'endTurn'));
  const showRoll = reviewing === null && session && snap.rollId && session.record.cursor > 0;
  const latest = session?.current.events ?? noEvents;
  const rollPending = Boolean(showRoll && snap.rollPhase === 'throwing');
  const liveRoll = Boolean(showRoll && snap.audioCue?.id === `${session?.record.id}/${snap.rollId}`);
  // Only the renderer uses this projection. Legality, AI, ledgers and saves
  // continue to use the committed position while the die reveals its outcome.
  const boardPosition = useMemo(() => rollPending && session
    ? maskRollResult(position, session.review(session.record.cursor - 1).state) : position,
  [rollPending, session, position]);
  const boardEvents = useMemo(() => reviewing !== null ? noEvents : liveRoll
    ? rollSceneEvents(latest, rollPending ? 'throwing' : 'revealed') : latest,
  [reviewing, liveRoll, latest, rollPending]);
  const inspectionKey = lesson && step?.kind === 'inspect'
    ? `${snap.motionKey}/${lesson.lesson}/${lesson.position}/${step.id}` : null;
  const inspected = inspectionKey !== null && inspectedStep === inspectionKey;
  const tutorialFocus = useMemo<SceneFocus | undefined>(() => {
    if (!lesson || lesson.complete || rollPending || snap.teachingReturning) return undefined;
    const target = beat?.focus ?? step?.focus
      ?? (step?.kind === 'inspect' ? { square: step.square, subject: 'piece' as const } : undefined);
    if (!target || !position.pieces.some(piece => piece.square === target.square)) return undefined;
    const identity = beat ? `${lesson.pendingTeaching!.stepId}/${beat.id}` : step?.id;
    // Start the close-up on the same reveal as the newly visible material.
    // No historical-event scan: finishing an exercise must not replay its effect.
    return { ...target, key: `${snap.motionKey}/${lesson.lesson}/${lesson.position}/${identity}` };
  }, [lesson, beat, step, position.pieces, rollPending, snap.teachingReturning, snap.motionKey]);
  const rollDock = tutorialFocus && ((fileOf(tutorialFocus.square) >= 4) !== reversed ? 'left' : 'right');
  const teachingHud = !rollPending ? beat?.hud ?? step?.hud : undefined;
  const activePromotion = promotion?.key === snap.motionKey ? promotion.move : null;
  const allowedPromotions = activePromotion && lesson ? guidance.flatMap(command =>
    command.type === 'move' && command.from === activePromotion.from && command.to === activePromotion.to && command.promotion
      ? [command.promotion] : []) as Promotion[] : undefined;
  const lastMove = [...latest].reverse().find(event => event.type === 'move');
  const kingThreat = isInCheck(position);
  const captures = useMemo(() => session
    ? reviewing === null ? captureLedger(session) : [
      ...session.record.rootLedger, ...session.eventsAt(reviewing).filter(event => event.type === 'capture'),
    ] : [], [reviewing, session]);
  const balance = materialBalance(position);
  const teachingHudSide = teachingHud === 'material' && balance !== 0
    ? balance > 0 ? 'white' : 'black' : config?.human;
  const pending = snap.matches.find(match => match.id === snap.profile.ratedId);
  const resume = snap.matches.find(match => match.status === 'open' && match.config.mode !== 'rated') ??
    (!snap.durable && game?.record.status === 'open' ? game.record : undefined);

  useEffect(() => { void cabinet.initialize(); }, []);
  useEffect(() => {
    document.documentElement.lang = settings.locale;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(settings)); } catch { /* A private profile may deny writes. */ }
  }, [settings]);
  useEffect(() => { cabinet.setShortMotion(reduced); }, [reduced]);
  useEffect(() => { cabinet.setTeachingCamera(!flat); }, [flat]);
  useEffect(() => {
    if (view !== 'home') void prepareDieRenderer();
  }, [view]);
  useEffect(() => {
    const playing = view !== 'home';
    document.documentElement.classList.toggle('in-match', playing);
    window.scrollTo(0, 0);
    return () => document.documentElement.classList.remove('in-match');
  }, [view]);
  useEffect(() => {
    setAudioVolume(settings.volume);
    if (settings.sound) void prepareSceneAudio();
    else muteAudio();
    const wake = () => { if (settings.sound) void unlockAudio(); };
    document.addEventListener('pointerdown', wake, { capture: true });
    document.addEventListener('keydown', wake, { capture: true });
    return () => {
      document.removeEventListener('pointerdown', wake, { capture: true });
      document.removeEventListener('keydown', wake, { capture: true });
    };
  }, [settings.sound, settings.volume]);
  useEffect(() => { stopSceneAudio(); }, [snap.motionKey, reviewing]);
  useEffect(() => {
    const cue = snap.audioCue;
    if (!cue || cue.id === sounded.current) return;
    sounded.current = cue.id;
    if (settings.sound && view !== 'home' && reviewing === null) {
      playSceneCue(cue.events, { reducedMotion: cue.events.some(event => event.type === 'reaction' && event.face !== undefined)
        ? snap.rollReduced : reduced, humanSide: cue.human, startedAt: cue.startedAt });
    }
  }, [snap.audioCue, snap.rollReduced, settings.sound, view, reviewing, reduced]);

  const onFailure = useCallback(() => { setGraphicsFailed(true); }, []);
  const close = () => setModal(null);

  function changeSettings(fields: Partial<Settings>) {
    if (fields.volume !== undefined) setAudioVolume(fields.volume);
    if (fields.sound === true) void unlockAudio();
    if (fields.sound === false) muteAudio();
    if (fields.board === '3d') setGraphicsFailed(false);
    setSettings(current => ({ ...current, ...fields }));
  }

  function openSetup(hotseat = false, choice = true) {
    setModal({ kind: 'setup', hotseat, choice });
  }

  function perform(command: Command) {
    if (settings.sound) void unlockAudio();
    void cabinet.command(command);
  }

  function enter(move: Move) {
    if (!canInput) return;
    if (moves.some(choice => choice.type === 'move' && choice.from === move.from && choice.to === move.to && choice.promotion)) {
      setPromotion({ key: snap.motionKey, move });
    } else {
      perform(move);
    }
  }

  function useSquare(square: Square) {
    if (!session || snap.busy || snap.animating || snap.teachingReturning || beat) return;
    const occupant = pieceAt(position, square);
    if (lesson && step?.kind === 'inspect' && step.square === square) {
      if (occupant) setSelection({ key: snap.motionKey, id: occupant.id });
      setInspectedStep(inspectionKey);
      return;
    }
    const directedMove = guidance.some(choice => choice.type === 'move' && choice.from === selected?.square && choice.to === square);
    const availableMove = moves.some(choice => choice.type === 'move' && choice.from === selected?.square && choice.to === square);
    if (canInput && selected?.side === actor && selected.square !== square &&
      (!occupant || occupant.side !== actor || directedMove || availableMove)) {
      enter({ type: 'move', from: selected.square, to: square });
      return;
    }
    setSelection(occupant ? { key: snap.motionKey, id: occupant.id } : null);
    cabinet.dismissError();
  }

  const marks: SceneMark[] = [];
  if (lastMove && reviewing === null) marks.push({ square: lastMove.from, kind: 'last' }, { square: lastMove.to, kind: 'last' });
  const king = kingThreat && position.pieces.find(piece => piece.type === 'king' && piece.side === actor);
  if (king && !rollPending) marks.push({ square: king.square, kind: 'check' });
  if (selected) {
    marks.push({ square: selected.square, kind: 'selected' });
    if (canInput && selected.side === actor) {
      const seen = new Set<Square>();
      for (const choice of shownMoves) {
        if (choice.type !== 'move' || choice.from !== selected.square || seen.has(choice.to)) continue;
        const target = pieceAt(position, choice.to);
        const enPassant = selected.type === 'pawn' && choice.from[0] !== choice.to[0];
        marks.push({ square: choice.to, kind: target?.side === actor ? 'friendly' : target || enPassant ? 'capture' : 'move' });
        seen.add(choice.to);
      }
    }
  }
  if (step?.kind === 'inspect') marks.push({ square: step.square, kind: 'lesson' });
  if (tutorialFocus && !marks.some(mark => mark.square === tutorialFocus.square && mark.kind === 'lesson')) {
    marks.push({ square: tutorialFocus.square, kind: 'lesson' });
  }
  if (step && (step.kind === 'illegal' || (step.kind === 'move' && step.moves !== 'open'))) {
    const spotlight = new Set<string>();
    for (const move of guidance) {
      if (move.type === 'move') { spotlight.add(move.from); spotlight.add(move.to); }
    }
    for (const square of spotlight) marks.push({ square, kind: 'lesson' });
  }

  function resumeGame(id: string) {
    void cabinet.resumeGame(id).then(ok => { if (ok) { close(); setFlip(false); } });
  }

  function download() {
    if (!session || lesson) return;
    const url = URL.createObjectURL(new Blob([exportMatch(session)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `remorse-${session.record.id.slice(0, 8)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const notice = snap.error && !snap.storageProblem && <PanelNotice onClose={cabinet.dismissError} label={t('nav.close')}>{t(`error.${snap.error}`)}</PanelNotice>;
  const storageNotice = (snap.storageProblem || (snap.ready && !snap.durable)) && <div className="notice"
    role={snap.storageProblem ? 'alert' : 'status'} data-testid="storage-recovery">
    <div>
      <p>{t(snap.storageProblem ? `error.${snap.storageProblem}` : 'storage.memory')}</p>
      <div className="recovery-actions">
        <button type="button" className="button compact" data-testid="retry-storage" disabled={snap.busy || !snap.ready}
          onClick={() => { void cabinet.retryStorage(); }}>{t(snap.ready ? 'storage.retry' : 'storage.opening')}</button>
      </div>
    </div>
  </div>;
  const mode = config?.mode;

  return <>
    <header className="masthead">
      <div className="top-bar">
        <button className="brand" type="button" aria-label={view === 'home' ? 'REMORSE' : t('nav.menu')}
          onClick={() => { if (lesson) setModal({ kind: 'exit' }); else void cabinet.home(); }}>
          <Seal /><span>REMORSE</span>
        </button>
        <span className="mode-indicator">{mode && t(`setup.${mode}`)}</span>
        <div className="top-actions">
          <LanguagePicker t={t} locale={settings.locale} onLocale={locale => changeSettings({ locale })} />
          <span className="nav-separator" />
          <button type="button" className="icon-button sound-toggle" data-testid="sound-toggle" aria-pressed={settings.sound}
            title={t(settings.sound ? 'settings.mute' : 'settings.unmute')} aria-label={t(settings.sound ? 'settings.mute' : 'settings.unmute')}
            onClick={() => changeSettings({ sound: !settings.sound })}><Icon name={settings.sound ? 'sound' : 'muted'} /></button>
          <button type="button" className="icon-button rules-button" title={t('nav.rules')} aria-label={t('nav.rules')} onClick={() => setModal({ kind: 'rules' })}>
            <Icon name="book" />
          </button>
          <button type="button" className="icon-button profile-button" title={t('nav.profile')} aria-label={t('nav.profile')} onClick={() => setModal({ kind: 'profile' })}>
            <Icon name="profile" />
          </button>
          <button type="button" className="icon-button" data-testid="settings" title={t('nav.settings')} aria-label={t('nav.settings')}
            onClick={() => setModal({ kind: 'settings' })}><Icon name="settings" /></button>
        </div>
      </div>
    </header>

    <main className={`playfield view-${view}`} data-testid="playfield" data-view={view} data-mode={mode ?? 'preview'}
      data-tutorial-mode={tutorialMode}
      data-tutorial-focus={tutorialFocus ? 'true' : 'false'}
      data-tutorial-hud={teachingHud}
      data-teaching-returning={snap.teachingReturning}
      data-dice={showRoll && snap.animating ? snap.rollPhase : 'none'}
      data-active-side={actor} data-turn={position.turnSerial} data-phase={position.phase}
      data-revision={session?.record.revision ?? 0} data-game-id={session?.record.id ?? 'preview'}
      data-storage-problem={snap.storageProblem ?? 'none'}
      data-busy={snap.busy} data-animating={snap.animating} data-thinking={snap.thinking}>
      <div className="table-column" data-testid="board">
        <PlayerRow t={t} locale={settings.locale} side={farSide} config={config} active={active && actor === farSide}
          teachingFocus={farSide === teachingHudSide ? teachingHud : undefined}
          captures={captures} advantage={farSide === 'white' ? balance : -balance} rating={snap.profile.rating}
          onCaptures={side => setModal({ kind: 'capture', side })} />
        <Board t={t} state={boardPosition} marks={marks} events={boardEvents} flipped={reversed}
          flat={flat} reducedMotion={reduced} camera={settings.camera} low={low}
          canMove={canInput}
          focus={tutorialFocus}
          motionKey={`${snap.motionKey}/${reviewing ?? 'live'}`} onSquare={useSquare}
          onDragSquare={(from, to) => enter({ type: 'move', from, to })} onFailure={onFailure}
          onClear={() => setSelection(null)}
          overlay={showRoll && snap.animating && snap.rollPhase !== 'idle' && <RollReveal t={t} session={session} rollId={snap.rollId!}
            reduced={snap.rollReduced} low={low} pending={snap.rollPhase === 'throwing'}
            startedAt={snap.rollStartedAt ?? undefined} focusDock={rollDock} />} />
        <PlayerRow t={t} locale={settings.locale} side={nearSide} config={config} active={active && actor === nearSide}
          teachingFocus={nearSide === teachingHudSide ? teachingHud : undefined}
          captures={captures} advantage={nearSide === 'white' ? balance : -balance} rating={snap.profile.rating}
          onCaptures={side => setModal({ kind: 'capture', side })} />
        <div className="board-toolbar">
          <div className="segmented small-segment" aria-label={t('settings.view')} role="group">
            <button type="button" aria-pressed={!flat} data-testid="marble-mode" onClick={() => changeSettings({ board: '3d' })}>3D</button>
            <button type="button" aria-pressed={flat} data-testid="flat-mode" onClick={() => changeSettings({ board: '2d' })}>2D</button>
          </div>
          <button type="button" className="icon-button" data-testid="flip" title={t('settings.flip')}
            aria-label={t('settings.flip')} onClick={() => setFlip(value => !value)}><Icon name="flip" /></button>
          <button type="button" className="icon-button camera-toggle" aria-label={t('settings.camera')} title={t('settings.camera')}
            onClick={() => changeSettings({ camera: settings.camera === 'studio' ? 'tactical' : settings.camera === 'tactical' ? 'top' : 'studio' })}
            disabled={flat}><Icon name="camera" /></button>
        </div>
      </div>

      <aside className="game-aside" data-testid="game-aside">
        {graphicsFailed && <div className="notice" role="status" data-testid="fallback">
          <span>{t('settings.fallback')}</span><button type="button" className="text-button" onClick={() => changeSettings({ board: '3d' })}>{t('settings.retry3D')}</button>
        </div>}
        {view === 'home' ? <section className="home-panel">
          <div className="home-intro">
            <h1>{t('home.title')}</h1><p className="home-introduction" data-testid="home-introduction">{t('home.prompt')}</p>
          </div>
          {notice}
          {storageNotice}
          {snap.ready ? <div className="play-options">
            {pending && <button type="button" className="button primary mode-button" disabled={Boolean(snap.storageProblem)} onClick={() => resumeGame(pending.id)} data-testid="home-resume-rated">
              <Icon name="history" /><span>{t('home.resumeRated')}</span><Icon name="right" />
            </button>}
            {resume && <button type="button" className={`button ${pending ? '' : 'primary'} mode-button`} disabled={Boolean(snap.storageProblem)} onClick={() => resumeGame(resume.id)} data-testid="home-resume">
              <Icon name="history" /><span>{t('home.resume')}</span><Icon name="right" />
            </button>}
            <button type="button" className={`button ${pending || resume ? '' : 'primary'} mode-button`} data-testid="mode-ai" onClick={() => openSetup(false, false)}>
              <Icon name="helmet" /><span>{t('home.playAI')}</span><Icon name="right" />
            </button>
            <button type="button" className="button mode-button" data-testid="mode-hotseat" onClick={() => openSetup(true, false)}>
              <Icon name="local" /><span>{t('home.hotseat')}</span><Icon name="right" />
            </button>
            <button type="button" className="button mode-button" data-testid="mode-learn" disabled={!snap.durable} onClick={() => { void cabinet.learn(); setFlip(false); }}>
              <Icon name="bookOpen" /><span>{t(learning?.complete ? 'home.learnResult' : learning ? 'home.resumeLearn' : 'home.learn')}</span><Icon name="right" />
            </button>
          </div> : <p role="status">{t('storage.opening')}</p>}
          <div className="home-footer">
            <button type="button" className="text-button" data-testid="saved-games" onClick={() => setModal({ kind: 'saves' })}><Icon name="folder" />{t('home.saved')}</button>
            <button type="button" className="text-button" onClick={() => setModal({ kind: 'profile' })}>{t('nav.profile')}</button>
            {learning && !learning.complete && <button type="button" className="text-button" disabled={!snap.durable} onClick={() => setModal({ kind: 'restart-all' })}>
              {t('tutorial.restartAll')}
            </button>}
          </div>
        </section> : session && <>
          {notice}
          {storageNotice}
          <div className="decision-row" hidden={Boolean(lesson && beat)}>
          {session.state.outcome && !lesson && !rollPending ? <Result t={t} locale={settings.locale} session={session}
            entry={snap.ledger.find(entry => entry.matchId === session.record.id)} onNew={() => openSetup(mode === 'hotseat')} />
            : <div className="turn-panel" data-testid="turn-panel">
              <div className="turn-heading" role="status"><span className={`mini-stamp ${actor}`} aria-hidden="true" />
                <strong>{t(!snap.ready ? 'storage.opening' : snap.storageProblem ? 'storage.paused' : snap.busy ? 'storage.saving' : rollPending ? 'die.rolling' : snap.thinking ? 'game.thinking' : step?.kind === 'script' ? 'game.script' : lesson && !teachingMove ?
                  step?.kind === 'inspect' ? 'tutorial.selectCue' : lesson.complete ? 'tutorial.finish' : !step ? 'tutorial.positionDone' : 'tutorial.readCue' : boosted ? 'game.bonus' :
                  config?.mode === 'practice' || config?.mode === 'rated' ? humanActing ? 'game.yourTurn' : 'game.thinking' :
                    actor === 'white' ? 'game.turn' : 'game.turnBlack')}</strong>
                {kingThreat && !rollPending && <span className="check-label">{t('game.check')}</span>}</div>
              {!rollPending && boosted && teachingMove && (!lesson || mayEnd) && <div className="bonus-action">
                <button type="button" className="button primary compact" disabled={!canInput || !mayEnd} data-testid="end-turn"
                  onClick={() => perform({ type: 'endTurn' })}>{t('game.endTurn')}</button>
                {!lesson && <p>{t(mayEnd ? 'game.bonusHelp' : 'game.bonusRequired')}</p>}
              </div>}
              {!lesson && !boosted && canInput && canClaimRepetition(position) && <button type="button" className="button" data-testid="claim-draw"
                onClick={() => perform({ type: 'claimRepetitionDraw' })}>{t('game.claim')}</button>}
              {snap.searchFailed && <div className="recovery-actions">
                <button type="button" className="button" data-testid="retry-worker" onClick={cabinet.retrySearch}>{t('settings.retryEngine')}</button>
                {mode === 'rated' && <button type="button" className="text-button" onClick={() => setModal({ kind: 'technical' })}>{t('settings.abort')}</button>}
              </div>}
            </div>}
            {!!showRoll && !lesson && <RollCard t={t} session={session} rollId={snap.rollId!} pending={snap.rollPhase === 'throwing'} />}
          </div>
          {lesson && <LessonPanel t={t} locale={settings.locale} learning={lesson} guide={guidance} blocked={!snap.ready || Boolean(snap.storageProblem) || snap.busy || snap.animating || snap.teachingReturning}
            rolling={snap.rollPhase === 'throwing'}
            inspected={inspected}
            onAdvance={() => { if (!beat && step?.kind === 'inspect') void cabinet.inspect(step.square); else void cabinet.advance(); }}
            onHandoff={() => void cabinet.handoff()} onNew={() => openSetup()}
            onRepeat={() => setModal({ kind: 'repeat' })} onRestart={() => setModal({ kind: 'restart' })}
            onRestartAll={() => setModal({ kind: 'restart-all' })} />}
          {!lesson && !rollPending && (selected || mobileDetails) && <Inspector t={t} locale={settings.locale}
            piece={selected} state={position} compact={!mobileDetails} />}
          <div className={`secondary-panel ${mobileDetails && !rollPending ? '' : 'collapsed'}`}>
            {lesson && <Inspector t={t} locale={settings.locale} piece={selected} state={position} />}
            <History t={t} session={session} latest={latest} review={reviewing}
              onReview={cursor => setReview(cursor === null ? null : { key: snap.motionKey, cursor })} />
          </div>
          <div className="side-actions">
            {mode !== 'rated' && !lesson && <>
              <button type="button" className="icon-button" data-testid="undo" aria-label={t('game.undo')} title={t('game.undo')}
                onClick={() => void cabinet.edit('undo')} disabled={!snap.ready || Boolean(snap.storageProblem) || session.undoTarget() === null || snap.busy || reviewing !== null}><Icon name="undo" /></button>
              <button type="button" className="icon-button" data-testid="redo" aria-label={t('game.redo')} title={t('game.redo')}
                onClick={() => void cabinet.edit('redo')} disabled={!snap.ready || Boolean(snap.storageProblem) || !session.record.redo.length || snap.busy || reviewing !== null}><Icon name="redo" /></button>
            </>}
            {!lesson && !session.state.outcome && <button type="button" className="text-button" data-testid="resign"
              onClick={() => setModal({ kind: 'resign' })}>{t('game.resign')}</button>}
            {!lesson && mode === 'hotseat' && !session.state.outcome && <button type="button" className="text-button"
              onClick={() => setModal({ kind: 'draw' })}>{t('game.drawOffer')}</button>}
            <button type="button" className="text-button" data-testid="leave-game"
              onClick={() => { if (lesson) setModal({ kind: 'exit' }); else void cabinet.home(); }}>{t(lesson ? 'tutorial.exit' : 'nav.menu')}</button>
            <button type="button" className="text-button toggle-sheet" aria-expanded={mobileDetails}
              onClick={() => setMobileDetails(value => !value)}>{t('game.details')}<Icon name="info" /></button>
          </div>
        </>}
      </aside>
    </main>

    {modal?.kind === 'setup' && <SetupDialog t={t} hotseat={modal.hotseat} pending={pending} durable={snap.durable} busy={!snap.ready || snap.busy}
      onClose={close} onResume={resumeGame} onStart={config => { void cabinet.startGame(config).then(ok => { if (ok) { close(); setFlip(false); } }); }}
      onRelease={id => { void cabinet.closeRated(id); }} onMode={modal.choice ? hotseat => setModal({ ...modal, hotseat }) : undefined} />}
    {modal?.kind === 'rules' && <RulesDialog t={t} locale={settings.locale} onClose={close} />}
    {modal?.kind === 'profile' && <ProfileDialog t={t} locale={settings.locale} profile={snap.profile} ledger={snap.ledger} onClose={close} />}
    {modal?.kind === 'saves' && <SavesDialog t={t} locale={settings.locale} matches={snap.matches} busy={!snap.ready || Boolean(snap.storageProblem) || snap.busy} onClose={close} onOpen={resumeGame} />}
    {modal?.kind === 'capture' && <CaptureDialog t={t} locale={settings.locale} captures={captures} side={modal.side} onClose={close} />}
    {modal?.kind === 'settings' && <SettingsDialog t={t} settings={settings} onClose={close} onChange={changeSettings}
      exportFile={session && !lesson ? download : undefined} importFile={file => { close(); void cabinet.loadFile(file); }}
      level={config?.level ?? undefined} changeLevel={mode === 'practice' && canInput && !boosted ? level => { void cabinet.edit(level); } : undefined} />}
    {modal?.kind === 'repeat' && lesson && <Dialog title={t('tutorial.repeat')} closeLabel={t('nav.close')} onClose={close}>
      {beat ? <><p>{beat.text[settings.locale]}</p>{beat.rule && <p>{beat.rule[settings.locale]}</p>}</>
        : <p>{step?.detail?.[settings.locale] ?? step?.text[settings.locale] ?? t('tutorial.positionDone')}</p>}
    </Dialog>}
    {modal?.kind === 'exit' && lesson && <Dialog title={t('tutorial.exit')} closeLabel={t('nav.close')} onClose={close}>
      <p>{t(canLeaveForPractice ? 'tutorial.exitDetail' : 'tutorial.exitSaved')}</p>
      <div className="dialog-actions">
        <button type="button" className="button" onClick={() => { close(); void cabinet.home(); }}>{t('nav.menu')}</button>
        {canLeaveForPractice && <button type="button" className="button primary" onClick={() => { close(); void cabinet.handoff(); }}>{t('tutorial.continue')}</button>}
      </div>
    </Dialog>}
    {modal && ['resign', 'draw', 'restart', 'restart-all', 'technical'].includes(modal.kind) && <Dialog
      title={t(modal.kind === 'resign' ? 'game.resign' : modal.kind === 'draw' ? 'game.drawOffer' : modal.kind === 'restart' ? 'tutorial.restart' : modal.kind === 'restart-all' ? 'tutorial.restartAll' : 'settings.abort')}
      closeLabel={t('nav.close')} onClose={close}>
      <p>{t(modal.kind === 'resign' ? 'game.resignConfirm' : modal.kind === 'draw' ? 'game.drawConfirm' :
        modal.kind === 'restart' ? 'tutorial.restartConfirm' : modal.kind === 'restart-all' ? 'tutorial.restartAllConfirm' : 'settings.abortConfirm')}</p>
      <div className="dialog-actions"><button type="button" className="button" onClick={close}>{t('nav.cancel')}</button>
        <button type="button" className={`button ${modal.kind === 'resign' ? 'danger' : 'primary'}`} data-testid="confirm-action"
          onClick={() => {
            close();
            if (modal.kind === 'restart') void cabinet.restartLesson();
            else if (modal.kind === 'restart-all') { void cabinet.learn(true); setFlip(false); }
            else if (modal.kind === 'technical' && session) void cabinet.closeRated(session.record.id, true);
            else if (modal.kind === 'resign' || modal.kind === 'draw') perform({ type: modal.kind === 'resign' ? 'resign' : 'agreeDraw' });
          }}>{t('nav.confirm')}</button>
      </div>
    </Dialog>}
    {activePromotion && !modal && <PromotionDialog t={t} side={actor} locale={settings.locale} onLocale={locale => changeSettings({ locale })}
      allowed={allowedPromotions}
      onClose={() => setPromotion(null)} onPick={piece => { setPromotion(null); perform({ ...activePromotion, promotion: piece }); }} />}
  </>;
}
