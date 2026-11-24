import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
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

export async function openGameStore(name = 'remorse-v1'): Promise<GameStore> {
  const db = await openDB<RemorseDatabase>(name, 1, {
    upgrade(database, previousVersion) {
      if (previousVersion < 1) {
        database.createObjectStore('profiles', { keyPath: 'id' });
        database.createObjectStore('matches', { keyPath: 'id' });
        database.createObjectStore('ratingLedger', { keyPath: 'matchId' });
        database.createObjectStore('learning');
      }
    },
    blocking() { db.close(); },
  });
  return new GameStore(db);
}

export class GameStore {
  constructor(private readonly db: IDBPDatabase<RemorseDatabase>) {}

  close(): void { this.db.close(); }

  async overview() {
    const tx = this.db.transaction(WRITE_STORES, 'readonly');
    const [profile, matches, ledger] = await Promise.all([
      tx.objectStore('profiles').get('local'),
      tx.objectStore('matches').getAll(),
      tx.objectStore('ratingLedger').getAll(),
      tx.done,
    ]);
    return {
      profile: profile ?? initialProfile,
      matches: matches.sort((a, b) => b.updatedAt - a.updatedAt),
      ledger: ledger.sort((a, b) => b.timestamp - a.timestamp),
    };
  }

  getMatch(id: string) { return this.db.get('matches', id); }
  getLearning() { return this.db.get('learning', 'progress'); }
  putLearning(data: unknown) { return this.db.put('learning', data, 'progress'); }

  async addPractice(session: GameSession): Promise<void> {
    const { record } = session;
    if (record.config.mode === 'rated' || record.config.mode === 'tutorial') throw new SessionError('ratedLocked');
    await this.db.add('matches', record);
  }

  async reserveRated(human: Side, level: number, names?: SessionConfig['names']): Promise<GameSession> {
    const preset = getPreset(level);
    if (!preset) throw new SessionError('invalidCommand');
    const tx = this.db.transaction(WRITE_STORES, 'readwrite');
    const done = tx.done.catch(() => undefined);
    try {
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
      await tx.done;
      return session;
    } catch (error) {
      try { tx.abort(); } catch { /* Already closed. */ }
      await done;
      throw error;
    }
  }

  async commit(previous: GameSession, next: GameSession): Promise<RatingEntry | undefined> {
    const { id, revision, config } = previous.record;
    if (previous === next || id !== next.record.id || next.record.revision !== revision + 1
      || config.mode === 'tutorial') throw new SessionError('stale');
    const tx = this.db.transaction(WRITE_STORES, 'readwrite');
    const done = tx.done.catch(() => undefined);
    try {
      const matches = tx.objectStore('matches');
      const profiles = tx.objectStore('profiles');
      const ledger = tx.objectStore('ratingLedger');
      const current = await matches.get(id);
      if (!current) throw new SessionError('stale');
      if (current.config.mode === 'rated' && current.status === 'finished') {
        const last = (match: MatchRecord) => match.actions.at(match.cursor - 1)?.id;
        if (next.record.status !== 'finished' || last(current) !== last(next.record)) throw new SessionError('stale');
        const existing = await ledger.get(id);
        await tx.done;
        return existing;
      }
      if (current.revision !== revision || current.config.mode !== config.mode) throw new SessionError('stale');
      if (config.mode !== 'rated') {
        await matches.put(next.record);
        await tx.done;
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
      await tx.done;
      return entry;
    } catch (error) {
      try { tx.abort(); } catch { /* Already closed. */ }
      await done;
      throw error;
    }
  }

  async closeRated(session: GameSession, technical = false): Promise<void> {
    const { id, revision, config } = session.record;
    if (config.mode !== 'rated') throw new SessionError('ratedLocked');
    const tx = this.db.transaction(['matches', 'profiles'], 'readwrite');
    const done = tx.done.catch(() => undefined);
    try {
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
      await tx.done;
    } catch (error) {
      try { tx.abort(); } catch { /* Already closed. */ }
      await done;
      throw error;
    }
  }
}
