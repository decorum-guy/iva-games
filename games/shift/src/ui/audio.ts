import { useEffect, useRef, useState } from 'react';
import { worldPosition } from '../core/geometry';
import type { ShiftView } from '../core/types';
import type { Preferences } from './preferences';
let context: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();
export function unlockAudio() {
  if (typeof AudioContext === 'undefined') return;
  try {
    context ??= new AudioContext();
    if (context.state !== 'running') void context.resume().then(() => window.dispatchEvent(new Event('shift-audio-ready'))).catch(() => {});
    else window.dispatchEvent(new Event('shift-audio-ready'));
  } catch { /* Audio availability does not stop a match. */ }
}
async function buffer(name: string): Promise<AudioBuffer> {
  if (!context) throw new Error('Audio awaits a user gesture');
  if (!buffers.has(name)) buffers.set(name, fetch(`/shift-assets/audio/${name}.wav`).then(r => { if (!r.ok) throw new Error('Audio unavailable'); return r.arrayBuffer(); }).then(data => context!.decodeAudioData(data)).catch(error => { buffers.delete(name); throw error; }));
  return buffers.get(name)!;
}
const sounds: Record<string, string> = { 'shift-start': 'shift-start', 'shift-end': 'shift-stop', shot: 'pulse', hit: 'hit', pickup: 'pickup', drop: 'drop', return: 'return', delivered: 'delivered', respawn: 'respawn', ping: 'ping', 'round-start': 'ready' };
function useLoop(name: string | null, gainValue: number, ready: boolean, playbackRate = 1) {
  useEffect(() => {
    if (!context || !ready || !name || !gainValue) return;
    let active = true, source: AudioBufferSourceNode | null = null;
    const gain = context.createGain(); gain.gain.value = gainValue; gain.connect(context.destination);
    void buffer(name).then(data => { if (!active || !context) return; source = context.createBufferSource(); source.buffer = data; source.loop = true; source.playbackRate.value = playbackRate; source.connect(gain); source.start(); }).catch(() => {});
    return () => { active = false; source?.stop(); gain.disconnect(); };
  }, [name, gainValue, ready, playbackRate]);
}
export function useShiftAudio(view: ShiftView | null, preferences: Preferences) {
  const last = useRef(new Set<string>()), initialized = useRef(false);
  const [ready, setReady] = useState(context?.state === 'running');
  useEffect(() => {
    const enabled = () => setReady(context?.state === 'running');
    window.addEventListener('shift-audio-ready', enabled);
    return () => window.removeEventListener('shift-audio-ready', enabled);
  }, []);
  useEffect(() => {
    if (!view) return;
    if (!initialized.current) { for (const e of view.events) last.current.add(e.id); initialized.current = true; }
    for (const event of view.events) {
      if (last.current.has(event.id)) continue;
      last.current.add(event.id);
      if (!context || !ready || !preferences.volume || view.tick - event.tick > 20) continue;
      const name = sounds[event.kind]; if (!name) continue;
      // Only the recipient's permitted event feed supplies audio positions.
      const self = view.actors.find(actor => actor.seatId === view.self.seatId);
      const origin = self ? worldPosition(view.board, self, view.motion, view.tick) : null;
      const position = event.shot?.from || (event.pose ? worldPosition(view.board, event.pose, view.motion, view.tick) : null);
      const pan = origin && position ? Math.max(-.6, Math.min(.6, (position.x - origin.x) / 12)) : 0;
      void buffer(name).then(data => {
        if (!context) return;
        const source = context.createBufferSource(), gain = context.createGain(), panner = context.createStereoPanner();
        source.buffer = data; source.playbackRate.value = view.self.role === 'navigator' && event.kind !== 'shot' ? 1.07 : 1;
        gain.gain.value = preferences.volume * (event.kind === 'shot' ? .25 : .78); panner.pan.value = pan;
        source.connect(gain); gain.connect(panner); panner.connect(context.destination); source.start();
        source.onended = () => { source.disconnect(); gain.disconnect(); panner.disconnect(); };
        if (event.kind === 'shift-start' || event.kind === 'shift-end') void buffer('door').then(door => {
          if (!context) return;
          const s = context.createBufferSource(), g = context.createGain(); s.buffer = door; g.gain.value = preferences.volume * .9;
          s.connect(g); g.connect(context.destination); s.start(); s.onended = () => { s.disconnect(); g.disconnect(); };
        }).catch(() => {});
      }).catch(() => {});
    }
    if (last.current.size > 3000) last.current = new Set(view.events.map(e => e.id));
  }, [view, preferences.volume, ready]);
  const active = view?.phase === 'active' && !view.recoveryTicksRemaining;
  const charging = active && view.actors.some(actor => actor.team === view.self.team && actor.chargeTicks > 0);
  useLoop(view?.settings.arena && view.phase !== 'finished' ? `${view.settings.arena}-loop` : null, preferences.ambience * .3, ready);
  useLoop(active && view.motion ? 'shift-move' : null, preferences.volume * .42, ready, view?.self.role === 'navigator' ? 1.07 : 1);
  useLoop(charging ? 'charge' : null, preferences.volume * .82, ready);
}
