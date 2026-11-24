import { applyResolvedCommand, commandRejection, enumerateOutcomes, legalCommands } from '../core';
import type { Command, GameState, Move } from '../core';
import { createMatch, SessionError } from '../session/match';
import type { GameSession, MatchRecord, TutorialRollProvider } from '../session/match';
import { restoreMatch } from '../session/save';
import { LESSONS } from './lessons';
import type { FixedRoll, Step } from './lessonTypes';

export interface Learning {
  readonly lesson: number;
  readonly position: number;
  readonly index: number;
  readonly complete: boolean;
  readonly session: GameSession;
}

interface LearningSave {
  readonly version: 1;
  readonly lesson: number;
  readonly position: number;
  readonly index: number;
  readonly complete: boolean;
  readonly match: MatchRecord;
}

export function instruction(progress: Learning): Step | undefined {
  return LESSONS[progress.lesson].positions[progress.position].steps[progress.index];
}

export function startLesson(lesson = 0, position = 0): Learning {
  const { setup } = LESSONS[lesson].positions[position];
  return {
    lesson, position, index: 0, complete: false,
    session: createMatch({ mode: 'tutorial', human: 'white', level: 4, provenance: 'lesson' }, { root: setup() }),
  };
}

export function saveLearning(progress: Learning): LearningSave {
  const { lesson, position, index, complete, session } = progress;
  return { version: 1, lesson, position, index, complete, match: session.record };
}

export function restoreLearning(value: unknown): Learning {
  const saved = value as Partial<LearningSave> | null;
  if (!saved || saved.version !== 1 || !Number.isInteger(saved.lesson) ||
    !Number.isInteger(saved.position) || !Number.isInteger(saved.index) || typeof saved.complete !== 'boolean') {
    throw new SessionError('invalidSave');
  }
  const { lesson, position, index, complete } = saved as LearningSave;
  const fixture = LESSONS[lesson]?.positions[position];
  const expectComplete = lesson === LESSONS.length - 1 && position === LESSONS[lesson].positions.length - 1
    && index === fixture?.steps.length;
  if (!fixture || index < 0 || index > fixture.steps.length || complete !== expectComplete) {
    throw new SessionError('invalidSave');
  }
  const session = restoreMatch(saved.match);
  if (session.record.config.mode !== 'tutorial' || session.record.config.human !== 'white'
    || JSON.stringify(session.record.root) !== JSON.stringify(fixture.setup())) throw new SessionError('invalidSave');
  return { lesson, position, index, complete, session };
}

function bump(progress: Learning, session = progress.session): Learning {
  const index = progress.index + 1;
  const lesson = LESSONS[progress.lesson];
  const allDone = progress.lesson === LESSONS.length - 1 && progress.position === lesson.positions.length - 1
    && index === lesson.positions[progress.position].steps.length;
  const position = session.state;
  if (allDone && (position.outcome || position.phase !== 'primary' || !legalCommands(position).length)) {
    throw new SessionError('tutorialBroken');
  }
  return { ...progress, index, session, complete: allDone };
}

export function advanceLesson(progress: Learning): Learning {
  const current = instruction(progress);
  if (current?.kind === 'read') return bump(progress);
  if (current || progress.complete) throw new SessionError('tutorialChoice');
  const lesson = LESSONS[progress.lesson];
  if (progress.position + 1 < lesson.positions.length) return startLesson(progress.lesson, progress.position + 1);
  return startLesson(progress.lesson + 1);
}

export function confirmInspection(progress: Learning, square: string): Learning {
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
  return bump(progress, next);
}

export function learnerAction(progress: Learning, command: Command):
  { progress: Learning; explanation?: SessionError['code'] } {
  const step = instruction(progress);
  const rejection = commandRejection(progress.session.state, command);
  if (step?.kind === 'illegal' && sameCommand(step.move, command) && rejection === step.reason) {
    return { progress: bump(progress), explanation: step.reason };
  }
  if (rejection) throw new SessionError(rejection);
  if (step?.kind !== 'move' || !guideCommands(progress).some(candidate => sameCommand(candidate, command))) {
    throw new SessionError('tutorialChoice');
  }
  return { progress: accept(progress, step, command) };
}

export function scriptAction(progress: Learning): Learning {
  const step = instruction(progress);
  if (step?.kind !== 'script') throw new SessionError('tutorialBroken');
  const command = step.move === 'reply' ? scriptedReply(progress.session.state) : step.move;
  if (!command || commandRejection(progress.session.state, command)) throw new SessionError('tutorialBroken');
  return accept(progress, step, command);
}
