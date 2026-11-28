import { useCallback, useEffect, useRef, useState } from 'react';
import { connectSeat, createMatch, viewForSeat, stepMatch, WIRE_VERSION } from '../core/index';
import { advanceWithBots } from '../bots/index';
import type { PilotInput, QueuedCommand, Receipt, Role, ShiftCommandPayload, ShiftSettings, ShiftState, ShiftView, VisibleActor } from '../core/types';
import { advanceLesson, createLesson, lessonCommands, practiceRoster } from './lesson';
import type { Lesson } from './lesson';
import { predictPilot } from './prediction';
export interface LocalGameConfig { settings: ShiftSettings; role: Role; seed: number; lesson?: Role; resume?: boolean; }
export interface ClientSession { view: ShiftView | null; connected: boolean; status: string; receipt: Receipt | null; lesson?: Lesson; predictSelf?: () => VisibleActor | null; setInput: (input: PilotInput) => void; send: (command: ShiftCommandPayload) => void; setPaused: (paused: boolean) => void; selectLessonRoom: (roomId: string, allowed: boolean) => void; }
const STOP: PilotInput = { moveX: 0, moveZ: 0, aim: 0, fireHeld: false };
const SAVE = 'iva-shift.practice.v1';
const lessonSave = (role: Role) => `iva-shift.lesson.v1.${role}`;
function savedSession(key: string): { state: ShiftState; lesson?: Lesson } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    return saved?.state?.rulesVersion === 'shift@1' && saved?.state?.actors?.self ? saved : null;
  } catch { return null; }
}
export function hasPractice(): boolean { const saved = savedSession(SAVE); return !!saved && saved.state.phase !== 'finished'; }
export function hasLesson(role: Role): boolean { const saved = savedSession(lessonSave(role)); return saved?.lesson?.role === role && saved.lesson.step < 5; }
export function useLocalSession(config: LocalGameConfig): ClientSession {
  const ref = useRef<{ state: ShiftState; lesson?: Lesson } | null>(null);
  if (!ref.current) {
    let saved: { state: ShiftState; lesson?: Lesson } | null = null;
    if (config.resume) saved = savedSession(config.lesson ? lessonSave(config.lesson) : SAVE);
    if (config.lesson && saved?.lesson?.role !== config.lesson) saved = null;
    ref.current = saved || (config.lesson ? createLesson(config.lesson) : { state: createMatch(config.settings, practiceRoster(config.role, config.settings.teamSize, config.settings.difficulty), config.seed) });
    connectSeat(ref.current.state, 'self');
  }
  const [view, setView] = useState(() => viewForSeat(ref.current!.state, 'self'));
  const [lesson, setLesson] = useState<Lesson | undefined>(ref.current.lesson ? { ...ref.current.lesson } : undefined);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const input = useRef({ ...STOP });
  const queue = useRef<QueuedCommand[]>([]);
  const paused = useRef(false);
  const setInput = useCallback((value: PilotInput) => { input.current = value; }, []);
  const send = useCallback((command: ShiftCommandPayload) => { queue.current.push({ seatId: 'self', command }); }, []);
  const setPaused = useCallback((value: boolean) => { paused.current = value; input.current = { ...STOP }; }, []);
  const selectLessonRoom = useCallback((roomId: string, allowed: boolean) => {
    const game = ref.current, l = game?.lesson;
    if (!l || !game) return;
    if (roomId === 'O') l.selected = true;
    if (!allowed && l.step === 4 && viewForSeat(game.state, 'self').shiftOptions.find(o => o.roomId === roomId)?.reason === 'NOT_ADJACENT') l.rejected = true;
  }, []);
  useEffect(() => {
    const save = () => { try { localStorage.setItem(config.lesson ? lessonSave(config.lesson) : SAVE, JSON.stringify(ref.current)); } catch { /* Gameplay continues when storage is full. */ } };
    // The menu checks for a checkpoint before this effect's unmount cleanup runs.
    save();
    const timer = window.setInterval(() => {
      if (paused.current || document.hidden) return;
      const game = ref.current!, state = game.state;
      if (game.lesson && game.lesson.step >= 5) return;
      const actor = state.actors.self;
      const commands = queue.current.splice(0);
      commands.push({ seatId: 'self', command: { type: 'input', ...input.current, seq: actor.lastAcceptedSeq + 1, roundId: state.round, controllerEpoch: actor.controllerEpoch } });
      const result = game.lesson ? stepMatch(state, [...commands, ...lessonCommands(state, game.lesson)]) : advanceWithBots(state, commands);
      if (game.lesson) { const old = game.lesson.step; advanceLesson(state, game.lesson); if (old !== game.lesson.step) { setLesson({ ...game.lesson }); save(); } }
      const last = result.receipts.filter(r => r.seatId === 'self').at(-1); if (last) setReceipt(last);
      if (state.tick % 2 === 0 || result.checkpoint) setView(viewForSeat(state, 'self'));
      if (result.checkpoint || state.tick % 60 === 0) save();
    }, 1000 / 30);
    window.addEventListener('pagehide', save);
    return () => { window.clearInterval(timer); window.removeEventListener('pagehide', save); save(); };
  }, [config.lesson]);
  return { view, connected: true, status: 'local', receipt, lesson, setInput, send, setPaused, selectLessonRoom };
}
export function useOnlineSession(roomId: string, matchId: string): ClientSession {
  const [view, setView] = useState<ShiftView | null>(null);
  const current = useRef<ShiftView | null>(null);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('connecting');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const input = useRef({ ...STOP });
  const seq = useRef(0);
  const sentInputs = useRef<{ seq: number; input: PilotInput }[]>([]);
  const lastSentAt = useRef(performance.now());
  const pending = useRef(new Map<string, ShiftCommandPayload>());
  const setInput = useCallback((value: PilotInput) => { input.current = value; }, []);
  const setPaused = useCallback(() => { input.current = { ...STOP }; }, []);
  const predictSelf = useCallback(() => {
    const snapshot = current.current;
    if (!snapshot) return null;
    if (socket.current?.readyState !== WebSocket.OPEN) return snapshot.actors.find(a => a.seatId === snapshot.self.seatId) || null;
    return predictPilot(snapshot, sentInputs.current.map(frame => frame.input), input.current, performance.now() - lastSentAt.current);
  }, []);
  const send = useCallback((command: ShiftCommandPayload) => {
    if (command.type === 'input') return;
    pending.current.set(command.actionId, command);
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: 'command', version: WIRE_VERSION, actionId: command.actionId, payload: command }));
  }, []);
  useEffect(() => {
    let live = true, retry: number | undefined, retries = 0;
    const connect = () => {
      if (!live) return;
      const url = new URL(`/api/platform/v1/rooms/${encodeURIComponent(roomId)}/live`, location.href); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('matchId', matchId); url.searchParams.set('version', WIRE_VERSION);
      const ws = new WebSocket(url); socket.current = ws;
      ws.onmessage = event => {
        let message: { type: string; view?: ShiftView; result?: Receipt; code?: string; actionId?: string };
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (message.type === 'snapshot' && message.view?.wireVersion === WIRE_VERSION) {
          const old = current.current; const next = message.view;
          if (!old || old.self.controllerEpoch !== next.self.controllerEpoch || old.round !== next.round) { input.current = { ...STOP }; seq.current = Math.max(0, next.self.lastAcceptedSeq + 1); pending.current.clear(); sentInputs.current = []; lastSentAt.current = performance.now(); }
          sentInputs.current = next.recoveryTicksRemaining ? [] : sentInputs.current.filter(frame => frame.seq > next.self.lastAcceptedSeq);
          current.current = next; setView(next); setConnected(true); setStatus('connected'); retries = 0;
        } else if (message.type === 'receipt' && message.result) { setReceipt(message.result); if (message.actionId) pending.current.delete(message.actionId); }
        else if (message.type === 'error') {
          if (message.code === 'MATCH_FINISHED' && message.actionId) pending.current.delete(message.actionId);
          setStatus(message.code || 'CONNECTION');
        }
      };
      ws.onclose = event => {
        if (!live) return;
        setConnected(false); input.current = { ...STOP }; sentInputs.current = [];
        if (event.code === 4001) { setStatus('STALE_EPOCH'); return; }
        if (event.code === 4003) { setStatus('FORBIDDEN'); return; }
        if (event.code === 4004) { setStatus('MATCH_CHANGED'); return; }
        setStatus('reconnecting'); retry = window.setTimeout(connect, Math.min(4000, 400 * 2 ** retries++));
      };
      ws.onerror = () => { setConnected(false); };
    };
    connect();
    const timer = window.setInterval(() => {
      const v = current.current, ws = socket.current;
      if (!v || v.self.role !== 'pilot' || v.phase !== 'active' || v.recoveryTicksRemaining > 0 || ws?.readyState !== WebSocket.OPEN || ws.bufferedAmount > 32_768) return;
      const sequence = ++seq.current;
      const currentInput = { ...input.current };
      ws.send(JSON.stringify({ type: 'input', version: WIRE_VERSION, payload: { type: 'input', ...currentInput, seq: sequence, roundId: v.round, controllerEpoch: v.self.controllerEpoch } }));
      sentInputs.current.push({ seq: sequence, input: currentInput });
      sentInputs.current = sentInputs.current.slice(-8); lastSentAt.current = performance.now();
    }, 34);
    const retryCommands = window.setInterval(() => { const ws = socket.current; if (ws?.readyState === WebSocket.OPEN) for (const [actionId, payload] of pending.current) ws.send(JSON.stringify({ type: 'command', version: WIRE_VERSION, actionId, payload })); }, 1000);
    const stop = () => { input.current = { ...STOP }; };
    window.addEventListener('blur', stop); document.addEventListener('visibilitychange', stop);
    return () => { live = false; window.clearTimeout(retry); window.clearInterval(timer); window.clearInterval(retryCommands); socket.current?.close(); window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', stop); };
  }, [roomId, matchId]);
  return { view, connected, status, receipt, predictSelf, setInput, send, setPaused, selectLessonRoom: () => {} };
}
