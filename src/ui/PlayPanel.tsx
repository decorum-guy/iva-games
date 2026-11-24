import { Component, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { CYCLE, cyclesRemaining } from '../core';
import type { Command, GameEvent, GameState, Piece } from '../core';
import { countText, numberText } from '../i18n/catalog';
import type { Locale, Translate } from '../i18n/catalog';
import { displayDelta } from '../rating/elo';
import type { RatingEntry } from '../rating/elo';
import { instruction, teachingBeat } from '../tutorial/controller';
import type { Learning } from '../tutorial/controller';
import { LESSONS } from '../tutorial/lessons';
import { tutorialHistory } from '../session/match';
import type { GameSession } from '../session/match';
import { ReactionDie } from '../scene/ReactionDie';
import { eloChange } from './Dialogs';
import { Icon } from './icons';
import { PieceIcon, StateMark } from './pieces';
import { describeEvent } from './projections';

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

export function Inspector({ t, locale, piece, state }: { t: Translate; locale: Locale; piece: Piece | undefined; state: GameState }) {
  if (!piece) return <div className="inspector idle-inspector">{t('game.inspect')}</div>;
  const duration = cyclesRemaining(piece, state);
  const cure = piece.cureArmedAt === null ? null : Math.max(0, Math.ceil((piece.cureArmedAt + CYCLE - state.turnSerial) / CYCLE));
  const shame = piece.shameArmedAt === null ? null : Math.max(0, Math.ceil((piece.shameArmedAt + CYCLE - state.turnSerial) / CYCLE));
  return <div className="inspector" data-testid="inspector" data-selected={piece.square} data-state={piece.affliction}>
    <div className="inspector-heading">
      <PieceIcon type={piece.type} side={piece.side} />
      <div><h3>{t('game.pieceSquare', { piece: t(`piece.${piece.type}`), square: piece.square })}</h3>
        <span className={`affliction-label ${piece.affliction}`}><StateMark state={piece.affliction} />{t(`state.${piece.affliction}`)}</span></div>
    </div>
    <div className="inspector-timers">
      {duration !== null && <span>{t('game.removalDue', { count: countText(locale, 'cycle', duration) })}
        {piece.devastationDue !== null && <> ({countText(locale, 'turn', piece.devastationDue - state.turnSerial)})</>}</span>}
      {cure !== null && <span>{t('game.cureDue', { count: countText(locale, 'cycle', cure) })}</span>}
      {shame !== null && <span>{t('game.shameDue', { count: countText(locale, 'cycle', shame) })}</span>}
    </div>
    <details className="piece-details">
      <summary>{t('game.selected')}</summary>
      <p>{t(`state.${piece.affliction}Detail`)}</p>
      {piece.type === 'bishop' && <p>{t('state.bishopDetail')}</p>}
      {piece.type === 'king' && <p>{t('state.kingDetail')}</p>}
      <dl className="piece-metrics">
        <div><dt>{t('game.reaction')}</dt><dd>{t(`state.${piece.captureReaction}`)}</dd></div>
        <div><dt>{t('game.captures')}</dt><dd>{numberText(locale, piece.capturesSinceRebirth)}</dd></div>
      </dl>
    </details>
  </div>;
}

export function RollCard({ t, session, rollId, pending }: {
  t: Translate; session: GameSession; rollId: string; pending: boolean;
}) {
  const action = session.record.actions[session.record.cursor - 1];
  if (!action || action.id !== rollId || !action.roll) return null;
  const reaction = session.current.events.find((event): event is Extract<GameEvent, { type: 'reaction' }> => event.type === 'reaction' && event.face !== undefined);
  return <div className="roll-card" data-testid="roll" data-face={action.roll.face} data-fixed={action.roll.fixed}>
    {!pending && <ReactionDie face={action.roll.face} rollKey={`${session.record.id}/${rollId}`} reducedMotion
      label={t('die.face', { face: action.roll.face })} />}
    <div>
      <span className="die-label">{t('die.label')}</span>
      <strong className="die-result">{t(pending ? 'die.rolling' : !reaction || reaction.affliction === 'neutral' ? 'state.unaffected' : `state.${reaction.affliction}`)}</strong>
      {!pending && <span className="sr-only" role="status">{t('die.face', { face: action.roll.face })}</span>}
    </div>
  </div>;
}

export function RollReveal({ t, session, rollId, reduced, low, pending, startedAt, focusDock }: {
  t: Translate; session: GameSession; rollId: string; reduced: boolean; low: boolean; pending: boolean; startedAt?: number;
  focusDock?: 'left' | 'right';
}) {
  const [Renderer, setRenderer] = useState(() => preparedDie);
  useEffect(() => {
    if (Renderer) return;
    let active = true;
    void prepareDieRenderer().then(renderer => {
      if (active && renderer) setRenderer(() => renderer);
    });
    return () => { active = false; };
  }, [Renderer]);
  const action = session.record.actions[session.record.cursor - 1];
  if (!action?.roll || action.id !== rollId) return null;
  const reaction = session.current.events.find((event): event is Extract<GameEvent, { type: 'reaction' }> =>
    event.type === 'reaction' && event.face !== undefined);
  const result = t(!reaction || reaction.affliction === 'neutral' ? 'state.unaffected' : `state.${reaction.affliction}`);
  const placeholder = <div className="dice-loading-face" aria-hidden="true">
    {pending ? <span className="dice-loading-body" /> : <ReactionDie face={action.roll.face} rollKey={rollId} reducedMotion />}
  </div>;
  return <div className="dice-reveal" data-testid="dice-reveal" data-actor={action.actor}
    data-phase={pending ? 'throwing' : 'settled'} data-focus-dock={pending ? undefined : focusDock}>
    <span className="dice-actor">{t('die.actor', { side: t(`side.${action.actor}`) })}</span>
    {Renderer ? <DieLoadBoundary fallback={placeholder}>
      <Renderer face={action.roll.face} rollKey={`${session.record.id}/${rollId}`} reduced={reduced} quality={low ? 'low' : 'high'} startedAt={startedAt} />
    </DieLoadBoundary> : placeholder}
    <strong className="dice-caption" role="status">{pending ? t('die.rolling') : `${action.roll.face} · ${result}`}</strong>
  </div>;
}

export function LessonPanel({ t, locale, learning, guide, blocked, rolling = false, inspected = false, onAdvance, onHandoff, onNew, onRepeat, onRestart, onRestartAll }: {
  t: Translate; locale: Locale; learning: Learning; guide: readonly Command[]; blocked: boolean;
  rolling?: boolean;
  inspected?: boolean;
  onAdvance: () => void; onHandoff: () => void; onNew: () => void; onRepeat: () => void; onRestart: () => void;
  onRestartAll: () => void;
}) {
  const { complete } = learning;
  const lesson = LESSONS[learning.lesson];
  const beat = teachingBeat(learning);
  const step = beat ? undefined : instruction(learning);
  const phase = beat ? 'result' : complete ? 'complete' : step?.kind ?? 'position-complete';
  const resultVisible = Boolean(beat && !rolling);
  const face = learning.session.record.actions[learning.session.record.cursor - 1]?.roll?.face;
  const moves = guide.filter(cmd => cmd.type === 'move');
  const forced = moves[0] && moves.every(move => move.from === moves[0].from && move.to === moves[0].to);
  const read = step?.kind === 'read';
  const inspectedPiece = step?.kind === 'inspect' ? learning.session.state.pieces.find(piece => piece.square === step.square) : undefined;
  const remaining = inspectedPiece ? cyclesRemaining(inspectedPiece, learning.session.state) : null;
  const nextPosition = learning.position + 1 < lesson.positions.length;
  const actionTitle = !step ? 'tutorial.positionDone' : step.kind === 'read' ? 'tutorial.readCue' :
    step.kind === 'inspect' ? 'tutorial.selectCue' : step.kind === 'script' ? 'game.script' :
      step.kind === 'illegal' ? 'tutorial.illegalCue' : 'tutorial.moveCue';
  return <section className="lesson-panel" data-testid="tutorial" data-lesson={lesson.id}
    data-position={learning.position} data-step={beat ? `result:${learning.pendingTeaching!.stepId}:${beat.id}` : step?.id ?? phase}
    data-source-step={learning.pendingTeaching?.stepId} data-beat={beat?.id} data-kind={phase} aria-label={lesson.title[locale]}>
    <div className="lesson-meta">
      <span>{t('tutorial.progress', { current: learning.lesson + 1, total: LESSONS.length })}</span>
      <div className="lesson-track" aria-hidden="true">
        {LESSONS.map((item, index) => <i key={item.id} className={index <= learning.lesson ? 'reached' : ''} />)}
      </div>
    </div>
    <h2>{complete ? t('tutorial.finish') : resultVisible ? beat!.title[locale] : lesson.title[locale]}</h2>
    {!complete && !resultVisible && <div className="lesson-action-label" role="status"><Icon name={read || inspected || !step ? 'check' : step.kind === 'inspect' ? 'info' : 'arrow'} />{t(rolling ? 'die.watch' : inspected ? 'tutorial.readCue' : actionTitle)}</div>}
    <p className="lesson-instruction" data-testid={resultVisible ? 'teaching-cause' : inspected ? 'counter-read' : undefined} role={resultVisible ? 'status' : undefined}>{rolling ? t('die.rolling')
      : resultVisible ? beat!.text[locale]
      : inspected && remaining !== null ? t('tutorial.counterRead', { count: countText(locale, 'cycle', remaining) })
        : complete ? t('tutorial.finishDetail') : step?.text[locale] ?? t('tutorial.positionDoneDetail')}</p>
    {resultVisible && beat?.rule && <p className="lesson-rule" data-testid="teaching-rule">{beat.rule[locale]}</p>}
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
    {!rolling && !inspected && step?.kind === 'inspect' && <div className="lesson-target">{t('tutorial.inspect', { square: step.square })}</div>}
    {!rolling && forced && !complete && <div className="lesson-target">{t('tutorial.try', { from: moves[0].from, to: moves[0].to })}</div>}
    {!rolling && step?.kind === 'move' && !moves.length && guide.some(command => command.type === 'endTurn') &&
      <div className="lesson-target">{t('tutorial.endAction')}</div>}
    {complete ? <div className="lesson-actions">
      <button type="button" className="button primary" onClick={onHandoff} disabled={blocked} data-testid="lesson-continue">
        <span>{t('tutorial.continue')}<small>{t('tutorial.continueDetail')}</small></span><Icon name="arrow" />
      </button>
      <button type="button" className="button" onClick={onNew} data-testid="lesson-new" disabled={blocked}>{t('home.new')}</button>
      <button type="button" className="text-button" onClick={onRestartAll} disabled={blocked}>{t('tutorial.restartAll')}</button>
    </div> : <>
      {(beat || !step || step.kind === 'read' || inspected) && <button type="button" className={`button primary ${rolling ? 'awaiting-roll' : ''}`} onClick={onAdvance}
        disabled={blocked} data-testid="lesson-next">{beat ? beat.action?.[locale] ?? t('tutorial.readAction')
          : t(!step ? nextPosition ? 'tutorial.newPosition' : 'tutorial.nextLesson' : 'tutorial.readAction')}<Icon name="arrow" /></button>}
      <div className="lesson-tools">
        {step && <button type="button" className="text-button" onClick={onRepeat}>{t(step.detail ? 'tutorial.why' : 'tutorial.repeat')}</button>}
        <button type="button" className="text-button" onClick={onRestart} data-testid="lesson-restart">{t('tutorial.restart')}</button>
      </div>
    </>}
  </section>;
}

export function History({ t, session, latest, review, onReview }: {
  t: Translate; session: GameSession; latest: readonly GameEvent[]; review: number | null;
  onReview: (cursor: number | null) => void;
}) {
  const tutorial = session.record.config.mode === 'tutorial';
  const total = session.record.cursor;
  const notable = latest.filter(event => event.type !== 'turn' || event.check);
  const tutorialEvents = tutorialHistory(session).filter(event => event.type !== 'turn' || event.check);
  const events = (review === null ? session.events : session.eventsAt(review)).filter(event => event.type !== 'turn' || event.check);
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
        {review === null ? <button type="button" className="button compact" onClick={() => onReview(total)}>{t('log.review')}</button>
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
  t: Translate; locale: Locale; session: GameSession; entry?: RatingEntry; onNew: () => void;
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
    <button type="button" className="button primary" onClick={onNew}>{t('home.new')}<Icon name="arrow" /></button>
  </div>;
}
