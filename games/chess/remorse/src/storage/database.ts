import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase, IDBPTransaction, StoreNames } from 'idb';
import { ENGINE_VERSION, getPreset, PRESET_VERSION } from '../engine/presets';
import { calculateElo, initialProfile, RATING_VERSION, scoreOf } from '../rating/elo';
import type { Profile, RatingEntry } from '../rating/elo';
import type { Side } from '../core';
import { createMatch, SessionError } from '../session/match';
import type { GameSession, MatchRecord, SessionConfig } from '../session/match';

interface RemorseDatabase extends DBSchema {
  profiles: { key: 'local'; value: Profile };
  matches: { key: string; value: MatchRecord };
  ratingLedger: { key: string; value: RatingEntry };
  learning: { key: 'progress'; value: unknown };
}

const WRITE_STORES = ['profiles', 'matches', 'ratingLedger'] as const;
export const STORAGE_TIMEOUT_MS = 6000;
export type StorageProblem = 'storage' | 'storageTimeout' | 'storageBlocked' | 'storageClosed';

export class StorageError extends SessionError {
  constructor(code: StorageProblem) { super(code); }
}

interface StorageOptions {
  readonly timeoutMs?: number;
  readonly onUnavailable?: (problem: StorageProblem) => void;
}

function sameRatedConfig(current: SessionConfig, next: SessionConfig): boolean {
  const saved = current.rating;
  const proposed = next.rating;
  return Boolean(saved && proposed
    && current.mode === next.mode && current.human === next.human
    && current.level === next.level && current.provenance === next.provenance
    && current.names?.white === next.names?.white && current.names?.black === next.names?.black
    && saved.ratingBefore === proposed.ratingBefore && saved.profileRevision === proposed.profileRevision
    && saved.anchor === proposed.anchor && saved.scaleVersion === proposed.scaleVersion
    && saved.engineVersion === proposed.engineVersion && saved.presetVersion === proposed.presetVersion);
}

export function openGameStore(name = 'remorse-v1', options: StorageOptions = {}): Promise<GameStore> {
  return new Promise((resolve, reject) => {
    let abandoned = false;
    let store: GameStore | undefined;
    const fail = (problem: StorageProblem) => {
      if (abandoned) return;
      abandoned = true;
      clearTimeout(timer);
      reject(new StorageError(problem));
      options.onUnavailable?.(problem);
    };
    const timer = setTimeout(() => fail('storageTimeout'), options.timeoutMs ?? STORAGE_TIMEOUT_MS);
    let opening: Promise<IDBPDatabase<RemorseDatabase>>;
    try { opening = openDB<RemorseDatabase>(name, 1, {
      upgrade(database, previousVersion) {
        if (previousVersion < 1) {
          database.createObjectStore('profiles', { keyPath: 'id' });
          database.createObjectStore('matches', { keyPath: 'id' });
          database.createObjectStore('ratingLedger', { keyPath: 'matchId' });
          database.createObjectStore('learning');
        }
      },
      blocked() { fail('storageBlocked'); },
      blocking() { store?.unavailable('storageClosed'); },
      terminated() { store?.unavailable('storageClosed'); },
    }); } catch (error) {
      clearTimeout(timer);
      abandoned = true;
      reject(error);
      return;
    }
    void opening.then(db => {
      clearTimeout(timer);
      // An IDB open request cannot be cancelled. Never retain a connection
      // delivered after the caller has already entered recovery.
      if (abandoned) { db.close(); return; }
      store = new GameStore(db, options);
      resolve(store);
    }, error => {
      clearTimeout(timer);
      abandoned = true;
      reject(error);
    });
  });
}

export class GameStore {
  private closed = false;
  private readonly pending = new Set<() => void>();

  constructor(private readonly db: IDBPDatabase<RemorseDatabase>, private readonly options: StorageOptions = {}) {}

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const cancel of this.pending) cancel();
    this.db.close();
  }

  unavailable(problem: StorageProblem): void {
    if (this.closed) return;
    this.close();
    this.options.onUnavailable?.(problem);
  }

  private transact<Names extends ArrayLike<StoreNames<RemorseDatabase>>, Mode extends IDBTransactionMode, Result>(
    names: Names, mode: Mode,
    action: (tx: IDBPTransaction<RemorseDatabase, Names, Mode>) => Promise<Result>,
  ): Promise<Result> {
    if (this.closed) return Promise.reject(new StorageError('storageClosed'));
    const tx = this.db.transaction(names, mode);
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (complete: () => void) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.pending.delete(cancel);
        complete();
      };
      const abort = () => {
        try { tx.abort(); } catch { /* It may have committed before completion delivery. Recovery rereads it. */ }
      };
      const cancel = () => { abort(); finish(() => reject(new StorageError('storageClosed'))); };
      const timer = setTimeout(() => {
        // Abort the actual transaction, including one queued behind another tab.
        // A timeout never grants permission to continue from an unverified revision.
        abort();
        finish(() => reject(new StorageError('storageTimeout')));
        this.unavailable('storageTimeout');
      }, this.options.timeoutMs ?? STORAGE_TIMEOUT_MS);
      this.pending.add(cancel);
      // Subscribe before issuing a request: a synchronous DataCloneError must
      // still consume the rejection from aborting this transaction.
      const done = tx.done;
      void done.catch(() => undefined);
      let result: Promise<Result>;
      try { result = action(tx); } catch (error) {
        abort();
        finish(() => reject(error));
        return;
      }
      void Promise.all([result, done]).then(([result]) => {
        finish(() => resolve(result));
      }, error => {
        abort();
        finish(() => reject(error));
      });
    });
  }

  async overview() {
    return this.transact(WRITE_STORES, 'readonly', async tx => {
      const [profile, matches, ledger] = await Promise.all([
        tx.objectStore('profiles').get('local'),
        tx.objectStore('matches').getAll(),
        tx.objectStore('ratingLedger').getAll(),
      ]);
      return {
        profile: profile ?? initialProfile,
        matches: matches.sort((a, b) => b.updatedAt - a.updatedAt),
        ledger: ledger.sort((a, b) => b.timestamp - a.timestamp),
      };
    });
  }

  getMatch(id: string) { return this.transact(['matches'], 'readonly', tx => tx.objectStore('matches').get(id)); }
  getLearning() { return this.transact(['learning'], 'readonly', tx => tx.objectStore('learning').get('progress')); }
  putLearning(data: unknown) { return this.transact(['learning'], 'readwrite', tx => tx.objectStore('learning').put(data, 'progress')); }

  async addPractice(session: GameSession): Promise<void> {
    const { record } = session;
    if (record.config.mode === 'rated' || record.config.mode === 'tutorial') throw new SessionError('ratedLocked');
    await this.transact(['matches'], 'readwrite', tx => tx.objectStore('matches').add(record));
  }

  async savePracticeOnReconnect(session: GameSession): Promise<void> {
    const { record } = session;
    if (record.config.mode === 'rated' || record.config.mode === 'tutorial') throw new SessionError('ratedLocked');
    await this.transact(['matches'], 'readwrite', async tx => {
      const matches = tx.objectStore('matches');
      const existing = await matches.get(record.id);
      // A previous attempt may have committed before its completion was lost.
      // Accept that exact record; never replace another revision or fork.
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(record)) throw new SessionError('stale');
        return;
      }
      await matches.add(record);
    });
  }

  async reserveRated(human: Side, level: number, names?: SessionConfig['names']): Promise<GameSession> {
    const preset = getPreset(level);
    if (!preset) throw new SessionError('invalidCommand');
    return this.transact(WRITE_STORES, 'readwrite', async tx => {
      const profiles = tx.objectStore('profiles');
      const profile = await profiles.get('local') ?? initialProfile;
      if (profile.ratedId) throw new SessionError('ratedOccupied');
      const revision = profile.revision + 1;
      const session = createMatch({
        mode: 'rated', human, level, provenance: 'standard', names,
        rating: {
          ratingBefore: profile.rating, profileRevision: revision, anchor: preset.anchor,
          scaleVersion: RATING_VERSION, engineVersion: ENGINE_VERSION, presetVersion: PRESET_VERSION,
        },
      });
      await tx.objectStore('matches').add(session.record);
      await profiles.put({ ...profile, revision, ratedId: session.record.id });
      return session;
    });
  }

  async commit(previous: GameSession, next: GameSession): Promise<RatingEntry | undefined> {
    const { id, revision, config } = previous.record;
    if (previous === next || id !== next.record.id || next.record.revision !== revision + 1
      || config.mode === 'tutorial') throw new SessionError('stale');
    return this.transact(WRITE_STORES, 'readwrite', async tx => {
      const matches = tx.objectStore('matches');
      const profiles = tx.objectStore('profiles');
      const ledger = tx.objectStore('ratingLedger');
      const current = await matches.get(id);
      if (!current) throw new SessionError('stale');
      if (current.config.mode === 'rated' && current.status === 'finished') {
        const last = (match: MatchRecord) => match.actions.at(match.cursor - 1)?.id;
        if (next.record.status !== 'finished' || last(current) !== last(next.record)) throw new SessionError('stale');
        const existing = await ledger.get(id);
        return existing;
      }
      if (current.revision !== revision || current.config.mode !== config.mode) throw new SessionError('stale');
      if (config.mode !== 'rated') {
        await matches.put(next.record);
        return;
      }

      const contract = current.config.rating;
      const profile = await profiles.get('local');
      if (!contract || !profile || profile.ratedId !== id || profile.revision !== contract.profileRevision
        || profile.rating !== contract.ratingBefore || current.status !== 'open'
        || !sameRatedConfig(current.config, next.record.config)) throw new SessionError('stale');
      let entry: RatingEntry | undefined;
      const outcome = next.state.outcome;
      if (outcome) {
        const human = config.human;
        const level = config.level;
        if (!human || !level) throw new SessionError('invalidSave');
        if (next.record.activated) {
          const score = scoreOf(outcome, human);
          const elo = calculateElo(contract.ratingBefore, contract.anchor, score);
          entry = { matchId: id, ...elo, timestamp: next.record.updatedAt, outcome, human, level, contract };
          await ledger.add(entry);
        }
        await profiles.put({
          ...profile, ratedId: null, revision: profile.revision + 1,
          rating: entry?.after ?? profile.rating, best: Math.max(profile.best, entry?.after ?? profile.rating),
          wins: profile.wins + Number(entry?.score === 1),
          draws: profile.draws + Number(entry?.score === 0.5),
          losses: profile.losses + Number(entry?.score === 0),
        });
      }
      await matches.put(next.record);
      return entry;
    });
  }

  async closeRated(session: GameSession, technical = false): Promise<void> {
    const { id, revision, config } = session.record;
    if (config.mode !== 'rated') throw new SessionError('ratedLocked');
    return this.transact(['matches', 'profiles'], 'readwrite', async tx => {
      const matches = tx.objectStore('matches');
      const profiles = tx.objectStore('profiles');
      const current = await matches.get(id);
      const profile = await profiles.get('local');
      if (!current || !profile || current.status !== 'open' || profile.ratedId !== id
        || revision !== current.revision || profile.revision !== current.config.rating?.profileRevision) throw new SessionError('stale');
      if (current.activated && !technical) throw new SessionError('ratedLocked');
      await matches.put({
        ...current, revision: revision + 1, status: technical ? 'technical' : 'canceled', updatedAt: Date.now(),
      });
      await profiles.put({ ...profile, ratedId: null, revision: profile.revision + 1 });
    });
  }
}
