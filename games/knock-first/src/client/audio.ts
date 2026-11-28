import type { NoiseType, PlayerView, SoundCue, Vec3 } from '../core/types';
import { floorAt, getLevel } from '../core/level';
import type { SceneSettings, SoundCaption, SoundTestKind } from './sceneTypes';

type Bus = 'ambience' | 'world' | 'threat' | 'ui' | 'music';
interface Voice { source: AudioBufferSourceNode; gain: GainNode; nodes: AudioNode[]; bus: Bus; started: number }

const LABELS: Record<NoiseType, [string, string]> = {
  'quiet-step': ['Тихие шаги', 'Quiet footsteps'], step: ['Шаги', 'Footsteps'], run: ['Бег', 'Running'],
  'water-step': ['Вода под ногами', 'Water underfoot'], click: ['Щелчок', 'Pocket click'], knock: ['Стук', 'Knock'],
  resonator: ['Удар по трубе', 'Pipe strike'], door: ['Дверь', 'Door'], 'door-push': ['Давление на дверь', 'Door under pressure'],
  drag: ['Волочение батареи', 'Battery dragging'], carry: ['Переноска', 'Carrying'], stop: ['Груз качнулся', 'Cargo shifted'],
  drop: ['Батарея на полу', 'Battery dropped'], timer: ['Шумовой таймер', 'Noise timer'],
  'listener-step': ['Тяжёлые шаги', 'Heavy footsteps'], chase: ['Быстрые тяжёлые шаги', 'Heavy running footsteps'],
  call: ['Зов напарника', 'Teammate calling'],
};

const FILES: Record<NoiseType, string[]> = {
  'quiet-step': ['foot-concrete-1', 'foot-concrete-2', 'foot-concrete-3', 'foot-concrete-4'],
  step: ['foot-concrete-1', 'foot-concrete-2', 'foot-concrete-3', 'foot-concrete-4'],
  run: ['foot-concrete-1', 'foot-concrete-2', 'foot-concrete-3', 'foot-concrete-4'],
  'water-step': ['foot-water-1', 'foot-water-2', 'foot-water-3', 'foot-water-4'],
  click: ['click'], knock: ['knock-1', 'knock-2', 'knock-3'], resonator: ['resonator-1', 'resonator-2', 'resonator-3'], door: ['door'], 'door-push': ['door-push'],
  drag: ['drag'], carry: ['carry'], stop: ['stop'], drop: ['drop'], timer: ['timer'],
  'listener-step': ['listener-step-1', 'listener-step-2', 'listener-step-3', 'listener-step-4'], chase: ['chase'], call: ['call'],
};

export function captionForCue(cue: SoundCue, settings: Pick<SceneSettings, 'language'>, now = performance.now()): SoundCaption {
  return {
    id: cue.id, label: LABELS[cue.type][settings.language === 'ru' ? 0 : 1],
    direction: cue.direction === 'ahead' ? 'front' : cue.direction,
    vertical: cue.elevation,
    strength: cue.strength === 'soft' ? 'faint' : cue.strength === 'medium' ? 'clear' : 'loud',
    occluded: cue.occluded || cue.channel, until: now + 2600,
  };
}

/** Audio follows the server's acoustic cues; it never queries the hidden world. */
export class KnockAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private output: GainNode | null = null;
  private buses = new Map<Bus, GainNode>();
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private voices: Voice[] = [];
  private heard = new Set<string>();
  private lastTick = -1;
  private lastEvent = -1;
  private disposed = false;
  private ambience: Voice | null = null;
  private ambienceRoute = '';
  private ambienceAllowed = false;
  private ambienceGeneration = 0;
  private self: Vec3 = { x: 0, y: 0, z: 0 };
  private yaw = 0;
  private cueCounter = 0;
  private levelId: PlayerView['levelId'] = 'archive';

  constructor(private settings: () => SceneSettings, private caption?: (caption: SoundCaption) => void) {}

  async unlock(): Promise<void> {
    if (this.disposed) return;
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -18; compressor.knee.value = 15;
      compressor.ratio.value = 4; compressor.attack.value = 0.004; compressor.release.value = 0.16;
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -5; limiter.knee.value = 1;
      limiter.ratio.value = 16; limiter.attack.value = 0.002; limiter.release.value = 0.08;
      this.output = this.context.createGain();
      this.master.connect(compressor); compressor.connect(limiter); limiter.connect(this.output); this.output.connect(this.context.destination);
      for (const name of ['ambience', 'world', 'threat', 'ui', 'music'] as Bus[]) {
        const gain = this.context.createGain();
        gain.gain.value = name === 'ambience' ? 0.22 : name === 'music' ? 0.15 : name === 'ui' ? 0.55 : 1;
        gain.connect(this.master); this.buses.set(name, gain);
      }
    }
    await this.context.resume();
    this.updateSettings();
  }

  updateSettings(): void {
    if (!this.context || !this.master || !this.output) return;
    const settings = this.settings();
    this.master.gain.setTargetAtTime(settings.muted ? 0 : Math.max(0, Math.min(1, settings.volume)) * (settings.quietAudio ? 0.58 : 0.8), this.context.currentTime, 0.04);
    this.output.channelCount = settings.mono ? 1 : 2;
    this.output.channelCountMode = 'explicit';
  }

  listener(position: Vec3, yaw: number, pitch = 0): void {
    this.self = position; this.yaw = yaw;
    const listener = this.context?.listener;
    if (!listener || !this.context) return;
    const now = this.context.currentTime;
    const forward = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
    if ('positionX' in listener) {
      listener.positionX.setValueAtTime(position.x, now); listener.positionY.setValueAtTime(position.y, now); listener.positionZ.setValueAtTime(position.z, now);
      listener.forwardX.setValueAtTime(forward.x, now); listener.forwardY.setValueAtTime(forward.y, now); listener.forwardZ.setValueAtTime(forward.z, now);
      listener.upX.setValueAtTime(0, now); listener.upY.setValueAtTime(1, now); listener.upZ.setValueAtTime(0, now);
    } else {
      // Older WebKit exposes the vector methods instead of AudioParams.
      const legacy = listener as AudioListener;
      legacy.setPosition(position.x, position.y, position.z);
      legacy.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  update(view: PlayerView): void {
    if (this.disposed) return;
    this.levelId = view.levelId;
    this.updateSettings();
    const first = this.lastTick < 0 || view.tick < this.lastTick;
    if (view.tick < this.lastTick) { this.heard.clear(); this.lastEvent = -1; }
    for (const cue of view.cues) {
      if (this.heard.has(cue.id)) continue;
      this.heard.add(cue.id);
      // A freshly opened/reconnected view may contain retained events. Never replay them.
      if ((first && view.time - cue.at > 0.25) || view.time - cue.at > 1.5) continue;
      if (this.settings().captions) this.caption?.(captionForCue(cue, this.settings()));
      void this.playCue(cue);
    }
    if (this.heard.size > 512) this.heard = new Set([...this.heard].slice(-256));
    for (const event of view.events) {
      if (event.tick <= this.lastEvent || first || view.time - event.at > 1) continue;
      const name = event.type === 'batteryInstalled' ? (view.sockets.filter(Boolean).length === 2 ? 'ui-battery-2' : 'ui-battery') : event.type === 'revived' ? 'ui-revive' : event.type === 'downed' ? 'ui-down' : event.type === 'reserveWarning' ? 'ui-warning' : event.type === 'finished' ? 'ui-lift' : event.type === 'missionStarted' ? 'ui-start' : null;
      if (name) void this.play(name, 'ui', 0.32);
    }
    this.lastEvent = Math.max(this.lastEvent, ...view.events.map(e => e.tick));
    this.lastTick = view.tick;
    this.ambienceAllowed = view.phase !== 'finished';
    if (this.ambienceAllowed && this.context?.state === 'running' && this.ambienceRoute !== view.levelId) void this.startAmbience(view.levelId);
    if (!this.ambienceAllowed) {
      if (this.ambienceRoute) this.ambienceGeneration++;
      this.ambienceRoute = '';
      if (this.ambience) this.fade(this.ambience);
      this.ambience = null;
    }
  }

  async test(kind: SoundTestKind): Promise<void> {
    await this.unlock();
    const right = { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
    const front = { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
    const position = kind === 'left'
      ? { x: this.self.x - right.x * 2, y: this.self.y, z: this.self.z - right.z * 2 }
      : { x: this.self.x + front.x * 3, y: this.self.y, z: this.self.z + front.z * 3 };
    const cue: SoundCue = {
      id: `hearing-${++this.cueCounter}`, tick: 0, at: 0,
      type: kind === 'left' ? 'step' : kind === 'door' ? 'door' : 'resonator',
      position, strength: kind === 'neighbour' ? 'loud' : kind === 'door' ? 'soft' : 'medium', residual: kind === 'neighbour' ? 44 : kind === 'door' ? 12 : 28,
      occluded: kind !== 'left', channel: false, direction: kind === 'left' ? 'left' : 'ahead', elevation: 'level',
    };
    if (this.settings().captions) this.caption?.(captionForCue(cue, this.settings()));
    await this.playCue(cue);
  }

  private async playCue(cue: SoundCue): Promise<void> {
    if (!this.context || this.context.state !== 'running') return;
    const isStep = cue.type === 'step' || cue.type === 'quiet-step' || cue.type === 'run';
    const metal = isStep && !cue.occluded && !cue.channel && floorAt(getLevel(this.levelId), cue.position.x, cue.position.z)?.material === 'metal';
    const choices = metal ? ['foot-metal-1', 'foot-metal-2', 'foot-metal-3', 'foot-metal-4'] : FILES[cue.type];
    const hash = [...cue.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const bus: Bus = cue.type === 'listener-step' || cue.type === 'chase' ? 'threat' : 'world';
    const level = Math.min(0.65, Math.max(0.07, (cue.residual - 4) / 90)) * (cue.type === 'quiet-step' ? 0.55 : 1);
    await this.play(choices[hash % choices.length], bus, level, cue);
  }

  private buffer(name: string): Promise<AudioBuffer | null> {
    if (!this.context) return Promise.resolve(null);
    const cached = this.buffers.get(name); if (cached) return cached;
    const context = this.context;
    const request = fetch(`/knock-first/audio/${name}.wav`).then(response => {
      if (!response.ok) throw new Error('Sound unavailable');
      return response.arrayBuffer();
    }).then(bytes => context.decodeAudioData(bytes)).catch(() => { this.buffers.delete(name); return null; });
    this.buffers.set(name, request); return request;
  }

  private async play(name: string, bus: Bus, level: number, cue?: SoundCue, loop = false, permitted?: () => boolean): Promise<Voice | null> {
    const context = this.context; if (!context || this.disposed || context.state !== 'running') return null;
    const buffer = await this.buffer(name); if (!buffer || this.disposed || context.state !== 'running' || permitted?.() === false) return null;
    if (this.voices.length >= 18) {
      const oldest = this.voices.find(voice => voice.bus === 'world') ?? this.voices.find(voice => voice.bus !== 'ambience');
      if (oldest) this.fade(oldest);
    }
    const source = context.createBufferSource(); source.buffer = buffer; source.loop = loop;
    const gain = context.createGain(); gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(level, context.currentTime + 0.012);
    const nodes: AudioNode[] = [];
    if (cue) {
      const filter = context.createBiquadFilter(); filter.type = cue.channel ? 'bandpass' : 'lowpass';
      filter.frequency.value = cue.channel ? 950 : cue.occluded ? 680 : 12500; filter.Q.value = cue.channel ? 0.65 : 0.5;
      const panner = context.createPanner(); panner.panningModel = 'HRTF'; panner.distanceModel = 'linear';
      panner.refDistance = 1; panner.maxDistance = 1000; panner.rolloffFactor = 0;
      panner.positionX.value = cue.position.x; panner.positionY.value = cue.position.y; panner.positionZ.value = cue.position.z;
      source.connect(filter); filter.connect(panner); panner.connect(gain); nodes.push(filter, panner);
    } else source.connect(gain);
    gain.connect(this.buses.get(bus) ?? this.master!);
    const voice: Voice = { source, gain, nodes, bus, started: context.currentTime };
    this.voices.push(voice);
    source.onended = () => {
      this.voices = this.voices.filter(v => v !== voice);
      source.disconnect(); gain.disconnect(); for (const node of nodes) node.disconnect();
    };
    source.start(); return voice;
  }

  private async startAmbience(route: string): Promise<void> {
    const generation = ++this.ambienceGeneration;
    this.ambienceRoute = route;
    if (this.ambience) this.fade(this.ambience);
    this.ambience = null;
    const voice = await this.play(`ambience-${route === 'tutorial' ? 'archive' : route}`, 'ambience', 0.22, undefined, true, () => this.ambienceAllowed && this.ambienceRoute === route && generation === this.ambienceGeneration);
    if (!voice) return;
    if (this.disposed || this.ambienceRoute !== route || !this.ambienceAllowed || generation !== this.ambienceGeneration) { this.fade(voice); return; }
    this.ambience = voice;
  }

  private fade(voice: Voice): void {
    if (!this.context) return;
    voice.gain.gain.cancelScheduledValues(this.context.currentTime);
    voice.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.025);
    try { voice.source.stop(this.context.currentTime + 0.12); } catch { /* Already ended. */ }
  }

  dispose(): void {
    this.disposed = true;
    for (const voice of this.voices) this.fade(voice);
    this.voices = [];
    if (this.context) void this.context.close();
    this.context = null; this.buffers.clear(); this.heard.clear();
  }
}
