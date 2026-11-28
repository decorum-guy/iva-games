import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerView, SoundCue } from '../src/core/types';
import { KnockAudio } from '../src/client/audio';
import { DEFAULT_SCENE_SETTINGS } from '../src/client/sceneTypes';

// Web Audio graph doubles: assertions cover lifecycle/caption parity, not audible quality.
class Param {
  value = 0;
  setValueAtTime = vi.fn((value: number) => { this.value = value; });
  setTargetAtTime = vi.fn((value: number) => { this.value = value; });
  linearRampToValueAtTime = vi.fn((value: number) => { this.value = value; });
  cancelScheduledValues = vi.fn();
}
class Node {
  gain = new Param(); threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
  frequency = new Param(); Q = new Param(); positionX = new Param(); positionY = new Param(); positionZ = new Param();
  channelCount = 2; channelCountMode = 'max';
  connect = vi.fn(); disconnect = vi.fn();
}
class Source extends Node {
  loop = false; buffer: unknown = null; onended: (() => void) | null = null;
  start = vi.fn(); stop = vi.fn(() => this.onended?.());
}
class Context {
  static latest: Context;
  state = 'running'; currentTime = 0; destination = new Node();
  sources: Source[] = []; gains: Node[] = [];
  constructor() { Context.latest = this; }
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  decodeAudioData = vi.fn(async () => ({}));
  createGain = () => { const node = new Node(); this.gains.push(node); return node; };
  createDynamicsCompressor = () => new Node();
  createBiquadFilter = () => new Node();
  createPanner = () => new Node();
  createBufferSource = () => { const node = new Source(); this.sources.push(node); return node; };
}
const view = (tick: number, phase: 'active' | 'finished', cues: SoundCue[] = []): PlayerView => ({ tick, time: tick / 30, phase, cues, events: [], levelId: 'archive', sockets: [null, null] } as unknown as PlayerView);
const cue: SoundCue = { id: 'server-cue-1', tick: 30, at: 1, type: 'knock', position: { x: 1, y: 1.4, z: -3 }, strength: 'soft', residual: 12, occluded: true, channel: false, direction: 'ahead', elevation: 'level' };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

describe('audio event lifetime (mocked Web Audio)', () => {
  let audio: KnockAudio;
  beforeEach(() => {
    vi.stubGlobal('AudioContext', Context);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })));
  });
  afterEach(() => { audio?.dispose(); vi.unstubAllGlobals(); });

  it('does not start an ambience loop if its load finishes after the result', async () => {
    let complete: ((response: unknown) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { complete = resolve; })));
    audio = new KnockAudio(() => DEFAULT_SCENE_SETTINGS);
    await audio.unlock(); audio.update(view(1, 'active'));
    audio.update(view(2, 'finished'));
    complete?.({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }); await flush();
    expect(Context.latest.sources).toHaveLength(0);
  });

  it('repeated snapshots do not replay cues; mute retains the same server caption', async () => {
    const caption = vi.fn();
    audio = new KnockAudio(() => ({ ...DEFAULT_SCENE_SETTINGS, muted: true }), caption);
    await audio.unlock();
    audio.update(view(30, 'finished', [cue])); await flush();
    audio.update(view(31, 'finished', [cue])); await flush();
    expect(Context.latest.sources).toHaveLength(1);
    expect(Context.latest.gains[0].gain.value).toBe(0);
    expect(caption).toHaveBeenCalledTimes(1);
    expect(caption.mock.calls[0][0]).toMatchObject({ direction: 'front', strength: 'faint', occluded: true });
  });

  it('reconnection skips retained old cues instead of replaying threats', async () => {
    const caption = vi.fn(); audio = new KnockAudio(() => DEFAULT_SCENE_SETTINGS, caption);
    await audio.unlock(); audio.update(view(90, 'finished', [cue])); await flush();
    expect(Context.latest.sources).toHaveLength(0); expect(caption).not.toHaveBeenCalled();
  });

  it('finishing and restarting during one pending decode creates only the current loop', async () => {
    let complete: ((response: unknown) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { complete = resolve; })));
    audio = new KnockAudio(() => DEFAULT_SCENE_SETTINGS); await audio.unlock();
    audio.update(view(1, 'active')); audio.update(view(2, 'finished')); audio.update(view(0, 'active'));
    complete?.({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }); await flush();
    expect(Context.latest.sources).toHaveLength(1);
    expect(Context.latest.sources[0].loop).toBe(true);
  });
});
