import { applyResolvedCommand, commandRejection, enumerateOutcomes, legalCommands } from '../core';
import type { Command, GameState, Move } from '../core';
import { createMatch, SessionError } from '../session/match';
import type { GameSession, MatchRecord, TutorialRollProvider } from '../session/match';
import { restoreMatch } from '../session/save';
import { LESSONS } from './lessons';
import type { FixedRoll, Step, TeachingBeat } from './lessonTypes';

export interface PendingTeaching {
  /** The original completed step, whose index has already advanced once. */
  readonly stepId: string;
  readonly beatIndex: number;
}

export interface Learning {
  readonly lesson: number;
  readonly position: number;
  readonly index: number;
  readonly complete: boolean;
  readonly session: GameSession;
  readonly pendingTeaching?: PendingTeaching;
}

interface LearningSave {
  readonly version: 1;
  readonly lesson: number;
  readonly position: number;
  readonly index: number;
  readonly complete: boolean;
  readonly match: MatchRecord;
  /** Optional in v1: older checkpoints retain their exact original progress. */
  readonly pendingTeaching?: PendingTeaching;
}

export function instruction(progress: Learning): Step | undefined {
  return LESSONS[progress.lesson].positions[progress.position].steps[progress.index];
}

/** Required result copy is separate from the next still-unexecuted instruction. */
export function teachingBeat(progress: Learning): TeachingBeat | undefined {
  const pending = progress.pendingTeaching;
  if (!pending) return undefined;
  const source = LESSONS[progress.lesson].positions[progress.position].steps[progress.index - 1];
  return source?.id === pending.stepId ? source.after?.[pending.beatIndex] : undefined;
}

function isComplete(progress: Pick<Learning, 'lesson' | 'position' | 'index' | 'pendingTeaching'>) {
  const lesson = LESSONS[progress.lesson];
  return !progress.pendingTeaching && progress.lesson === LESSONS.length - 1
    && progress.position === lesson.positions.length - 1 && progress.index === lesson.positions[progress.position].steps.length;
}

export function startLesson(lesson = 0, position = 0): Learning {
  const { setup } = LESSONS[lesson].positions[position];
  return {
    lesson, position, index: 0, complete: false,
    session: createMatch({ mode: 'tutorial', human: 'white', level: 4, provenance: 'lesson' }, { root: setup() }),
  };
}

export function saveLearning(progress: Learning): LearningSave {
  const { lesson, position, index, complete, session, pendingTeaching } = progress;
  return { version: 1, lesson, position, index, complete, match: session.record,
    ...(pendingTeaching ? { pendingTeaching } : {}) };
}

export function restoreLearning(value: unknown): Learning {
  const saved = value as Partial<LearningSave> | null;
  if (!saved || saved.version !== 1 || !Number.isInteger(saved.lesson) ||
    !Number.isInteger(saved.position) || !Number.isInteger(saved.index) || typeof saved.complete !== 'boolean') {
    throw new SessionError('invalidSave');
  }
  const { lesson, position, index, complete, pendingTeaching } = saved as LearningSave;
  const fixture = LESSONS[lesson]?.positions[position];
  const expectComplete = !pendingTeaching && lesson === LESSONS.length - 1 && position === LESSONS[lesson].positions.length - 1
    && index === fixture?.steps.length;
  if (!fixture || index < 0 || index > fixture.steps.length || complete !== expectComplete) {
    throw new SessionError('invalidSave');
  }
  const session = restoreMatch(saved.match);
  if (session.record.config.mode !== 'tutorial' || session.record.config.human !== 'white'
    || JSON.stringify(session.record.root) !== JSON.stringify(fixture.setup())) throw new SessionError('invalidSave');
  if (pendingTeaching !== undefined) {
    const source = fixture.steps[index - 1];
    if (!pendingTeaching || typeof pendingTeaching !== 'object' || typeof pendingTeaching.stepId !== 'string'
      || !Number.isInteger(pendingTeaching.beatIndex) || pendingTeaching.beatIndex < 0
      || source?.id !== pendingTeaching.stepId || !source.after?.[pendingTeaching.beatIndex]
      || !['move', 'script', 'illegal'].includes(source.kind)) throw new SessionError('invalidSave');
    // An explanation must refer to the actual action at this checkpoint; it
    // cannot be relinked to an earlier roll or used to skip a future command.
    if (source.kind === 'illegal') {
      if (commandRejection(session.state, source.move) !== source.reason) throw new SessionError('invalidSave');
    }
    const committedIndex = fixture.steps.slice(0, index).findLastIndex(step => step.kind === 'move' || step.kind === 'script');
    const action = session.record.actions[session.record.cursor - 1];
    if (committedIndex === -1 ? session.record.cursor !== 0
      : action?.id !== `${lesson}/${position}/${committedIndex}/${fixture.steps[committedIndex].id}`) throw new SessionError('invalidSave');
  }
  return { lesson, position, index, complete, session, ...(pendingTeaching ? { pendingTeaching } : {}) };
}

function bump(progress: Learning, session = progress.session): Learning {
  const index = progress.index + 1;
  const allDone = isComplete({ ...progress, index });
  const position = session.state;
  if (allDone && (position.outcome || position.phase !== 'primary' || !legalCommands(position).length)) {
    throw new SessionError('tutorialBroken');
  }
  return { ...progress, index, session, complete: allDone };
}

function afterAction(progress: Learning, step: Step, session = progress.session): Learning {
  const next = bump(progress, session);
  return step.after?.length
    ? { ...next, complete: false, pendingTeaching: { stepId: step.id, beatIndex: 0 } }
    : next;
}

/** Acknowledgement changes only teaching progress, never the committed game. */
export function acknowledgeTeaching(progress: Learning): Learning {
  const pending = progress.pendingTeaching;
  if (!pending || !teachingBeat(progress)) throw new SessionError('tutorialChoice');
  const source = LESSONS[progress.lesson].positions[progress.position].steps[progress.index - 1];
  const beatIndex = pending.beatIndex + 1;
  if (source.after?.[beatIndex]) return { ...progress, pendingTeaching: { ...pending, beatIndex } };
  const { lesson, position, index, session } = progress;
  const next = { lesson, position, index, session };
  return { ...next, complete: isComplete(next) };
}

export function advanceLesson(progress: Learning): Learning {
  if (progress.pendingTeaching) return acknowledgeTeaching(progress);
  const current = instruction(progress);
  if (current?.kind === 'read') return bump(progress);
  if (current || progress.complete) throw new SessionError('tutorialChoice');
  const lesson = LESSONS[progress.lesson];
  if (progress.position + 1 < lesson.positions.length) return startLesson(progress.lesson, progress.position + 1);
  return startLesson(progress.lesson + 1);
}

export function confirmInspection(progress: Learning, square: string): Learning {
  if (progress.pendingTeaching) return progress;
  const step = instruction(progress);
  if (step?.kind !== 'inspect' || step.square !== square) return progress;
  return bump(progress);
}

function sameCommand(first: Command, second: Command): boolean {
  if (first.type === 'move' && second.type === 'move') {
    return first.from === second.from && first.to === second.to && first.promotion === second.promotion;
  }
  return first.type === second.type;
}

function provider(step: Step, roll: FixedRoll | undefined, command: Command, id: string): TutorialRollProvider {
  return (envelope, state) => {
    if (!roll || !id.endsWith(`/${step.id}`) || envelope.commandId !== id || command.type !== 'move'
      || !sameCommand(command, envelope.command)) throw new SessionError('tutorialBroken');
    const victim = state.pieces.find(piece => piece.square === command.to)
      ?? state.pieces.find(piece => state.enPassant?.target === command.to && state.enPassant.pawnId === piece.id);
    if (command.from !== roll.capturer || victim?.square !== roll.victim) throw new SessionError('tutorialBroken');
    return roll.face;
  };
}

function quietResults(state: GameState): { command: Move; state: GameState }[] {
  return legalCommands(state).flatMap(command => {
    if (command.type !== 'move' || state.pieces.some(piece => piece.square === command.to)
      || enumerateOutcomes(state, command).some(chance => chance.face !== undefined)) return [];
    const next = applyResolvedCommand(state, command).state;
    return next.outcome || next.phase !== 'primary' ? [] : [{ command, state: next }];
  });
}

export function guideCommands(progress: Learning): readonly Command[] {
  if (progress.pendingTeaching) return [];
  const step = instruction(progress);
  if (step?.kind === 'illegal') return [step.move];
  if (step?.kind !== 'move') return [];
  if (step.moves !== 'open') return step.moves;
  return quietResults(progress.session.state).filter(result => scriptedReply(result.state)).map(result => result.command);
}

function scriptedReply(state: GameState): Move | undefined {
  return quietResults(state)[0]?.command;
}

function accept(progress: Learning, step: Extract<Step, { kind: 'move' | 'script' }>, command: Command) {
  const { session } = progress;
  const env = session.envelope(command);
  const id = `${progress.lesson}/${progress.position}/${progress.index}/${step.id}`;
  const next = session.submit({ ...env, commandId: id }, step.kind === 'script' ? 'script' : 'human',
    provider(step, step.roll, command, id));
  if (step.expect && !step.expect(next.current.events, next.state)) throw new SessionError('tutorialBroken');
  return afterAction(progress, step, next);
}

export function learnerAction(progress: Learning, command: Command):
  { progress: Learning; explanation?: SessionError['code'] } {
  if (progress.pendingTeaching) throw new SessionError('tutorialChoice');
  const step = instruction(progress);
  const rejection = commandRejection(progress.session.state, command);
  if (step?.kind === 'illegal' && sameCommand(step.move, command) && rejection === step.reason) {
    const next = afterAction(progress, step);
    // A correct, requested experiment is a completed lesson objective. Its
    // authored result explains the rule without treating success as an error.
    return { progress: next, ...(!next.pendingTeaching ? { explanation: step.reason } : {}) };
  }
  if (rejection) throw new SessionError(rejection);
  if (step?.kind !== 'move' || !guideCommands(progress).some(candidate => sameCommand(candidate, command))) {
    throw new SessionError('tutorialChoice');
  }
  return { progress: accept(progress, step, command) };
}

export function scriptAction(progress: Learning): Learning {
  if (progress.pendingTeaching) throw new SessionError('tutorialChoice');
  const step = instruction(progress);
  if (step?.kind !== 'script') throw new SessionError('tutorialBroken');
  const command = step.move === 'reply' ? scriptedReply(progress.session.state) : step.move;
  if (!command || commandRejection(progress.session.state, command)) throw new SessionError('tutorialBroken');
  return accept(progress, step, command);
}
