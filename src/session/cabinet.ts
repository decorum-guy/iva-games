import type { Command, GameEvent, Side } from '../core';
import { ENGINE_VERSION, getPreset, PRESET_VERSION } from '../engine/presets';
import type { SearchRequest, SearchResponse } from '../engine/protocol';
import { initialProfile } from '../rating/elo';
import { getDieMotionTiming, getDieThrowDuration } from '../scene/diceMotion';
import type { Profile, RatingEntry } from '../rating/elo';
import { openGameStore } from '../storage/database';
import type { GameStore } from '../storage/database';
import {
  advanceLesson, confirmInspection, instruction, learnerAction, restoreLearning, saveLearning,
  scriptAction, startLesson,
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
  readonly busy: boolean;
  readonly animating: boolean;
  readonly thinking: boolean;
  readonly searchFailed: boolean;
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
  readonly rollReduced: boolean;
  readonly rollStartedAt: number | null;
  readonly audioCue: { readonly id: string; readonly events: readonly GameEvent[]; readonly human: Side | null; readonly startedAt: number } | null;
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

export class Cabinet {
  private data: CabinetState = {
    ready: false, durable: false, busy: false, animating: false, thinking: false, searchFailed: false,
    profile: initialProfile, ledger: [], matches: [], view: 'home', game: null, learning: null,
    error: null, motionKey: 'home', rollId: null, rollPhase: 'idle', rollReduced: false, rollStartedAt: null, audioCue: null,
  };
  private readonly listeners = new Set<() => void>();
  private store: GameStore | null = null;
  private generation = 0;
  private worker: Worker | null = null;
  private workerDeadline: ReturnType<typeof setTimeout> | undefined;
  private scheduled: ReturnType<typeof setTimeout> | undefined;
  private reveal: ReturnType<typeof setTimeout> | undefined;
  private settle: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private shortMotion = false;
  private initialized = false;
  private updates: BroadcastChannel | undefined;

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
    if (this.store) this.patch(await this.store.overview());
  }

  initialize = async () => {
    if (this.initialized) return;
    this.initialized = true;
    try {
      this.store = await openGameStore();
      await this.refreshOverview();
      this.patch({ durable: true });
      if (typeof BroadcastChannel !== 'undefined') {
        this.updates = new BroadcastChannel('remorse-v1');
        this.updates.onmessage = () => { void this.refreshOverview().catch(() => undefined); };
      }
      const learningSave = await this.store.getLearning();
      if (learningSave) {
        try { this.patch({ learning: restoreLearning(learningSave) }); }
        catch { this.patch({ error: 'invalidSave' }); }
      }
      const last = preference(VIEW_STORAGE_KEY);
      if (last === 'learn' && this.data.learning) {
        this.patch({ view: 'learn', motionKey: this.data.learning.session.record.id, rollId: lastRoll(this.data.learning.session) });
      } else if (last?.startsWith('game/')) {
        const record = this.data.matches.find(match => match.id === last.slice(5));
        if (record && ['open', 'finished'].includes(record.status)) {
          try {
            const game = restoreMatch(record);
            this.patch({ game, view: 'game', motionKey: record.id, rollId: lastRoll(game) });
          } catch { this.patch({ error: 'invalidSave' }); }
        }
      }
    } catch {
      this.store?.close();
      this.store = null;
      this.patch({ durable: false, error: 'storage' });
    }
    this.patch({ ready: true });
    this.pump();
  };

  setShortMotion(shortMotion: boolean) { this.shortMotion = shortMotion; }
  dismissError = () => this.patch({ error: null });

  private stopWorker() {
    this.worker?.terminate();
    this.worker = null;
    clearTimeout(this.workerDeadline);
  }

  private invalidate() {
    this.generation += 1;
    this.stopWorker();
    clearTimeout(this.scheduled);
    clearTimeout(this.reveal);
    clearTimeout(this.settle);
    this.attempts = 0;
    this.patch({ thinking: false, animating: false, searchFailed: false, motionKey: newId(), rollId: null,
      rollPhase: 'idle', rollStartedAt: null, audioCue: null });
  }

  private async run(action: () => void | Promise<void>): Promise<boolean> {
    if (this.data.busy) return false;
    this.patch({ busy: true, error: null });
    let success = true;
    try {
      await action();
    } catch (error) {
      success = false;
      const code = errorCode(error);
      if (code === 'stale' || code === 'ratedOccupied') {
        await this.refreshOverview().catch(() => undefined);
        const latest = this.data.matches.find(match => match.id === this.data.game?.record.id);
        if (latest && latest.revision !== this.data.game?.record.revision) {
          this.invalidate();
          if (latest.status === 'open' || latest.status === 'finished') {
            try { this.patch({ game: restoreMatch(latest) }); } catch { this.patch({ view: 'home', game: null }); }
          } else {
            this.patch({ view: 'home', game: null });
          }
        }
      }
      this.patch({ error: code });
    } finally {
      this.patch({ busy: false });
      this.pump();
    }
    return success;
  }

  private async changedStore() {
    this.updates?.postMessage(null);
    // Persistence already committed. A failed overview read must not roll back the UI.
    await this.refreshOverview().catch(() => undefined);
  }

  private async persist(previous: GameSession, next: GameSession, afterCommit?: () => void) {
    if (previous === next) return;
    if (this.store) await this.store.commit(previous, next);
    if (!this.store && previous.record.config.mode === 'rated') throw new SessionError('storage');
    afterCommit?.();
    this.patch({ game: next });
    await this.changedStore();
  }

  private enterGame(game: GameSession) {
    this.invalidate();
    this.patch({ game, view: 'game', rollId: lastRoll(game) });
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
      game = createMatch(config);
      if (this.store) await this.store.addPractice(game);
    }
    this.enterGame(game);
    await this.changedStore();
  });

  resumeGame = (id: string) => this.run(async () => {
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
    await this.changedStore();
  });

  loadFile = (text: string) => this.run(async () => {
    const next = importMatch(text);
    if (this.store) await this.store.addPractice(next);
    this.enterGame(next);
    await this.changedStore();
  });

  private present(game: GameSession) {
    const action = game.record.actions[game.record.cursor - 1];
    if (!action) return;
    // This is a live, committed action. Restores/reviews never call present and
    // therefore cannot replay old sounds. Results need a cue even without motion.
    const startedAt = performance.now();
    const audioCue = { id: `${game.record.id}/${action.id}`, events: game.current.events, human: game.record.config.human, startedAt };
    const showsMotion = action.command.type === 'move' || action.command.type === 'endTurn';
    if (!showsMotion) { this.patch({ audioCue }); return; }
    clearTimeout(this.reveal);
    clearTimeout(this.settle);
    const rollId = action.roll ? action.id : null;
    const duration = rollId ? getDieThrowDuration(this.shortMotion) : this.shortMotion ? 75 : 330;
    this.patch({ audioCue, animating: true, rollId, rollPhase: rollId ? 'throwing' : 'idle', rollReduced: this.shortMotion,
      rollStartedAt: rollId ? startedAt : null });
    if (rollId) this.settle = setTimeout(() => {
      this.patch({ rollPhase: 'settled' });
    }, getDieMotionTiming(this.shortMotion).motionMs);
    this.reveal = setTimeout(() => {
      this.patch({ animating: false, rollPhase: 'idle' });
      this.pump();
    }, duration);
  }

  command = (command: Command) => this.run(async () => {
    if (this.data.animating && command.type !== 'resign') return;
    if (this.data.view === 'learn' && this.data.learning) {
      const { progress, explanation } = learnerAction(this.data.learning, command);
      await this.updateLearning(progress, !explanation ? () => this.present(progress.session) : undefined);
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
    const game = this.data.game;
    if (this.data.view !== 'game' || !game) throw new SessionError('invalidCommand');
    const next = typeof edit === 'number' ? game.changeLevel(edit) : game[edit]();
    this.invalidate();
    await this.persist(game, next);
    this.patch({ rollId: lastRoll(next) });
  });

  private async updateLearning(learning: Learning, afterCommit?: () => void) {
    if (this.store) await this.store.putLearning(saveLearning(learning));
    afterCommit?.();
    this.patch({ learning });
  }

  learn = (restart = false) => this.run(async () => {
    const learning = !restart && this.data.learning ? this.data.learning : startLesson();
    await this.updateLearning(learning);
    this.invalidate();
    this.patch({ view: 'learn', rollId: lastRoll(learning.session) });
    preference(VIEW_STORAGE_KEY, 'learn');
  });

  inspect = (square: string) => this.run(async () => {
    if (!this.data.learning || this.data.view !== 'learn' || this.data.animating) return;
    const next = confirmInspection(this.data.learning, square);
    if (next !== this.data.learning) await this.updateLearning(next);
  });

  advance = () => this.run(async () => {
    const current = this.data.learning;
    if (!current || this.data.view !== 'learn') return;
    const next = advanceLesson(current);
    await this.updateLearning(next);
    if (next.session.record.id !== current.session.record.id) this.invalidate();
  });

  restartLesson = () => this.run(async () => {
    if (!this.data.learning || this.data.view !== 'learn') return;
    await this.updateLearning(startLesson(this.data.learning.lesson));
    this.invalidate();
  });

  handoff = () => this.run(async () => {
    const { learning, view } = this.data;
    if (!learning || view !== 'learn') return;
    const game = createContinuation(learning.session);
    if (this.store) await this.store.addPractice(game);
    this.enterGame(game);
    await this.changedStore();
  });

  retrySearch = () => {
    this.attempts = 0;
    this.patch({ error: null, searchFailed: false });
    this.pump();
  };

  private pump() {
    clearTimeout(this.scheduled);
    const { view, busy, game, learning, animating, thinking, searchFailed } = this.data;
    if (busy || animating || thinking || searchFailed) return;
    if (view === 'learn' && learning && instruction(learning)?.kind === 'script' && this.data.error !== 'tutorialBroken') {
      const generation = this.generation;
      this.scheduled = setTimeout(() => {
        if (this.generation !== generation || this.data.learning !== learning || this.data.view !== 'learn') return;
        void this.run(async () => {
          const next = scriptAction(learning);
          await this.updateLearning(next, () => this.present(next.session));
        });
      }, this.shortMotion ? 100 : 320);
    }
    if (view === 'game' && game?.record.status === 'open' && game.record.config.level
      && game.record.config.human !== game.state.side) this.search(game);
  }

  private search(game: GameSession) {
    const preset = getPreset(game.record.config.level ?? 0);
    if (!preset) return;
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
      worker.onerror = failed;
      worker.onmessageerror = failed;
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
        this.patch({ thinking: false });
        void this.run(async () => {
          await this.persist(game, next, () => this.present(next));
        }).then(ok => {
          if (!ok && current()) {
            this.stopWorker();
            this.patch({ thinking: false, searchFailed: true });
          }
        });
      };
      this.workerDeadline = setTimeout(failed, preset.maxTimeMs + 2500);
      worker.postMessage(request);
    } catch { failed(); }
  }
}
