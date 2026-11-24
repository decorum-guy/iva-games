import type { Command, GameEvent, Side } from '../core';
import { ENGINE_VERSION, getPreset, PRESET_VERSION } from '../engine/presets';
import type { SearchRequest, SearchResponse } from '../engine/protocol';
import { initialProfile } from '../rating/elo';
import { actionPlan } from '../scene/actionPresentation';
import type { ActionPlan, PromotionPlayback, PromotionStage } from '../scene/actionPresentation';
import { CAMERA_TRAVEL_MS } from '../scene/cameraFocus';
import { royalAction, royalTiming } from '../scene/royalMotion';
import type { RoyalCue } from '../scene/royalMotion';
import type { Profile, RatingEntry } from '../rating/elo';
import { openGameStore } from '../storage/database';
import type { GameStore, StorageProblem } from '../storage/database';
import {
  advanceLesson, confirmInspection, instruction, learnerAction, restoreLearning, saveLearning,
  scriptAction, startLesson, teachingBeat,
} from '../tutorial/controller';
import type { Learning } from '../tutorial/controller';
import { createContinuation, createMatch, SessionError } from './match';
import type { GameSession, MatchRecord, SessionCode, SessionConfig } from './match';
import { newId } from './random';
import { importMatch, restoreMatch } from './save';

export type View = 'home' | 'game' | 'learn';

interface CabinetState {
  readonly ready: boolean;
  readonly durable: boolean;
  readonly storageProblem: StorageProblem | null;
  readonly busy: boolean;
  readonly animating: boolean;
  readonly teachingReturning: boolean;
  readonly thinking: boolean;
  readonly searchFailed: boolean;
  readonly pageVisible: boolean;
  readonly resultRead: { readonly id: number; readonly cueId: string; readonly durationMs: number } | null;
  readonly profile: Profile;
  readonly ledger: readonly RatingEntry[];
  readonly matches: readonly MatchRecord[];
  readonly view: View;
  readonly game: GameSession | null;
  readonly learning: Learning | null;
  readonly error: SessionCode | null;
  readonly motionKey: string;
  readonly rollId: string | null;
  readonly rollPhase: 'idle' | 'throwing' | 'settled';
  readonly awaitingReaction: boolean;
  readonly rollReduced: boolean;
  readonly rollStartedAt: number | null;
  readonly audioCue: {
    readonly id: string; readonly events: readonly GameEvent[]; readonly human: Side | null;
    readonly startedAt: number; readonly royal: ReturnType<typeof royalAction>; readonly plan: ActionPlan;
    readonly playback?: PromotionPlayback;
  } | null;
  readonly promotionStage: PromotionStage | null;
  readonly waitingForBloodlust: boolean;
  readonly royalPending: boolean;
  readonly royalCue: RoyalCue | null;
  readonly royalResolved: boolean;
}

function preference(key: string, setting?: string) {
  try {
    if (setting !== undefined) localStorage.setItem(key, setting);
    return localStorage.getItem(key);
  } catch { return null; }
}

export const VIEW_STORAGE_KEY = 'remorse-view-v1';

function lastRoll(game: GameSession) {
  const action = game.record.actions[game.record.cursor - 1];
  return action?.roll ? action.id : null;
}

function errorCode(error: unknown): SessionCode {
  return error instanceof SessionError ? error.code : 'storage';
}

function storageProblem(code: SessionCode): code is StorageProblem {
  return code === 'storage' || code === 'storageTimeout' || code === 'storageBlocked' || code === 'storageClosed';
}

function documentVisible() {
  return typeof document === 'undefined' || !document.hidden;
}

export class Cabinet {
  private data: CabinetState = {
    ready: false, durable: false, storageProblem: null, busy: false, animating: false, teachingReturning: false, thinking: false, searchFailed: false,
    pageVisible: documentVisible(), resultRead: null,
    profile: initialProfile, ledger: [], matches: [], view: 'home', game: null, learning: null,
    error: null, motionKey: 'home', rollId: null, rollPhase: 'idle', awaitingReaction: false, rollReduced: false, rollStartedAt: null, audioCue: null,
    promotionStage: null, waitingForBloodlust: false, royalPending: false, royalCue: null, royalResolved: false,
  };
  private readonly listeners = new Set<() => void>();
  private store: GameStore | null = null;
  private generation = 0;
  private worker: Worker | null = null;
  private workerDeadline: ReturnType<typeof setTimeout> | undefined;
  private replyTimer: ReturnType<typeof setTimeout> | undefined;
  private workerReply: { game: GameSession; next: GameSession; readyAt: number } | undefined;
  private readUntil: number | null = null;
  private readSequence = 0;
  private scheduled: ReturnType<typeof setTimeout> | undefined;
  private presentationTimers: ReturnType<typeof setTimeout>[] = [];
  private fastForwardPresentation: (() => void) | undefined;
  private royalEnd: ReturnType<typeof setTimeout> | undefined;
  private teachingReturn: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private shortMotion = false;
  private teachingCamera = true;
  private initialized = false;
  private updates: BroadcastChannel | undefined;
  private storageGeneration = 0;
  private overviewSequence = 0;
  private unsavedGameId: string | null = null;
  private unsavedPracticeCopied = false;

  getSnapshot = () => this.data;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private patch(settings: Partial<CabinetState>) {
    this.data = { ...this.data, ...settings };
    this.listeners.forEach(listener => listener());
  }

  private async refreshOverview() {
    const store = this.store;
    const generation = this.storageGeneration;
    const sequence = ++this.overviewSequence;
    if (!store) return;
    const overview = await store.overview();
    if (this.store === store && this.storageGeneration === generation && this.overviewSequence === sequence) {
      this.patch(overview);
    }
  }

  initialize = async () => {
    if (this.initialized) return;
    this.initialized = true;
    await this.connectStorage(false);
  };

  retryStorage = async () => {
    if (this.data.busy) return;
    await this.connectStorage(true);
  };

  private storageUnavailable(problem: StorageProblem, generation = this.storageGeneration) {
    if (this.storageGeneration !== generation) return;
    this.storageGeneration += 1;
    this.overviewSequence += 1;
    this.store?.close();
    this.store = null;
    this.updates?.close();
    this.updates = undefined;
    this.generation += 1;
    this.stopWorker();
    clearTimeout(this.scheduled);
    // Keep the last confirmed board, teaching focus and already delivered cue.
    // A storage failure must not replay or replace that presentation.
    this.patch({ ready: true, durable: false, storageProblem: problem, error: problem, thinking: false });
  }

  private requireStorageRecovery() {
    if (this.data.storageProblem) throw new SessionError(this.data.storageProblem);
  }

  private async connectStorage(recover: boolean) {
    const previous = this.data;
    let unsavedGame = previous.game?.record.id === this.unsavedGameId ? previous.game : null;
    const generation = ++this.storageGeneration;
    ++this.overviewSequence;
    this.store?.close();
    this.store = null;
    this.updates?.close();
    this.updates = undefined;
    this.invalidate();
    this.patch({ ready: false, error: null });
    let store: GameStore | undefined;
    try {
      store = await openGameStore(undefined, { onUnavailable: problem => this.storageUnavailable(problem, generation) });
      if (this.storageGeneration !== generation) { store.close(); return; }
      this.store = store;
      if (unsavedGame) {
        try { await store.savePracticeOnReconnect(unsavedGame); }
        catch (error) {
          if (this.storageGeneration !== generation || this.store !== store) return;
          if (!(error instanceof SessionError) || error.code !== 'stale') throw error;
          // Another tab changed a record created by an earlier recovery attempt.
          // Preserve both histories. Retain this new ID even if its save times out.
          unsavedGame = restoreMatch({ ...unsavedGame.record, id: newId() });
          this.unsavedGameId = unsavedGame.record.id;
          this.unsavedPracticeCopied = true;
          this.patch({ game: unsavedGame });
          if (previous.view === 'game') preference(VIEW_STORAGE_KEY, `game/${unsavedGame.record.id}`);
          await store.savePracticeOnReconnect(unsavedGame);
        }
        if (this.storageGeneration !== generation || this.store !== store) return;
      }
      const [overview, learningSave] = await Promise.all([store.overview(), store.getLearning()]);
      if (this.storageGeneration !== generation || this.store !== store) return;
      let learning: Learning | null = null;
      let error: SessionCode | null = this.unsavedPracticeCopied ? 'practiceCopied' : null;
      if (learningSave) {
        try { learning = restoreLearning(learningSave); }
        catch { error = 'invalidSave'; }
      }
      // Recover the same active match, never whichever saved game sorts first.
      const previousGame = unsavedGame ?? previous.game;
      const last = recover && previous.view === 'learn' ? 'learn' : recover && previous.view === 'game' && previousGame
        ? `game/${previousGame.record.id}` : preference(VIEW_STORAGE_KEY);
      let view: View = 'home';
      let game: GameSession | null = previousGame;
      let restored: GameSession | undefined;
      if (last === 'learn' && learning) {
        view = 'learn';
        restored = learning.session;
      } else if (last?.startsWith('game/')) {
        const record = overview.matches.find(match => match.id === last.slice(5));
        if (record && ['open', 'finished'].includes(record.status)) {
          try {
            game = restoreMatch(record);
            restored = game;
            view = 'game';
          } catch { error = 'invalidSave'; }
        }
      }
      this.unsavedGameId = null;
      this.unsavedPracticeCopied = false;
      this.patch({ ...overview, learning, game, view, error, ready: true, durable: true, storageProblem: null,
        ...(restored ? { motionKey: restored.record.id, rollId: lastRoll(restored) } : {}) });
      if (typeof BroadcastChannel !== 'undefined') {
        this.updates = new BroadcastChannel('remorse-v1');
        this.updates.onmessage = () => { void this.refreshOverview().catch(() => undefined); };
      }
    } catch (error) {
      store?.close();
      if (this.storageGeneration !== generation) return;
      const code = errorCode(error);
      this.storageUnavailable(storageProblem(code) ? code : 'storage', generation);
    }
    this.pump();
  }

  setShortMotion(shortMotion: boolean) {
    this.shortMotion = shortMotion;
    if (shortMotion && this.data.teachingReturning) this.finishTeachingReturn();
    if (shortMotion && this.data.royalCue && !this.data.royalCue.reduced) this.finishRoyal();
  }

  setTeachingCamera(enabled: boolean) {
    this.teachingCamera = enabled;
    if (!enabled && this.data.teachingReturning) this.finishTeachingReturn();
  }
  dismissError = () => this.patch({ error: null });

  private newResultRead(cue: NonNullable<CabinetState['audioCue']>) {
    this.readUntil = null;
    return { id: ++this.readSequence, cueId: cue.id, durationMs: cue.plan.reduced ? 650 : 840 };
  }

  /** The view calls this after the current result has had a visible paint opportunity. */
  acknowledgeResult = (id: number) => {
    const read = this.data.resultRead;
    if (!read || read.id !== id || read.cueId !== this.data.audioCue?.id || this.readUntil !== null
      || this.data.view !== 'game' || !this.data.pageVisible || !documentVisible()) return;
    this.readUntil = performance.now() + read.durationMs;
    this.pump();
  };

  /** A modal or history view must not count as time spent reading the live result. */
  deferResultReading = (id: number) => {
    if (this.data.resultRead?.id !== id) return;
    this.readUntil = null;
    clearTimeout(this.replyTimer);
  };

  setPageVisible = (visible: boolean) => {
    if (this.data.pageVisible === visible) return;
    clearTimeout(this.replyTimer);
    clearTimeout(this.scheduled);
    const cue = this.data.audioCue;
    const resultRead = this.data.resultRead && cue ? this.newResultRead(cue) : null;
    this.patch({ pageVisible: visible, resultRead });
    if (!visible) this.finishHiddenPresentation();
    this.pump();
  };

  private stopWorker() {
    this.worker?.terminate();
    this.worker = null;
    clearTimeout(this.workerDeadline);
    clearTimeout(this.replyTimer);
    this.workerReply = undefined;
  }

  private invalidate() {
    this.generation += 1;
    this.stopWorker();
    clearTimeout(this.scheduled);
    this.clearPresentation();
    clearTimeout(this.royalEnd);
    clearTimeout(this.teachingReturn);
    this.attempts = 0;
    this.readUntil = null;
    this.patch({ thinking: false, animating: false, teachingReturning: false, searchFailed: false, motionKey: newId(), rollId: null,
      rollPhase: 'idle', awaitingReaction: false, rollStartedAt: null, audioCue: null, resultRead: null, promotionStage: null, waitingForBloodlust: false, royalPending: false, royalCue: null, royalResolved: false });
  }

  private async run(action: () => void | Promise<void>): Promise<boolean> {
    if (!this.data.ready || this.data.busy) return false;
    this.patch({ busy: true, error: null });
    let success = true;
    try {
      await action();
    } catch (error) {
      success = false;
      const code = errorCode(error);
      if (storageProblem(code) && !this.data.storageProblem) this.storageUnavailable(code);
      if (code === 'stale') {
        const game = this.data.game;
        const store = this.store;
        // A concurrent tab can supersede the optional overview refresh. An
        // explicit conflict needs the canonical record for this specific game.
        const latest = game && store ? await store.getMatch(game.record.id).catch(() => undefined) : undefined;
        if (latest && this.store === store && this.data.game === game && latest.revision !== game?.record.revision) {
          this.invalidate();
          if (latest.status === 'open' || latest.status === 'finished') {
            try {
              const restored = restoreMatch(latest);
              this.patch({ game: restored, rollId: lastRoll(restored) });
            } catch { this.patch({ view: 'home', game: null }); }
          } else {
            this.patch({ view: 'home', game: null });
          }
        }
      }
      if (code === 'stale' || code === 'ratedOccupied') void this.refreshOverview().catch(() => undefined);
      this.patch({ error: code });
    } finally {
      this.patch({ busy: false });
      this.pump();
    }
    return success;
  }

  private changedStore() {
    this.updates?.postMessage(null);
    // This list refresh is not part of committing the player's move. A slow
    // read must not keep input locked after that move has already been saved.
    void this.refreshOverview().catch(() => undefined);
  }

  private async persist(previous: GameSession, next: GameSession, afterCommit?: () => void) {
    if (previous === next) return;
    this.requireStorageRecovery();
    const store = this.store;
    const entry = store ? await store.commit(previous, next) : undefined;
    if (store !== this.store) throw new SessionError(this.data.storageProblem ?? 'storageClosed');
    if (!store && previous.record.config.mode === 'rated') throw new SessionError('storage');
    afterCommit?.();
    this.patch({ game: next,
      matches: [next.record, ...this.data.matches.filter(match => match.id !== next.record.id)],
      ...(entry ? { ledger: [entry, ...this.data.ledger.filter(item => item.matchId !== entry.matchId)] } : {}),
    });
    this.changedStore();
  }

  private enterGame(game: GameSession) {
    this.invalidate();
    if (this.unsavedGameId !== game.record.id) this.unsavedPracticeCopied = false;
    this.unsavedGameId = this.store ? null : game.record.id;
    this.patch({ game, view: 'game', rollId: lastRoll(game),
      matches: [game.record, ...this.data.matches.filter(match => match.id !== game.record.id)],
    });
    preference(VIEW_STORAGE_KEY, `game/${game.record.id}`);
  }

  home = () => this.run(() => {
    this.invalidate();
    this.patch({ view: 'home' });
    preference(VIEW_STORAGE_KEY, 'home');
  });

  startGame = (config: SessionConfig) => this.run(async () => {
    let game: GameSession;
    if (config.mode === 'rated') {
      if (!this.store || !config.human || !config.level) throw new SessionError('storage');
      game = await this.store.reserveRated(config.human, config.level, config.names);
    } else {
      // Starting a distinct practice match is the explicit memory-only fallback.
      // An existing saved match stays paused until recovery verifies its revision.
      if (!this.store) this.patch({ storageProblem: null, matches: [] });
      game = createMatch(config);
      if (this.store) await this.store.addPractice(game);
    }
    this.enterGame(game);
    this.changedStore();
  });

  resumeGame = (id: string) => this.run(async () => {
    this.requireStorageRecovery();
    const current = this.data.game;
    const record = (await this.store?.getMatch(id)) ?? (current?.record.id === id ? current.record : null);
    if (!record || (record.status !== 'open' && record.status !== 'finished')) throw new SessionError('invalidSave');
    this.enterGame(restoreMatch(record));
  });

  closeRated = (id: string, technical = false) => this.run(async () => {
    if (!this.store) throw new SessionError('storage');
    const current = this.data.game;
    if (technical && (!this.data.searchFailed || current?.record.id !== id)) throw new SessionError('invalidCommand');
    const game = restoreMatch(await this.store.getMatch(id));
    if (game.record.config.mode !== 'rated' || !game.record.config.human) throw new SessionError('invalidCommand');
    if (game.record.activated && !technical) {
      const resigned = game.submit(game.envelope({ type: 'resign' }, game.record.config.human), 'human');
      await this.store.commit(game, resigned);
    } else {
      await this.store.closeRated(game, technical);
    }
    if (current?.record.id === id) {
      this.invalidate();
      this.patch({ game: null, view: 'home' });
      preference(VIEW_STORAGE_KEY, 'home');
    }
    this.changedStore();
  });

  loadFile = (text: string) => this.run(async () => {
    this.requireStorageRecovery();
    const next = importMatch(text);
    if (this.store) await this.store.addPractice(next);
    this.enterGame(next);
    this.changedStore();
  });

  private clearPresentation() {
    this.presentationTimers.forEach(timer => clearTimeout(timer));
    this.presentationTimers = [];
    this.fastForwardPresentation = undefined;
  }

  finishHiddenPresentation = () => {
    this.fastForwardPresentation?.();
    this.finishRoyal();
  };

  private present(game: GameSession, playback?: PromotionPlayback) {
    const action = game.record.actions[game.record.cursor - 1];
    if (!action) return;
    // The lesson can resume the remaining presentation of a committed action.
    const startedAt = performance.now();
    const { events } = game.current;
    const { human, mode } = game.record.config;
    const royal = mode === 'tutorial' ? null : royalAction(game.state, events, human, this.shortMotion);
    const plan = actionPlan(events, Boolean(action.roll), this.shortMotion, Boolean(royal),
      { deferUnrolledBloodlust: mode !== 'tutorial' });
    const audioCue = { id: `${game.record.id}/${action.id}`, events, human, startedAt, royal, plan, playback };
    const needsRead = mode !== 'tutorial' && game.record.config.level !== null && game.record.status === 'open'
      && (Boolean(plan.roll) || events.some(event => event.type === 'reaction' || event.type === 'affliction'));
    const reveal = (fields: Partial<CabinetState>) => this.patch({ ...fields,
      ...(needsRead ? { resultRead: this.newResultRead(audioCue) } : {}) });
    const showsMotion = action.command.type === 'move' || action.command.type === 'endTurn';
    if (!showsMotion) { this.patch({ audioCue }); return; }

    this.clearPresentation();
    this.readUntil = null;
    const { roll, promotion } = plan;
    const resumeAt = playback === 'formation' ? promotion?.formationAt ?? 0 : 0;
    const holdAt = playback === 'reaction' ? promotion?.reactionAt ?? null : null;
    this.patch({ audioCue, resultRead: null, animating: true, rollId: roll && resumeAt ? action.id : null,
      rollPhase: 'idle', awaitingReaction: Boolean(roll && !resumeAt), rollReduced: plan.reduced,
      rollStartedAt: resumeAt ? this.data.rollStartedAt : null, royalPending: Boolean(royal),
      promotionStage: promotion ? resumeAt ? 'formation' : 'contact' : null, waitingForBloodlust: plan.escalationAt !== null });
    const at = (offset: number, run: () => void) => {
      this.presentationTimers.push(setTimeout(() => {
        if (this.data.audioCue === audioCue && this.data.animating) run();
      }, offset - resumeAt));
    };
    if (roll && !resumeAt) {
      at(roll.start, () => this.patch({
        rollId: action.id, rollPhase: 'throwing', rollStartedAt: startedAt + roll.start,
        promotionStage: promotion ? 'roll' : null,
      }));
      at(roll.settle, () => this.patch({ rollPhase: 'settled' }));
      if (holdAt === null) at(roll.reveal, () => reveal({ awaitingReaction: false,
        ...(promotion ? { promotionStage: 'reaction' as const } : {}) }));
    }
    if (holdAt !== null) {
      const hold = (skipRemainingThrow = false) => {
        this.clearPresentation();
        this.patch({ animating: false, awaitingReaction: false, promotionStage: 'reaction',
          rollId: roll ? action.id : null, rollPhase: roll ? 'settled' : 'idle',
          rollStartedAt: skipRemainingThrow ? null : this.data.rollStartedAt });
      };
      this.fastForwardPresentation = () => hold(true);
      at(holdAt, hold);
      if (!this.data.pageVisible || !documentVisible()) this.finishHiddenPresentation();
      return;
    }
    if (plan.escalationAt !== null) at(plan.escalationAt, () => reveal({ waitingForBloodlust: false }));
    if (promotion) {
      if (!resumeAt) {
        if (!roll && promotion.reactionAt !== null) at(promotion.reactionAt, () => reveal({ promotionStage: 'reaction' }));
        if (promotion.surgeAt !== null) at(promotion.surgeAt, () => reveal({ promotionStage: 'surge' }));
        at(promotion.formationAt, () => this.patch({ promotionStage: 'formation', rollPhase: 'idle' }));
      }
      if (promotion.aftermathAt < plan.end) at(promotion.aftermathAt, () => this.patch({ promotionStage: 'aftermath' }));
    }
    const finish = () => {
      this.clearPresentation();
      const cue = royal && (typeof document === 'undefined' || !document.hidden)
        ? { ...royal, fromPromotion: Boolean(promotion), continuingCamera: promotion?.aftermathAt === plan.end,
          reduced: this.shortMotion, startedAt: performance.now() } : null;
      this.patch({ animating: false, rollPhase: 'idle', awaitingReaction: false, promotionStage: null, waitingForBloodlust: false, royalPending: false, royalCue: cue, royalResolved: false,
        ...(needsRead && this.data.resultRead === null ? { resultRead: this.newResultRead(audioCue) } : {}),
        ...(roll ? { rollId: action.id } : {}) });
      if (!cue) { this.pump(); return; }
      const { duration, resolution } = royalTiming(cue);
      this.royalEnd = cue.kind === 'check' ? setTimeout(this.finishRoyal, duration) : setTimeout(() => {
        this.patch({ royalResolved: true });
        this.royalEnd = setTimeout(this.finishRoyal, duration - resolution);
      }, resolution);
    };
    this.fastForwardPresentation = finish;
    at(plan.end, finish);
    // A transaction begun while visible can finish after the tab was hidden.
    // Keep its committed result; there may be no further visibility event.
    if (!this.data.pageVisible || !documentVisible()) this.finishHiddenPresentation();
  }

  finishRoyal = () => {
    if (!this.data.royalCue) return;
    clearTimeout(this.royalEnd);
    this.patch({ royalCue: null, royalResolved: false });
    this.pump();
  };

  command = (command: Command) => this.run(async () => {
    this.requireStorageRecovery();
    if ((this.data.animating || this.data.teachingReturning || this.data.royalCue) && command.type !== 'resign') return;
    if (this.data.view === 'learn' && this.data.learning) {
      const current = this.data.learning;
      const { progress, explanation } = learnerAction(current, command);
      // A requested illegal attempt can now produce a positive teaching beat;
      // its unchanged session must not replay the previous move, die or sound.
      await this.updateLearning(progress, progress.session !== current.session
        ? () => this.present(progress.session, progress.pendingTeaching?.beforeFormation ? 'reaction' : undefined) : undefined);
      if (explanation) this.patch({ error: explanation });
      return;
    }
    const current = this.data.game;
    if (this.data.view !== 'game' || !current) throw new SessionError('invalidCommand');
    const actor = command.type === 'resign' && current.record.config.human
      ? current.record.config.human : current.state.side;
    const next = current.submit(current.envelope(command, actor), 'human');
    await this.persist(current, next, () => {
      if (command.type === 'resign') this.invalidate();
      this.present(next);
    });
  });

  edit = (edit: 'undo' | 'redo' | number) => this.run(async () => {
    this.requireStorageRecovery();
    const game = this.data.game;
    if (this.data.view !== 'game' || !game) throw new SessionError('invalidCommand');
    const next = typeof edit === 'number' ? game.changeLevel(edit) : game[edit]();
    this.invalidate();
    await this.persist(game, next);
    this.patch({ rollId: lastRoll(next) });
  });

  private async updateLearning(learning: Learning, afterCommit?: () => void) {
    this.requireStorageRecovery();
    const store = this.store;
    if (store) await store.putLearning(saveLearning(learning));
    if (store !== this.store) throw new SessionError(this.data.storageProblem ?? 'storageClosed');
    afterCommit?.();
    this.patch({ learning });
  }

  private returnFromTeaching(previous: Learning, next: Learning, alreadyReturning = false) {
    const focusOf = (learning: Learning) => {
      if (learning.pendingTeaching) return teachingBeat(learning)?.focus;
      const step = instruction(learning);
      return step?.focus ?? (step?.kind === 'inspect' ? { square: step.square, subject: 'piece' } : undefined);
    };
    if (!this.teachingCamera || this.shortMotion || (!focusOf(previous) && !alreadyReturning) || focusOf(next)) return;
    clearTimeout(this.teachingReturn);
    const generation = this.generation;
    this.patch({ teachingReturning: true });
    this.teachingReturn = setTimeout(() => {
      if (this.generation !== generation) return;
      this.finishTeachingReturn();
    }, CAMERA_TRAVEL_MS);
  }

  private finishTeachingReturn() {
    clearTimeout(this.teachingReturn);
    this.teachingReturn = undefined;
    this.patch({ teachingReturning: false });
    this.pump();
  }

  learn = async (restart = false) => {
    if (!this.data.ready || this.data.busy) return false;
    // Memory-only fallback is for ordinary games. A tutorial must retain its
    // checkpoint when storage reconnects, including when resuming a lesson.
    if (!this.store || !this.data.durable) {
      this.patch({ error: 'storage' });
      return false;
    }
    return this.run(async () => {
      const learning = !restart && this.data.learning ? this.data.learning : startLesson();
      await this.updateLearning(learning);
      this.invalidate();
      this.patch({ view: 'learn', rollId: lastRoll(learning.session) });
      preference(VIEW_STORAGE_KEY, 'learn');
    });
  };

  inspect = (square: string) => this.run(async () => {
    if (!this.data.learning || this.data.view !== 'learn' || this.data.animating || this.data.teachingReturning) return;
    const current = this.data.learning;
    const next = confirmInspection(current, square);
    if (next !== current) await this.updateLearning(next, () => this.returnFromTeaching(current, next));
  });

  advance = () => this.run(async () => {
    const current = this.data.learning;
    if (!current || this.data.view !== 'learn' || this.data.animating || this.data.teachingReturning) return;
    let next = advanceLesson(current);
    // A result or final reading already concludes its example. Commit the next
    // position together with that acknowledgement, without an empty extra page.
    // A saved legacy position-complete checkpoint still follows the usual path.
    const acknowledged = current.pendingTeaching || instruction(current)?.kind === 'read';
    if (acknowledged && !next.pendingTeaching && !instruction(next) && !next.complete) next = advanceLesson(next);
    await this.updateLearning(next, () => {
      if (current.pendingTeaching?.beforeFormation) {
        this.present(current.session, 'formation');
        return;
      }
      if (next.session.record.id !== current.session.record.id) this.invalidate();
      // The scene camera survives fixture changes. A new generation must own
      // the return gate, so a new board cannot accept input while still close.
      this.returnFromTeaching(current, next);
    });
  });

  restartLesson = () => this.run(async () => {
    if (!this.data.learning || this.data.view !== 'learn') return;
    const previous = this.data.learning;
    const next = startLesson(previous.lesson);
    const alreadyReturning = this.data.teachingReturning;
    await this.updateLearning(next, () => {
      this.invalidate();
      this.returnFromTeaching(previous, next, alreadyReturning);
    });
  });

  handoff = () => this.run(async () => {
    this.requireStorageRecovery();
    const { learning, view } = this.data;
    if (!learning || view !== 'learn') return;
    if (learning.pendingTeaching || this.data.animating || this.data.teachingReturning) throw new SessionError('tutorialChoice');
    const game = createContinuation(learning.session);
    if (this.store) await this.store.addPractice(game);
    this.enterGame(game);
    this.changedStore();
  });

  retrySearch = () => {
    this.attempts = 0;
    this.patch({ error: null, searchFailed: false });
    this.pump();
  };

  private pump() {
    clearTimeout(this.scheduled);
    if (!this.data.ready || this.data.storageProblem) return;
    const { view, busy, game, learning, animating, teachingReturning, royalCue, thinking, searchFailed } = this.data;
    if (busy || animating || teachingReturning || royalCue || searchFailed) return;
    if (view === 'game' && game?.record.status === 'open' && game.record.config.level
      && game.record.config.human !== game.state.side) {
      const reply = this.workerReply;
      if (reply?.game === game) {
        clearTimeout(this.replyTimer);
        // Search may finish while hidden or before the result is painted. Only
        // consuming its answer is gated; do not put Infinity into a timer.
        if (!this.data.pageVisible || !documentVisible() || (this.data.resultRead && this.readUntil === null)) return;
        const remaining = Math.ceil(Math.max(reply.readyAt, this.readUntil ?? 0) - performance.now());
        if (remaining > 0) {
          this.replyTimer = setTimeout(() => this.pump(), remaining);
          return;
        }
        this.workerReply = undefined;
        this.patch({ thinking: false });
        void this.run(async () => {
          await this.persist(game, reply.next, () => this.present(reply.next));
        }).then(ok => {
          if (!ok && this.data.game === game && this.data.view === 'game' && !this.data.storageProblem) {
            this.stopWorker();
            this.patch({ thinking: false, searchFailed: true });
          }
        });
      } else if (!thinking) this.search(game);
      return;
    }
    if (this.data.pageVisible && documentVisible() && view === 'learn' && learning && !learning.pendingTeaching
      && instruction(learning)?.kind === 'script' && this.data.error !== 'tutorialBroken') {
      const generation = this.generation;
      this.scheduled = setTimeout(() => {
        if (this.generation !== generation || this.data.learning !== learning || this.data.view !== 'learn'
          || !this.data.pageVisible || !documentVisible()) return;
        void this.run(async () => {
          const next = scriptAction(learning);
          await this.updateLearning(next, () => this.present(next.session));
        });
      }, this.shortMotion ? 100 : 320);
    }
  }

  private search(game: GameSession) {
    const preset = getPreset(game.record.config.level ?? 0);
    if (!preset) return;
    // Search runs during the pause. Presentation jitter never touches the saved die stream.
    const thinkMs = this.shortMotion ? 210 + Math.random() * 220 : 330 + Math.random() * 310;
    const readyAt = performance.now() + thinkMs;
    const request: SearchRequest = {
      type: 'search', requestId: newId(), gameId: game.record.id, gameRevision: game.record.revision,
      sessionGeneration: this.generation, rulesVersion: game.state.rulesVersion, engineVersion: ENGINE_VERSION,
      presetId: preset.id, presetVersion: PRESET_VERSION, publicState: game.state,
    };
    this.patch({ thinking: true });
    const current = () => this.generation === request.sessionGeneration && this.data.game === game
      && this.data.view === 'game';
    const failed = () => {
      if (!current()) return;
      this.stopWorker();
      this.attempts += 1;
      const exhausted = this.attempts > 1;
      this.patch({ thinking: false, searchFailed: exhausted, error: exhausted ? 'workerFailed' : null });
      if (!exhausted) this.pump();
    };
    try {
      const worker = new Worker(new URL('../engine/search.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      const failWorker = () => { if (this.worker === worker) failed(); };
      worker.onerror = failWorker;
      worker.onmessageerror = failWorker;
      worker.onmessage = ({ data }: MessageEvent<SearchResponse>) => {
        if (this.worker !== worker || !current()) return;
        const matches = data && data.requestId === request.requestId && data.gameId === request.gameId
          && data.gameRevision === request.gameRevision && data.sessionGeneration === request.sessionGeneration
          && data.rulesVersion === request.rulesVersion && data.engineVersion === request.engineVersion
          && data.presetId === request.presetId && data.presetVersion === request.presetVersion;
        if (!matches || data.type !== 'result' || !data.command) { failed(); return; }
        let next: GameSession;
        try {
          next = game.submit(game.envelope(data.command), 'bot');
        } catch { failed(); return; }
        this.stopWorker();
        this.attempts = 0;
        this.workerReply = { game, next, readyAt };
        this.pump();
      };
      this.workerDeadline = setTimeout(failWorker, preset.maxTimeMs + 2500);
      worker.postMessage(request);
    } catch { failed(); }
  }
}
