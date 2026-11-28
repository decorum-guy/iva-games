import type { GameEvent, GameState } from '../core/types';

// Shared with the review manifest URL; /assets responses are immutable-cached.
export const SOUND_BANK_VERSION = 3;
export const SOUND_NAMES = [
  'move', 'stone', 'armour', 'wound', 'shield', 'card', 'fire', 'victory', 'defeat',
  'capture', 'armor-break', 'promotion-minor', 'promotion-rook', 'promotion-queen',
  'telegraph', 'heal', 'boss-move',
] as const;
export type SoundName = typeof SOUND_NAMES[number];
export interface SoundCue { name: SoundName; delayMs: number }
export interface SoundContext { before?: GameState; after?: GameState; key?: string }
export type SoundSamples = Readonly<Partial<Record<SoundName, string>>>;

const MAX_VOICES = 4;
const VOLUME = .42;
const buffers = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<AudioBuffer | null>>();
const voices = new Set<{ stop(): void }>();
const timers = new Set<ReturnType<typeof setTimeout>>();
const recentKeys = new Set<string>();
let enabled = false;
let generation = 0;
let context: AudioContext | null = null;
let lifecycleInstalled = false;
const samplePath = (name: SoundName) => '/assets/colossus/audio/' + name + '.wav?v=' + SOUND_BANK_VERSION;

function cancelPlayback() {
  generation++;
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  for (const voice of [...voices]) voice.stop();
  voices.clear();
}
/** Call when leaving a game or replacing a run/lesson, so no stale delayed cue survives. */
export function stopSounds() { cancelPlayback(); recentKeys.clear(); }
export function setSoundEnabled(value: boolean) {
  enabled = value;
  if (!enabled) cancelPlayback();
}
function installLifecycle() {
  if (lifecycleInstalled || typeof document === 'undefined' || typeof window === 'undefined') return;
  lifecycleInstalled = true;
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelPlayback(); });
  window.addEventListener('pagehide', cancelPlayback);
}
function audioContext(): AudioContext | null {
  if (context) return context;
  const Constructor = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) return null;
  try { context = new Constructor(); } catch { return null; }
  return context;
}
async function bufferFor(url: string, ctx: AudioContext): Promise<AudioBuffer | null> {
  const known = buffers.get(url); if (known) return known;
  let work = loading.get(url);
  if (!work) {
    work = (async () => {
      try {
        const response = await fetch(url, { cache: 'force-cache' });
        if (!response.ok) return null;
        const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        buffers.set(url, buffer); return buffer;
      } catch { return null; }
      finally { loading.delete(url); }
    })();
    loading.set(url, work);
  }
  return work;
}
/** Decode just the clips needed for a comparison before any delayed cue starts. */
export async function prepareSounds(names: readonly SoundName[], samples?: SoundSamples): Promise<void> {
  const ctx = audioContext();
  if (ctx) await Promise.all(names.map(name => bufferFor(samples?.[name] ?? samplePath(name), ctx)));
}
/** Invoke in a start/toggle pointer or keyboard gesture. Failure never blocks a move. */
export function unlockSounds(): void {
  if (!enabled) return;
  installLifecycle();
  const ctx = audioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  // Warm the small local bank once; later delayed cues do not need another gesture.
  for (const name of SOUND_NAMES) void bufferFor(samplePath(name), ctx);
}
function admit(voice: { stop(): void }) {
  while (voices.size >= MAX_VOICES) voices.values().next().value?.stop();
  voices.add(voice);
}
function htmlSound(url: string, ticket: number) {
  if (!enabled || ticket !== generation || typeof Audio === 'undefined') return;
  try {
    const sound = new Audio(url);
    sound.volume = VOLUME; sound.preload = 'auto';
    const voice = { stop: () => { sound.pause(); voices.delete(voice); } };
    sound.onended = sound.onerror = () => { voices.delete(voice); };
    admit(voice);
    const work = sound.play();
    if (work) void work.catch(() => { voices.delete(voice); });
  } catch { /* No media support or autoplay access: gameplay remains available. */ }
}
export function playSound(name: SoundName, url = samplePath(name)): void {
  if (!enabled || typeof document !== 'undefined' && document.hidden) return;
  const ticket = generation;
  installLifecycle();
  const ctx = audioContext();
  if (!ctx) { htmlSound(url, ticket); return; }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  void bufferFor(url, ctx).then(buffer => {
    if (!enabled || ticket !== generation) return;
    if (!buffer || ctx.state !== 'running') { htmlSound(url, ticket); return; }
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer; gain.gain.value = VOLUME;
    source.connect(gain); gain.connect(ctx.destination);
    const voice = { stop: () => {
      try { source.stop(); } catch { /* Already ended. */ }
      source.disconnect(); gain.disconnect(); voices.delete(voice);
    } };
    source.onended = () => { source.disconnect(); gain.disconnect(); voices.delete(voice); };
    admit(voice); source.start();
  }).catch(() => { /* Decode/device failures never change the game result. */ });
}

/** Pure semantic cue plan. Promotion/capture/finale are retained alongside their cause. */
export function cuesForEvents(events: readonly GameEvent[], details: SoundContext = {}): SoundCue[] {
  if (!events.length) return [];
  const has = (type: GameEvent['type']) => events.some(event => event.type === type);
  const cues: SoundCue[] = [];
  const add = (name: SoundName, delayMs: number) => { if (!cues.some(cue => cue.name === name)) cues.push({ name, delayMs }); };
  if (has('card') || has('boss-card')) add('card', 0);
  const actionAt = cues.length ? 90 : 0;
  if (has('attack')) add(events.some(event => event.type === 'attack' && (event.armor ?? 0) > 0) ? 'armour' : 'stone', actionAt);
  else if (events.some(event => event.type === 'move' && event.unitId === 'boss')) add('boss-move', actionAt);
  else if (has('move')) add('move', actionAt);
  if (has('fire')) add('fire', actionAt + (has('move') ? 100 : 0));
  if (events.some(event => event.type === 'damage' && (event.amount ?? 0) > 0)) add('wound', actionAt + 70);
  else if (has('shield') || events.some(event => event.type === 'damage' && ((event.absorbed ?? 0) > 0 || event.key === 'invulnerable'))) add('shield', actionAt + 30);
  if (has('heal') || has('camp')) add('heal', actionAt + 40);
  if (has('death')) add('capture', actionAt + 150);
  if (details.before && details.after && details.before.boss.armor > 0 && details.after.boss.armor === 0 && has('attack')) add('armor-break', actionAt + 130);
  const promotions = events.filter(event => event.type === 'promote');
  if (promotions.length) {
    const name = promotions.some(event => event.key === 'Q') ? 'promotion-queen' : promotions.some(event => event.key === 'R') ? 'promotion-rook' : 'promotion-minor';
    add(name, actionAt + (has('move') ? 120 : 0));
  }
  const tail = cues.length ? Math.max(...cues.map(cue => cue.delayMs)) + 220 : 0;
  if (has('victory')) add('victory', tail);
  else if (has('defeat')) add('defeat', tail);
  else if (has('round') && !details.after?.intent.rest) add('telegraph', tail);
  // One aggregate cue per semantic event class, even for eight simultaneous hits.
  return cues;
}
export function soundForEvents(events: readonly GameEvent[], details: SoundContext = {}, samples?: SoundSamples): SoundCue[] {
  const cues = cuesForEvents(events, details);
  if (details.key) {
    if (recentKeys.has(details.key)) return [];
    recentKeys.add(details.key);
    if (recentKeys.size > 128) recentKeys.delete(recentKeys.values().next().value!);
  }
  if (!enabled) return cues;
  for (const cue of cues) {
    if (!cue.delayMs) playSound(cue.name, samples?.[cue.name]);
    else {
      const ticket = generation;
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (ticket === generation) playSound(cue.name, samples?.[cue.name]);
      }, cue.delayMs);
      timers.add(timer);
    }
  }
  return cues;
}
/** Network snapshots are not event streams: initial loads and skipped history stay silent. */
export function soundForTransition(before: GameState | null | undefined, after: GameState, key?: string): SoundCue[] {
  if (!before || after.revision !== before.revision + 1) return [];
  return soundForEvents(after.events, { before, after, key });
}
