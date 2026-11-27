import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicNews, TerritoryHistoryEntry, TerritoryView } from '@iva-games/district/territorial';

export interface DistrictSoundSettings {
  enabled: boolean;
  master: number;
  effects: number;
  news: number;
}

export const DEFAULT_DISTRICT_SOUND: DistrictSoundSettings = {
  enabled: false, master: .7, effects: .8, news: .65,
};

type Stage = PublicNews['stage'];
type Channel = 'effects' | 'news';
export type DistrictActionCue = 'house' | 'road' | 'upgrade' | 'roll' | 'production' | 'trade' | 'card' | 'blockade' | 'win' | 'turn' | 'offer';
export interface DistrictAudioCue { key: string; cue: string; channel: Channel }

/** Only published stages are mapped. Audio never reads or guesses future outcomes. */
export const DISTRICT_NEWS_AUDIO: Readonly<Record<string, readonly Stage[]>> = {
  G01: ['applied'], G02: ['applied'], G03: ['applied'], G04: ['applied'], G05: ['applied'],
  G06: ['applied'], G07: ['applied'], G08: ['applied'], G09: ['applied'], G10: ['applied'],
  B01: ['applied'], B02: ['applied'], B03: ['applied'], B04: ['applied'], B05: ['applied'],
  B06: ['applied'], B07: ['applied'], B08: ['applied'],
  H01: ['forecast', 'confirmed', 'applied', 'cancelled'],
  H02: ['forecast', 'confirmed', 'applied', 'cancelled'],
  H03: ['forecast', 'confirmed', 'applied', 'cancelled'],
  H04: ['forecast', 'confirmed', 'applied', 'cancelled'],
  P01: ['applied', 'success', 'cancelled'], P02: ['applied', 'success', 'cancelled'],
  E01: ['applied', 'forecast', 'update', 'success', 'cancelled'],
};

export function districtNewsCue(item: Pick<PublicNews, 'templateId' | 'stage'>): string | null {
  return DISTRICT_NEWS_AUDIO[item.templateId]?.includes(item.stage) ? `${item.templateId}-${item.stage}` : null;
}

export function districtHistoryCue(entry: TerritoryHistoryEntry, ownId: string): DistrictActionCue | null {
  switch (entry.kind) {
    case 'place': case 'settle': return 'house';
    case 'route': return 'road';
    case 'upgrade': return 'upgrade';
    case 'roll': return 'roll';
    case 'distribution': return entry.production?.some(row => Object.values(row.resources).some(n => n > 0)) ? 'production' : null;
    case 'bank': return 'trade';
    case 'accept': return entry.reason === 'consent' ? null : 'trade';
    case 'buy-card': case 'play-card': return 'card';
    case 'block': return 'blockade';
    case 'win': return entry.reason === 'points' ? 'win' : null;
    case 'offer': return entry.targetId === ownId ? 'offer' : null;
    default: return null;
  }
}

type AudioSnapshot = Pick<TerritoryView, 'matchId' | 'revision' | 'serverNow' | 'history' | 'news' | 'activeParticipantId' | 'phase' | 'turn' | 'outcome'> & {
  you: Pick<TerritoryView['you'], 'participantId'>;
};
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const storageKey = (view: AudioSnapshot) => `iva.district.audio.seen.v1:${view.matchId}:${view.you.participantId}`;

/**
 * Monotone event cursor, independent of selection, journal visibility and render count.
 * First snapshot is a silent baseline, including after reconnect or tab visibility change.
 * A poll can contain several revisions; fresh committed actions are still acknowledged.
 */
export class DistrictAudioCursor {
  private previous: { identity: string; revision: number; serverNow: number; time: number; active: string; phase: string; turn: number } | null = null;
  private seen = new Set<string>();
  constructor(private readonly storage?: StorageLike) {}

  reconnect() { this.previous = null; }

  observe(view: AudioSnapshot, now: number, live = true): DistrictAudioCue[] {
    const identity = storageKey(view), before = this.previous;
    if (before?.identity === identity && (view.revision < before.revision || view.serverNow < before.serverNow)) return [];
    if (!before || before.identity !== identity) {
      this.seen.clear();
      try {
        const value: unknown = JSON.parse(this.storage?.getItem(identity) ?? '[]');
        if (Array.isArray(value)) this.seen = new Set(value.filter((id): id is string => typeof id === 'string').slice(-1600));
      } catch { /* A disabled/full storage must never prevent a game. */ }
    }
    const same = before?.identity === identity;
    const continuous = live && same && now - before.time <= 8_000 && now >= before.time;
    const fresh: DistrictAudioCue[] = [];
    for (const event of view.history ?? []) {
      const key = 'table:' + event.id;
      if (!this.seen.has(key) && continuous && event.revision > before.revision) {
        const cue = districtHistoryCue(event, view.you.participantId);
        if (cue) fresh.push({ key, cue, channel: 'effects' });
      }
      this.seen.add(key);
    }
    const news: DistrictAudioCue[] = [];
    for (const item of view.news) {
      const key = 'news:' + item.messageId;
      if (!this.seen.has(key) && continuous && view.revision > before.revision) {
        const cue = districtNewsCue(item);
        if (cue) news.push({ key, cue, channel: 'news' });
      }
      this.seen.add(key);
    }
    if (continuous && !view.outcome && view.activeParticipantId === view.you.participantId &&
      (view.phase === 'roll' || view.phase === 'setup-home') &&
      (before.active !== view.activeParticipantId || before.turn !== view.turn || before.phase !== view.phase)) {
      const key = `turn:${view.matchId}:${view.revision}`;
      if (!this.seen.has(key)) fresh.push({ key, cue: 'turn', channel: 'effects' });
      this.seen.add(key);
    }
    this.previous = { identity, revision: view.revision, serverNow: view.serverNow, time: now,
      active: view.activeParticipantId, phase: view.phase, turn: view.turn };
    // Cursors are bounded per tab. Remounts still baseline all existing events silently.
    if (this.seen.size > 1800) this.seen = new Set([...this.seen].slice(-1600));
    try { this.storage?.setItem(identity, JSON.stringify([...this.seen])); } catch { /* Session-only fallback. */ }
    // Do not play a long queue of stale actions. Hazard/outbreak cues precede good-news flourishes.
    news.sort((a,b) => Number(/^[HE]/u.test(b.cue)) - Number(/^[HE]/u.test(a.cue)));
    return [...fresh.slice(-4), ...news.slice(0, 3)];
  }
}

const clamp = (value: number) => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
export const districtAudioUrl = (cue: string) => `/assets/district/audio/${cue}.wav`;

/** At most one effect and one news clip can play together; no looping or catch-up. */
class DistrictAudioPlayer {
  private context: AudioContext | null = null;
  private gains: Record<Channel, GainNode> | null = null;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private active = new Set<AudioBufferSourceNode>();
  private tails: Record<Channel, Promise<void>> = { effects: Promise.resolve(), news: Promise.resolve() };
  private queued = { effects: 0, news: 0 };
  private generation = 0;
  private destroyed = false;

  constructor(private settings: DistrictSoundSettings) {}

  setSettings(settings: DistrictSoundSettings) {
    this.settings = settings;
    if (!settings.enabled) this.stop();
    if (this.context && this.gains) {
      for (const channel of ['effects','news'] as const) {
        const volume = settings.enabled ? clamp(settings.master) * clamp(settings[channel]) : 0;
        this.gains[channel].gain.setTargetAtTime(volume, this.context.currentTime, .025);
      }
    }
  }

  async unlock(): Promise<boolean> {
    if (this.destroyed || !this.settings.enabled) return false;
    const Audio = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Audio) return false;
    try {
      if (!this.context) {
        this.context = new Audio();
        this.gains = { effects: this.context.createGain(), news: this.context.createGain() };
        for (const gain of Object.values(this.gains)) gain.connect(this.context.destination);
        this.setSettings(this.settings);
      }
      await this.context.resume();
      return !this.destroyed && this.context.state === 'running';
    } catch { return false; }
  }

  play(item: DistrictAudioCue): Promise<void> {
    const context = this.context, channel = item.channel;
    if (this.destroyed || !this.settings.enabled || !context || context.state !== 'running' ||
      clamp(this.settings.master) * clamp(this.settings[channel]) === 0 || this.queued[channel] >= (channel === 'news' ? 3 : 4)) return Promise.resolve();
    const generation = this.generation, requested = Date.now();
    this.queued[channel]++;
    const promise = this.tails[channel].then(async () => {
      if (generation !== this.generation || this.destroyed || Date.now() - requested > 4_000) return;
      try {
        let buffer = this.buffers.get(item.cue);
        if (!buffer) {
          buffer = fetch(districtAudioUrl(item.cue), { credentials: 'same-origin' }).then(response => {
            if (!response.ok) throw new Error('Audio unavailable');
            return response.arrayBuffer();
          }).then(data => context.decodeAudioData(data));
          this.buffers.set(item.cue, buffer);
        }
        const decoded = await buffer;
        if (generation !== this.generation || this.destroyed || !this.settings.enabled || document.hidden ||
          context.state !== 'running' || Date.now() - requested > 4_000) return;
        await new Promise<void>(resolve => {
          const source = context.createBufferSource();
          source.buffer = decoded;
          source.connect(this.gains![channel]);
          this.active.add(source);
          source.onended = () => { this.active.delete(source); source.disconnect(); resolve(); };
          source.start();
        });
      } catch {
        this.buffers.delete(item.cue); // A later fresh event may retry a failed download.
      }
    }).finally(() => {
      if (generation === this.generation) this.queued[channel]--;
    });
    this.tails[channel] = promise;
    return promise;
  }

  stop() {
    this.generation++;
    for (const source of this.active) { try { source.stop(); } catch { /* Already stopped. */ } }
    this.active.clear();
    this.queued = { effects: 0, news: 0 };
    this.tails = { effects: Promise.resolve(), news: Promise.resolve() };
  }

  close() {
    this.destroyed = true;
    this.stop();
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
  }
}

function tabStorage(): StorageLike | undefined {
  try { return window.sessionStorage; } catch { return undefined; }
}

export function useTerritorialAudio(view: TerritoryView | null, settings: DistrictSoundSettings) {
  const cursor = useRef<DistrictAudioCursor | null>(null);
  const player = useRef<DistrictAudioPlayer | null>(null);
  const settingsRef = useRef(settings);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    settingsRef.current = settings;
    player.current?.setSettings(settings);
    if (!settings.enabled) setReady(false);
  }, [settings]);

  const unlock = useCallback(async () => {
    player.current ??= new DistrictAudioPlayer(settingsRef.current);
    const result = await player.current.unlock();
    setReady(result);
  }, []);

  useEffect(() => {
    const interrupt = () => { cursor.current?.reconnect(); player.current?.stop(); };
    const gesture = () => { if (settingsRef.current.enabled) void unlock(); };
    window.addEventListener('online', interrupt);
    window.addEventListener('offline', interrupt);
    document.addEventListener('visibilitychange', interrupt);
    window.addEventListener('pointerdown', gesture);
    window.addEventListener('keydown', gesture);
    return () => {
      window.removeEventListener('online', interrupt);
      window.removeEventListener('offline', interrupt);
      document.removeEventListener('visibilitychange', interrupt);
      window.removeEventListener('pointerdown', gesture);
      window.removeEventListener('keydown', gesture);
      cursor.current?.reconnect();
      player.current?.close();
      player.current = null;
    };
  }, [unlock]);

  useEffect(() => {
    if (!view) return;
    cursor.current ??= new DistrictAudioCursor(tabStorage());
    const fresh = cursor.current.observe(view, Date.now(), !document.hidden && navigator.onLine);
    for (const cue of fresh) void player.current?.play(cue);
  }, [view]);

  const preview = useCallback(async (cue: DistrictActionCue = 'house') => {
    await unlock();
    await player.current?.play({ key: 'preview', cue, channel: 'effects' });
  }, [unlock]);

  return { unlock, preview, ready };
}
