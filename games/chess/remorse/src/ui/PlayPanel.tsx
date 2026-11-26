import { Component, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Command, GameEvent, GameState, Piece } from '../core';
import { countText, numberText } from '../i18n/catalog';
import type { Locale, Translate } from '../i18n/catalog';
import { displayDelta } from '../rating/elo';
import type { RatingEntry } from '../rating/elo';
import { instruction, teachingBeat } from '../tutorial/controller';
import type { Learning } from '../tutorial/controller';
import { LESSONS } from '../tutorial/lessons';
import { GameSession, tutorialHistory } from '../session/match';
import type { GameView } from '../session/view';
import { ReactionDie } from '../scene/ReactionDie';
import { eloChange } from './Dialogs';
import { Icon } from './icons';
import { PieceIcon, StateMark } from './pieces';
import { describeEvent } from './projections';
import { effectTiming } from './effectTiming';
import { tutorialChoiceFeedback } from './tutorialFeedback';

type DieRenderer = typeof import('../scene/DieThrow').default;
let preparedDie: DieRenderer | undefined;
let dieLoad: Promise<DieRenderer | undefined> | undefined;

export function prepareDieRenderer() {
  dieLoad ??= import('../scene/DieThrow').then(module => (preparedDie = module.default), () => undefined);
  return dieLoad;
}
class DieLoadBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function PanelNotice({ children, onClose, label }: { children: ReactNode; onClose: () => void; label: string }) {
  return <div className="notice" role="status"><span>{children}</span>
    <button onClick={onClose} className="icon-button" type="button" aria-label={label}><Icon name="close" /></button>
  </div>;
}

export function Inspector({ t, locale, piece, state, compact = false }: {
  t: Translate; locale: Locale; piece: Piece | undefined; state: GameState; compact?: boolean;
}) {
  if (!piece) return <div className="inspector idle-inspector">{t('game.inspect')}</div>;
  const { removal, cure, shame } = effectTiming(piece, state);
  return <div className={`inspector ${compact ? 'compact-inspector' : ''}`} data-testid="inspector"
    data-selected={piece.square} data-state={piece.affliction} data-compact={compact}>
    <div className="inspector-heading">
      <PieceIcon type={piece.type} side={piece.side} />
      <div><h3>{t('game.pieceSquare', { piece: t(`piece.${piece.type}`), square: piece.square })}</h3>
        <span className={`affliction-label ${piece.affliction}`}><StateMark state={piece.affliction} />{t(`state.${piece.affliction}`)}</span></div>
    </div>
    <div className="inspector-timers">
      {removal !== null && <span>{t('game.removalDue', { count: countText(locale, 'turn', removal) })}</span>}
      {cure !== null && <span>{t('game.cureDue', { count: countText(locale, 'turn', cure) })}</span>}
      {shame !== null && <span>{t('game.shameDue', { count: countText(locale, 'turn', shame) })}</span>}
    </div>
    {!compact && <details className="piece-details">
      <summary>{t('game.selected')}</summary>
      <p>{t(`state.${piece.affliction}Detail`)}</p>
      {piece.type === 'bishop' && <p>{t('state.bishopDetail')}</p>}
      {piece.type === 'king' && <p>{t('state.kingDetail')}</p>}
      <dl className="piece-metrics">
        <div><dt>{t('game.reaction')}</dt><dd>{t(`state.${piece.captureReaction}`)}</dd></div>
        <div><dt>{t('game.captures')}</dt><dd>{numberText(locale, piece.capturesSinceRebirth)}</dd></div>
      </dl>
    </details>}
  </div>;
}

/** One reserved information slot; a live throw never covers or resizes the board. */
export function RollDock({ t, session, rollId, reduced, low, pending, awaitingReaction, active, startedAt, reserve = true }: {
  t: Translate; session: GameView; rollId: string | null; reduced: boolean; low: boolean;
  pending: boolean; awaitingReaction: boolean; active: boolean; startedAt?: number; reserve?: boolean;
}) {
  const dock = useRef<HTMLDivElement>(null);
  const [Renderer, setRenderer] = useState(() => preparedDie);
  useEffect(() => {
    if (Renderer || !active) return;
    let mounted = true;
    void prepareDieRenderer().then(renderer => {
      if (mounted && renderer) setRenderer(() => renderer);
    });
    return () => { mounted = false; };
  }, [Renderer, active]);
  useLayoutEffect(() => {
    if (!active) return;
    const node = dock.current;
    const aside = node?.closest<HTMLElement>('.game-aside');
    if (!node || !aside) return;
    // An open history can leave this pane scrolled down. Reveal only the new
    // throw inside its own pane; never scroll the document or replay a camera.
    const bounds = node.getBoundingClientRect(), viewport = aside.getBoundingClientRect();
    if (bounds.top < viewport.top + 3) aside.scrollTop += bounds.top - viewport.top - 3;
    else if (bounds.bottom > viewport.bottom - 3) aside.scrollTop += bounds.bottom - viewport.bottom + 3;
  }, [active, rollId]);
  const action = session.record.actions[session.record.cursor - 1];
  const roll = action?.id === rollId ? action.roll : undefined;
  if (!roll) return <div ref={dock} className="roll-dock" data-testid="dice-dock" data-empty="true" data-reserved={reserve} aria-hidden="true" />;
  const reaction = session.current.events.find((event): event is Extract<GameEvent, { type: 'reaction' }> =>
    event.type === 'reaction' && event.face !== undefined);
  const result = t(!reaction || reaction.affliction === 'neutral' ? 'state.unaffected' : `state.${reaction.affliction}`);
  const key = `${session.record.id}/${rollId}`;
  const placeholder = <div className="dice-loading-face" aria-hidden="true">
    {pending ? <span className="dice-loading-body" /> : <ReactionDie face={roll.face} rollKey={key} reducedMotion />}
  </div>;
  return <div ref={dock} className="roll-dock" data-testid="dice-dock" data-empty="false" data-active={active}>
    <div className="roll-card" data-testid="roll" data-face={roll.face} data-fixed={roll.fixed}>
      <div className="dice-reveal" data-testid={active ? 'dice-reveal' : undefined} data-actor={action.actor}
        data-phase={pending ? 'throwing' : 'settled'}>
        <span className="dice-actor">{t('die.actor', { side: t(`side.${action.actor}`) })}</span>
        <div className="dice-stage">
          {startedAt !== undefined && Renderer ? <DieLoadBoundary fallback={placeholder}>
            <Renderer face={roll.face} rollKey={key} reduced={reduced} quality={low ? 'low' : 'high'} startedAt={startedAt} />
          </DieLoadBoundary> : placeholder}
        </div>
        <strong className="dice-caption" role="status" aria-label={!pending && awaitingReaction ? t('die.face', { face: roll.face }) : undefined}>
          {pending ? t('die.rolling') : awaitingReaction ? roll.face : `${roll.face} · ${result}`}</strong>
      </div>
    </div>
  </div>;
}

export function LessonPanel({ t, locale, learning, guide, blocked, rolling = false, awaitingReaction = false, promotionPending = false, forming, inspected = false, dice, onAdvance, onHandoff, onNew, onRepeat, onRestart, onRestartAll }: {
  t: Translate; locale: Locale; learning: Learning; guide: readonly Command[]; blocked: boolean;
  rolling?: boolean;
  awaitingReaction?: boolean;
  promotionPending?: boolean;
  forming?: 'queen' | 'rook' | 'bishop' | 'knight';
  inspected?: boolean;
  dice: ReactNode;
  onAdvance: () => void; onHandoff: () => void; onNew: () => void; onRepeat: () => void; onRestart: () => void;
  onRestartAll: () => void;
}) {
  const { complete } = learning;
  const lesson = LESSONS[learning.lesson];
  const beat = teachingBeat(learning);
  const step = beat ? undefined : instruction(learning);
  const phase = beat ? 'result' : complete ? 'complete' : step?.kind ?? 'position-complete';
  const waiting = rolling || awaitingReaction || promotionPending;
  const showInstruction = !promotionPending || awaitingReaction || rolling || Boolean(forming);
  const resultVisible = Boolean(beat && !waiting);
  const face = learning.session.record.actions[learning.session.record.cursor - 1]?.roll?.face;
  const moves = guide.filter(cmd => cmd.type === 'move');
  const forced = moves[0] && moves.every(move => move.from === moves[0].from && move.to === moves[0].to);
  const endTurnOnly = step?.kind === 'move' && !moves.length && guide.some(command => command.type === 'endTurn');
  const read = step?.kind === 'read';
  const feedback = tutorialChoiceFeedback(learning, locale);
  const inspectedPiece = step?.kind === 'inspect' ? learning.session.state.pieces.find(piece => piece.square === step.square) : undefined;
  const remaining = inspectedPiece ? effectTiming(inspectedPiece, learning.session.state).removal : null;
  const nextPosition = learning.position + 1 < lesson.positions.length;
  const finalRead = read && learning.index === lesson.positions[learning.position].steps.length - 1;
  const readAction = finalRead ? nextPosition ? 'tutorial.newPosition'
    : learning.lesson === LESSONS.length - 1 ? 'tutorial.finishAction' : 'tutorial.nextLesson' : 'tutorial.readAction';
  const actionTitle = !step ? 'tutorial.positionDone' : step.kind === 'read' ? 'tutorial.readCue' :
    step.kind === 'inspect' ? 'tutorial.selectCue' : step.kind === 'script' ? 'game.script' :
      step.kind === 'illegal' ? 'tutorial.illegalCue' : endTurnOnly ? 'tutorial.endAction' : 'tutorial.moveCue';
  return <section className="lesson-panel" data-testid="tutorial" data-lesson={lesson.id}
    data-position={learning.position} data-step={beat ? `result:${learning.pendingTeaching!.stepId}:${beat.id}` : step?.id ?? phase}
    data-source-step={learning.pendingTeaching?.stepId} data-beat={beat?.id} data-kind={phase} aria-label={lesson.title[locale]}>
    <div className="lesson-meta">
      <span>{t('tutorial.progress', { current: learning.lesson + 1, total: LESSONS.length })}</span>
      <div className="lesson-track" aria-hidden="true">
        {LESSONS.map((item, index) => <i key={item.id} className={index <= learning.lesson ? 'reached' : ''} />)}
      </div>
    </div>
    <div className="lesson-heading">
      <h2>{complete ? t('tutorial.finish') : resultVisible ? beat!.title[locale] : feedback ? t('tutorial.choiceResult') : lesson.title[locale]}</h2>
      {dice}
    </div>
    {showInstruction && !complete && !resultVisible && !feedback && <div className="lesson-action-label" role="status"><Icon name={read || inspected || !step ? 'check' : step.kind === 'inspect' ? 'info' : 'arrow'} />{t(rolling || awaitingReaction ? 'die.watch' : forming ? 'game.promotion' : inspected ? 'tutorial.readCue' : actionTitle)}</div>}
    {showInstruction && <p className="lesson-instruction" data-testid={resultVisible ? 'teaching-cause' : inspected ? 'counter-read' : feedback ? 'choice-feedback' : undefined}
      data-feedback={feedback?.kind} role={resultVisible ? 'status' : undefined}>{rolling ? t('die.rolling') : awaitingReaction ? t('die.awaitingReaction')
      : forming ? t('game.forming', { piece: t(`piece.${forming}`) })
      : resultVisible ? beat!.text[locale]
      : inspected && remaining !== null ? t('tutorial.counterRead', { count: countText(locale, 'turn', remaining) })
        : complete ? t('tutorial.finishDetail') : feedback?.text ?? step?.text[locale] ?? t('tutorial.positionDoneDetail')}</p>}
    {resultVisible && beat?.rule && <p className="lesson-rule" data-testid="teaching-rule">{beat.rule[locale]}</p>}
    {feedback?.rule && <p className="lesson-rule" data-testid="choice-rule">{feedback.rule}</p>}
    {resultVisible && beat?.diceLegend && <div className="lesson-dice-legend" data-testid="dice-legend" role="group" aria-label={t('tutorial.diceLegend')}>
      {([
        { faces: '1', state: 'devastated', active: face === 1 },
        { faces: '2–3', state: 'guilt', active: face === 2 || face === 3 },
        { faces: '4–5', state: 'unaffected', active: face === 4 || face === 5 },
        { faces: '6', state: 'berserk', active: face === 6 },
      ] as const).map(entry => <div key={entry.state} data-reaction={entry.state} data-current={entry.active}>
        <strong>{entry.faces}</strong><span>{t(`state.${entry.state}`)}</span>
      </div>)}
    </div>}
    {!waiting && !inspected && step?.kind === 'inspect' && <div className="lesson-target">{t('tutorial.inspect', { square: step.square })}</div>}
    {!waiting && forced && !complete && <div className="lesson-target">{t('tutorial.try', { from: moves[0].from, to: moves[0].to })}</div>}
    {complete ? <div className="lesson-actions">
      <button type="button" className="button primary" onClick={onHandoff} disabled={blocked} data-testid="lesson-continue">
        <span>{t('tutorial.continue')}<small>{t('tutorial.continueDetail')}</small></span><Icon name="arrow" />
      </button>
      <button type="button" className="button" onClick={onNew} data-testid="lesson-new" disabled={blocked}>{t('home.new')}</button>
      <button type="button" className="text-button" onClick={onRestartAll} disabled={blocked}>{t('tutorial.restartAll')}</button>
    </div> : <>
      {(beat || !step || step.kind === 'read' || inspected) && <button type="button" className={`button primary ${waiting ? 'awaiting-roll' : ''}`} onClick={onAdvance}
        disabled={blocked} data-testid="lesson-next">{beat ? beat.action?.[locale] ?? t('tutorial.readAction')
          : t(!step ? nextPosition ? 'tutorial.newPosition' : 'tutorial.nextLesson' : readAction)}<Icon name="arrow" /></button>}
      <div className="lesson-tools">
        {step && <button type="button" className="text-button" onClick={onRepeat}>{t(step.detail ? 'tutorial.why' : 'tutorial.repeat')}</button>}
        <button type="button" className="text-button" onClick={onRestart} data-testid="lesson-restart">{t('tutorial.restart')}</button>
      </div>
    </>}
  </section>;
}

export function History({ t, session, latest, review, concealLatest, onReview }: {
  t: Translate; session: GameView; latest: readonly GameEvent[]; review: number | null;
  concealLatest: boolean;
  onReview: (cursor: number | null) => void;
}) {
  const tutorial = session.record.config.mode === 'tutorial';
  const total = session.record.cursor;
  const notable = latest.filter(event => event.type !== 'turn' || event.check);
  const tutorialEvents = (session instanceof GameSession ? tutorialHistory(session) : []).filter(event => event.type !== 'turn' || event.check);
  const displayed = review !== null ? session.eventsAt(review)
    : concealLatest ? [...session.eventsAt(total - 1), ...latest] : session.events;
  const events = displayed.filter(event => event.type !== 'turn' || event.check);
  return <section className="history" data-testid="history">
    {notable.length > 0 && <div className="recent-event">{describeEvent(t, notable[notable.length - 1])}</div>}
    <details>
      <summary><Icon name="history" />{t('log.title')}</summary>
      {(session.record.config.provenance === 'handoff' || tutorialEvents.length > 0) && <p>{t('log.handoff')}</p>}
      {tutorialEvents.length > 0 && <ol className="root-history">
        {tutorialEvents.map(event => <li key={event.id}>{describeEvent(t, event)}</li>)}
      </ol>}
      {events.length ? <ol>{events.map(event => <li key={event.id}>{describeEvent(t, event)}</li>)}</ol>
        : <p>{t('log.empty')}</p>}
      {!tutorial && total > 0 && <div className="review-controls">
        {review === null ? <button type="button" className="button compact" disabled={concealLatest} onClick={() => onReview(total)}>{t('log.review')}</button>
          : <>
            <label>{t('log.step', { current: review, total })}
              <input type="range" min={0} max={total} value={review} onChange={event => onReview(Number(event.target.value))} /></label>
            <button type="button" className="button compact" onClick={() => onReview(null)}>{t('log.return')}</button>
          </>}
      </div>}
    </details>
  </section>;
}

export function Result({ t, locale, session, entry, onNew }: {
  t: Translate; locale: Locale; session: GameView; entry?: RatingEntry; onNew?: () => void;
}) {
  const { outcome } = session.state;
  if (!outcome) return null;
  const human = session.record.config.human;
  const title = outcome.winner === null ? 'game.draw' : human ? (human === outcome.winner ? 'game.win' : 'game.loss')
    : outcome.winner === 'white' ? 'game.whiteWins' : 'game.blackWins';
  return <div className="result" data-testid="game-result" data-reason={outcome.reason}>
    <h2>{t(title)}</h2>
    <p>{t(`result.${outcome.reason}`)}</p>
    {entry ? <div className="result-rating"><span>{t('result.ratingChange')}</span><strong>{eloChange(locale, entry)}</strong>
      {displayDelta(entry.before, entry.after) === 0 && entry.exactDelta !== 0 && <small>{t('result.lessThanOne')}</small>}
    </div> : <p className="field-note">{t('result.noRating')}</p>}
    {onNew && <button type="button" className="button primary" onClick={onNew}>{t('home.new')}<Icon name="arrow" /></button>}
  </div>;
}
