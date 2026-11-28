import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';
import type { CommandPayload, Locale, PlayerView } from '../core/types';
import { getLevel } from '../core/level';
import { KnockScene } from './KnockScene';
import { KnockAudio } from './audio';
import { KnockConnection } from './network';
import type { ConnectionState } from './network';
import { DEFAULT_SCENE_SETTINGS } from './sceneTypes';
import type { KnockControlInput, SceneAction, SceneContextStatus, SceneHandle, SceneSettings, SceneStats, SoundCaption, SoundTestKind } from './sceneTypes';
import { CARRY_FEEDBACK, copy, formatMissionTime, KNOCK_ACTION_COPY, label, noticeText, PROMPTS, TUTORIAL_COPY } from './copy';
import { KnockLobby, RoutePlan } from './Lobby';
import type { KnockFriend, KnockRoom, PortalRequest } from './Lobby';
import './knock-first.css';

interface Preferences extends SceneSettings { hudScale: number; crosshair: number; touch: boolean }
const STORE = 'iva.knock-first.preferences.v1';
function readPreferences(language: Locale): Preferences {
  const defaults: Preferences = { ...DEFAULT_SCENE_SETTINGS, language, hudScale: 100, crosshair: 1, touch: typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches };
  try {
    const stored = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, unknown>;
    for (const key of ['pointerLock', 'reducedMotion', 'softEcho', 'contrast', 'muted', 'mono', 'quietAudio', 'captions', 'touch'] as const) if (typeof stored[key] === 'boolean') defaults[key] = stored[key];
    for (const [key, low, high] of [['sensitivity', 0.2, 3], ['fov', 52, 74], ['volume', 0, 1], ['hudScale', 80, 130], ['crosshair', 0.7, 2]] as const) if (typeof stored[key] === 'number' && Number.isFinite(stored[key])) defaults[key] = Math.max(low, Math.min(high, stored[key]));
    if (stored.quality === 'high' || stored.quality === 'low') defaults.quality = stored.quality;
    if (stored.language === 'ru' || stored.language === 'en') defaults.language = stored.language;
  } catch { /* Settings are optional; a damaged local preference never prevents a mission. */ }
  return defaults;
}
const timeLabel = formatMissionTime;

function Dialog({ title, onClose, children, language }: { title: string; onClose: () => void; children: ReactNode; language: Locale }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = dialog.current; root?.querySelector<HTMLElement>('button,input,select')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key !== 'Tab' || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]),select:not([disabled]),[tabindex="0"]')].filter(el => el.getClientRects().length);
      if (!items.length) return;
      if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items.at(-1)?.focus(); }
      else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0].focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [onClose]);
  return <div className="kf-modal-shade"><div className="kf-dialog" ref={dialog} role="dialog" aria-modal="true" aria-label={title}><div className="kf-section-title"><h2>{title}</h2><button className="kf-close" aria-label={copy(language, 'Закрыть', 'Close')} onClick={onClose}>×</button></div>{children}</div></div>;
}

function HearingPanel({ settings, setSettings, language, audio }: { settings: Preferences; setSettings: (p: Preferences) => void; language: Locale; audio: KnockAudio }) {
  const [last, setLast] = useState('');
  const t = (ru: string, en: string) => copy(language, ru, en);
  const test = async (kind: SoundTestKind) => {
    await audio.unlock(); await audio.test(kind);
    setLast(kind === 'left' ? t('← Шаги слева · близко', '← Footsteps left · near') : kind === 'door' ? t('↑ За дверью · приглушённо', '↑ Behind a door · muffled') : t('↑ Стук в соседней комнате · громко', '↑ Knock next door · loud'));
  };
  return <div className="kf-hearing"><p>{t('Откуда звук? Проверьте три сигнала. Направленные подписи передают те же сведения при выключенном звуке.', 'Where is the sound? Try three signals. Directional captions give the same information with sound muted.')}</p><div className="kf-hearing-tests">
    <button className="kf-button" onClick={() => void test('left')}>← {t('Шаги слева', 'Steps on the left')}</button><button className="kf-button" onClick={() => void test('door')}>↑ {t('За дверью', 'Behind a door')}</button><button className="kf-button" onClick={() => void test('neighbour')}>↑ {t('Соседняя комната', 'Next room')}</button>
  </div><div className="kf-caption-preview" role="status">{last || t('Нажмите на сигнал', 'Choose a signal')}</div>
    <label className="kf-check"><input type="checkbox" checked={settings.muted} onChange={e => setSettings({ ...settings, muted: e.target.checked })} />{t('Без звука', 'Mute')}</label>
    <label className="kf-check"><input type="checkbox" checked={settings.mono} onChange={e => setSettings({ ...settings, mono: e.target.checked })} />{t('Моно вместо стерео', 'Mono instead of stereo')}</label>
    <label className="kf-check"><input type="checkbox" checked={settings.captions} onChange={e => setSettings({ ...settings, captions: e.target.checked })} />{t('Направленные подписи', 'Directional captions')}</label>
    <label className="kf-check"><input type="checkbox" checked={settings.quietAudio} onChange={e => setSettings({ ...settings, quietAudio: e.target.checked })} />{t('Тихий режим · мягче резкие звуки', 'Quiet mode · softer sudden sounds')}</label>
  </div>;
}

function PreferencesPanel({ settings, update, language, audio }: { settings: Preferences; update: (p: Preferences) => void; language: Locale; audio: KnockAudio }) {
  const t = (ru: string, en: string) => copy(language, ru, en);
  return <div className="kf-preferences"><fieldset><legend>{t('Вид и управление', 'View and controls')}</legend>
    <label>{t('Чувствительность', 'Sensitivity')}<output>{settings.sensitivity.toFixed(1)}</output><input type="range" min="0.2" max="3" step="0.1" value={settings.sensitivity} onChange={e => update({ ...settings, sensitivity: Number(e.target.value) })} /></label>
    <label>{t('Поле зрения', 'Field of view')}<output>{settings.fov}°</output><input type="range" min="52" max="74" value={settings.fov} onChange={e => update({ ...settings, fov: Number(e.target.value) })} /></label>
    <label>{t('Размер интерфейса', 'HUD scale')}<output>{settings.hudScale}%</output><input type="range" min="80" max="130" value={settings.hudScale} onChange={e => update({ ...settings, hudScale: Number(e.target.value) })} /></label>
    <label>{t('Размер прицела', 'Reticle size')}<input type="range" min="0.7" max="2" step="0.1" value={settings.crosshair} onChange={e => update({ ...settings, crosshair: Number(e.target.value) })} /></label>
    <label>{t('Качество', 'Quality')}<select value={settings.quality} onChange={e => update({ ...settings, quality: e.target.value as Preferences['quality'] })}><option value="high">{t('Высокое', 'High')}</option><option value="low">{t('Экономное', 'Low')}</option></select></label>
    <label className="kf-check"><input type="checkbox" checked={settings.pointerLock} onChange={e => update({ ...settings, pointerLock: e.target.checked })} />{t('Захватывать мышь', 'Lock the mouse')}</label>
    <label className="kf-check"><input type="checkbox" checked={settings.touch} onChange={e => update({ ...settings, touch: e.target.checked })} />{t('Сенсорное управление', 'Touch controls')}</label>
    <label className="kf-check"><input type="checkbox" checked={settings.reducedMotion} onChange={e => update({ ...settings, reducedMotion: e.target.checked })} />{t('Уменьшить движение камеры', 'Reduce camera motion')}</label>
    <label className="kf-check"><input type="checkbox" checked={settings.softEcho} onChange={e => update({ ...settings, softEcho: e.target.checked })} />{t('Мягкая яркость эха', 'Soft echo brightness')}</label>
    <label className="kf-check"><input type="checkbox" checked={settings.contrast} onChange={e => update({ ...settings, contrast: e.target.checked })} />{t('Контрастные контуры', 'High-contrast outlines')}</label>
    <label>{t('Язык', 'Language')}<select value={settings.language} onChange={e => update({ ...settings, language: e.target.value as Locale })}><option value="ru">Русский</option><option value="en">English</option></select></label>
  </fieldset><fieldset><legend>{t('Звук', 'Audio')}</legend><label>{t('Громкость', 'Volume')}<input type="range" min="0" max="1" step="0.05" value={settings.volume} onChange={e => update({ ...settings, volume: Number(e.target.value) })} /></label><HearingPanel settings={settings} setSettings={update} language={language} audio={audio} /></fieldset></div>;
}

const TouchControls = forwardRef<HTMLDivElement, { scene: RefObject<SceneHandle | null>; language: Locale; view: PlayerView; onKnock: () => void; onTimer: () => void; onMark: () => void; onMenu: () => void }>(function TouchControls({ scene, language, view, onKnock, onTimer, onMark, onMenu }, ref) {
  const [stick, setStick] = useState({ x: 0, y: 0 }), [run, setRun] = useState(false), [quiet, setQuiet] = useState(false);
  const origin = useRef<{ x: number; y: number; id: number } | null>(null), look = useRef<{ x: number; y: number; id: number } | null>(null);
  const joystick = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!origin.current || origin.current.id !== e.pointerId) return;
    let x = e.clientX - origin.current.x, y = e.clientY - origin.current.y; const scale = Math.max(1, Math.hypot(x, y) / 36); x /= scale; y /= scale;
    setStick({ x, y }); scene.current?.move(x / 36, -y / 36);
  };
  const stop = () => { origin.current = null; setStick({ x: 0, y: 0 }); scene.current?.move(0, 0); };
  return <div className="kf-touch" ref={ref}>
    <div className="kf-look-pad" aria-label={copy(language, 'Обзор', 'Look around')} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); look.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; }} onPointerMove={e => { if (look.current?.id === e.pointerId) { scene.current?.look(e.clientX - look.current.x, e.clientY - look.current.y); look.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; } }} onPointerUp={() => { look.current = null; }} onPointerCancel={() => { look.current = null; }} />
    <div className="kf-stick" aria-label={copy(language, 'Движение', 'Move')} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); origin.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; joystick(e); }} onPointerMove={joystick} onPointerUp={stop} onPointerCancel={stop}><span style={{ transform: `translate(${stick.x}px,${stick.y}px)` }} /></div>
    <div className="kf-touch-modes"><button aria-pressed={run} onClick={() => { setRun(!run); scene.current?.setRun(!run); }}>{copy(language, 'Бег', 'Run')}</button><button aria-pressed={quiet} onClick={() => { setQuiet(!quiet); scene.current?.setQuiet(!quiet); }}>{copy(language, 'Тихо', 'Quiet')}</button><button onClick={onMenu}>{copy(language, 'Меню', 'Menu')}</button></div>
    <div className="kf-touch-actions"><button className="kf-touch-knock" onClick={onKnock} disabled={view.self.knockReadyIn > 0}>{label(KNOCK_ACTION_COPY[view.knockKind], language)}</button><button className={`kf-touch-hand ${view.prompt.duration ? 'hold' : ''}`} disabled={view.prompt.type === 'none'} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); scene.current?.setInteract(true); }} onPointerUp={() => scene.current?.setInteract(false)} onPointerCancel={() => scene.current?.setInteract(false)}>{view.prompt.type === 'none' ? copy(language, 'Действие', 'Action') : label(PROMPTS[view.prompt.type], language)}{view.prompt.duration ? <small>{copy(language, 'удерживать', 'hold')}</small> : null}</button><button onClick={onTimer} disabled={!view.self.timer}>{copy(language, 'Таймер', 'Timer')} {view.self.timer ? '1' : '0'}</button><button onClick={onMark}>{copy(language, 'Метка', 'Mark')}</button></div>
  </div>;
});

export function KnockFirst({ room, userId, friends = [], language, request, refresh, onExit, onChooseMission }: {
  room: KnockRoom; userId: string; friends?: KnockFriend[]; language: Locale; request: PortalRequest; refresh: () => Promise<void>; onExit: () => void; onChooseMission: () => void;
}) {
  const [settings, setSettings] = useState(() => readPreferences(language)), settingsRef = useRef(settings); settingsRef.current = settings;
  const lang = settings.language, t = (ru: string, en: string) => copy(lang, ru, en);
  const [view, setView] = useState<PlayerView | null>(null), viewRef = useRef<PlayerView | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [menu, setMenu] = useState<'none' | 'settings' | 'hearing' | 'map' | 'marks'>('none');
  const [controlled, setControlled] = useState(false), [context, setContext] = useState<SceneContextStatus>('ready');
  const contextWasLost = useRef(false);
  const [notice, setNotice] = useState(''), [captions, setCaptions] = useState<SoundCaption[]>([]), [stats, setStats] = useState<SceneStats | null>(null);
  const [rematchBusy, setRematchBusy] = useState(false), rematchPending = useRef(false);
  const scene = useRef<SceneHandle | null>(null), net = useRef<KnockConnection | null>(null);
  const audio = useRef<KnockAudio | null>(null);
  const activeMatch = !!room.matchId && (room.state === 'playing' || room.state === 'finished');
  const closeMenu = useCallback(() => setMenu('none'), []);
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch { /* A private or full browser store must not interrupt play. */ } }, [settings]);
  useEffect(() => {
    document.body.classList.add('kf-active');
    const ownAudio = new KnockAudio(() => settingsRef.current, caption => setCaptions(previous => [...previous.filter(c => c.id !== caption.id).slice(-3), caption]));
    audio.current = ownAudio;
    return () => { document.body.classList.remove('kf-active'); ownAudio.dispose(); if (audio.current === ownAudio) audio.current = null; };
  }, []);
  useEffect(() => { audio.current?.updateSettings(); }, [settings]);
  useEffect(() => {
    if (!activeMatch || !room.matchId) return;
    setView(null); setControlled(false);
    const channel = new KnockConnection(room.roomId, room.matchId, next => { viewRef.current = next; setView(next); }, setConnection, code => setNotice(noticeText(code, settingsRef.current.language)));
    net.current = channel; channel.start();
    return () => { channel.close(); net.current = null; };
  }, [activeMatch, room.roomId, room.matchId]);
  useEffect(() => {
    const blur = () => { setControlled(false); net.current?.neutral(); scene.current?.releaseControl(); };
    const hidden = () => { if (document.hidden) blur(); };
    window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden); };
  }, []);
  useEffect(() => { if (menu !== 'none') { net.current?.neutral(); scene.current?.releaseControl(); setControlled(false); } }, [menu]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { const timer = setInterval(() => setCaptions(prev => prev.filter(c => c.until > performance.now())), 250); return () => clearInterval(timer); }, []);
  useEffect(() => { if (view?.phase === 'finished') { setControlled(false); setMenu('none'); scene.current?.releaseControl(); void refresh(); } }, [view?.phase, refresh]);
  const command = useCallback((payload: CommandPayload, expectedRevision?: number) => {
    void net.current?.command(payload, expectedRevision).then(receipt => { if (!receipt.ok) setNotice(noticeText(receipt.code, settingsRef.current.language)); }).catch(error => { if (error instanceof Error && error.message !== 'CLOSED') setNotice(noticeText(error.message, settingsRef.current.language)); });
  }, []);
  const input = useCallback((value: KnockControlInput) => {
    net.current?.input({ ...value, moveX: Math.cos(value.yaw) * value.moveX - Math.sin(value.yaw) * value.moveZ, moveZ: -Math.sin(value.yaw) * value.moveX - Math.cos(value.yaw) * value.moveZ, hand: value.interact });
  }, []);
  const action = useCallback((kind: SceneAction, down = true) => {
    if (kind === 'interact') { command({ type: 'hand', down }); return; }
    if (!down) return;
    if (kind === 'knock') command({ type: viewRef.current?.self.carrying ? 'call' : 'knock' });
    else if (kind === 'timer') command({ type: 'placeTimer' });
    else if (kind === 'map') setMenu(previous => previous === 'map' ? 'none' : 'map');
    else if (kind === 'mark') setMenu(previous => previous === 'marks' ? 'none' : 'marks');
    else if (kind === 'pause') { setControlled(false); scene.current?.releaseControl(); }
  }, [command]);
  const enter = () => {
    void audio.current?.unlock(); void scene.current?.unlockAudio();
    if (view?.tutorial?.step === 0) command({ type: 'tutorial', action: 'sound' });
    setControlled(true); setMenu('none'); scene.current?.requestControl();
    if (view?.paused) command({ type: 'pause', paused: false });
  };
  const contextChanged = useCallback((state: SceneContextStatus) => {
    setContext(state);
    if (state === 'lost' || state === 'unavailable') {
      contextWasLost.current = true;
      setControlled(false); net.current?.neutral(); net.current?.suspend();
    } else if (state === 'ready' && contextWasLost.current) { contextWasLost.current = false; net.current?.resume(); }
  }, []);
  const toggleLocale = () => setSettings(previous => ({ ...previous, language: previous.language === 'ru' ? 'en' : 'ru' }));
  const caption = useCallback((value: SoundCaption) => setCaptions(previous => [...previous.filter(c => c.id !== value.id && !(c.label === value.label && c.direction === value.direction && c.vertical === value.vertical && c.occluded === value.occluded && c.strength === value.strength)).slice(-3), value]), []);
  const pointer = useCallback((locked: boolean) => { if (!locked && settingsRef.current.pointerLock && !settingsRef.current.touch) setControlled(false); }, []);
  const result = view?.outcome;
  const lessonResult = result?.reason === 'tutorialSkipped' ? 'skipped' : result?.reason === 'tutorialComplete' ? 'complete' : null;
  const heldBattery = view?.batteries.find(battery => battery.id === view.self.carrying);
  const otherHolder = heldBattery?.holders.find(holder => holder && holder !== view?.self.id);
  const otherCarrier = view?.team.find(member => member.id === otherHolder);
  const carryFeedback = heldBattery?.obstruction ? label(CARRY_FEEDBACK[heldBattery.obstruction], lang)
    : heldBattery ? otherHolder ? `${t('Вторая рукоять: ', 'Other handle: ')}${otherCarrier?.name ?? t('Напарник', 'Partner')}` : t('Свободна дальняя рукоять', 'Far handle is free') : '';
  const tutorialSenses = view?.tutorial?.step === 0;
  const touchLesson: [string, string][] = [
    ['Включите звук или подписи.', 'Enable sound or captions.'],
    ['Включите «Тихо» и пройдите несколько шагов.', 'Enable Quiet and take a few steps.'],
    ['Подойдите к трубе и нажмите «Ударить по трубе».', 'Approach the pipe and tap Strike the pipe.'],
    ['Найдите дверь и нажмите «Открыть».', 'Find the door and tap Open.'],
    ['Пройдите через проём. Справа — обзор.', 'Walk through. Look with the right side.'],
    ['Возьмите рукоять. Метка → «Возьми ручку».', 'Take a handle. Mark → Take the handle.'],
    ['Нажмите «Отпустить рукоять».', 'Tap Release handle.'],
    ['Подойдите к боту и удерживайте «Помочь».', 'Approach the bot and hold Help.'],
    ['Постучите по стене и посмотрите на эхо.', 'Knock on a wall and watch the echo.'],
    ['Подойдите к трубе и ударьте ещё раз.', 'Approach the pipe and strike again.'],
  ];
  const sensesAvailable = settings.captions || (!settings.muted && settings.volume > 0);
  const onRematch = async () => {
    if (rematchPending.current) return;
    rematchPending.current = true; setRematchBusy(true);
    try { await request(`/rooms/${room.roomId}/rematch`, { expectedRevision: room.revision }); await refresh(); }
    catch { setNotice(t('Обновите комнату и повторите', 'Refresh the room and retry')); }
    finally { rematchPending.current = false; setRematchBusy(false); }
  };
  return <div className={`kf ${activeMatch ? 'kf-match' : 'kf-room'} ${settings.reducedMotion ? 'kf-reduced' : ''}`} style={{ '--kf-hud': settings.hudScale / 100, '--kf-reticle': settings.crosshair } as CSSProperties}>
    {!activeMatch ? <KnockLobby room={room} userId={userId} friends={friends} language={lang} request={request} refresh={refresh} onExit={onExit} onLanguage={toggleLocale} onSound={() => setMenu('hearing')} /> : <>
      {view && <KnockScene ref={scene} view={view} settings={settings} enabled={controlled && menu === 'none' && connection === 'connected' && context === 'ready' && view.phase !== 'finished'} onInput={input} onAction={action} onPointerLockChange={pointer} onContextStatus={contextChanged} onCaption={caption} onStats={setStats} />}
      {!view ? <div className="kf-loading"><div className="kf-loader" /><p>{t('Проверяем лифт…', 'Checking the lift…')}</p><button className="kf-button" onClick={onExit}>{t('Вернуться в комнату', 'Back to rooms')}</button></div> : <>
        <div className="kf-hud-top"><div className={`kf-reserve ${view.remaining < 60 ? 'urgent' : ''}`}><small>{view.phase === 'preparation' ? t('ДО СПУСКА', 'UNTIL DESCENT') : t('РЕЗЕРВ', 'RESERVE')}</small><strong>{timeLabel(view.phase === 'preparation' ? view.preparationRemaining : view.remaining)}</strong><div className="kf-reserve-bar"><i style={{ width: `${Math.max(0, view.remaining / 840 * 100)}%` }} /></div></div>
          <div className="kf-objective"><span className="kf-sockets">{view.sockets.map((socket, i) => <i key={i} className={socket ? 'filled' : ''} />)}<b>{view.sockets.filter(Boolean).length}/2</b></span><strong>{view.sockets.every(Boolean) ? t('Вернитесь в лифт', 'Return to the lift') : t('Доставьте две батареи', 'Deliver two batteries')}</strong><small>{getLevel(view.levelId).name[lang]} · {getLevel(view.levelId).zones.find(z => z.id === view.self.zoneId)?.name[lang]}</small></div>
          <div className="kf-hud-buttons"><button aria-label={t('Схема комплекса', 'Complex map')} onClick={() => setMenu('map')}>⌘</button><button aria-label={t('Настройки', 'Settings')} onClick={() => setMenu('settings')}>☷</button><button aria-label={t('Звук', 'Audio')} aria-pressed={settings.muted} onClick={() => setSettings({ ...settings, muted: !settings.muted })}>{settings.muted ? '◖×' : '◖'}</button></div>
        </div>
        <div className="kf-team-strip">{view.team.map(m => <div key={m.id} className={`kf-team-seat seat-${m.seatIndex} ${m.status}`}><span className="kf-team-dot" /><strong>{m.name}</strong>{(m.kind === 'bot' || m.assistant) && <small>{t('бот', 'bot')}</small>}<span>{m.status === 'downed' ? `${Math.ceil(m.downedRemaining)}s` : m.status === 'returning' ? '↩' : m.inLift ? '⌂' : m.carrying ? '▰' : m.connected ? '·' : '…'}</span></div>)}</div>
        {view.self.status === 'downed' && <div className="kf-downed"><span>＋</span><strong>{t('Вам нужна помощь', 'You need help')}</strong><b>{Math.ceil(view.self.downedRemaining)} {t('с', 's')}</b><p>{t('Можно отползти и поставить метку помощи', 'You can crawl and place a help mark')}</p><button className="kf-button" onClick={() => command({ type: 'mark', kind: 'help' })}>{t('Позвать на помощь', 'Call for help')}</button></div>}
        {view.self.status === 'returning' && <div className="kf-returning"><strong>{t('Маяк возвращает вас в лифт', 'Your beacon is returning you to the lift')}</strong><p>{t('Груз остался на месте', 'Your cargo stayed where it fell')}</p></div>}
        <div className="kf-crosshair" aria-hidden="true">+</div>
        {(view.prompt.type !== 'none' || carryFeedback || view.self.hold) && <div className="kf-action-prompt">{view.prompt.type !== 'none' && <span className="kf-key">E</span>}<div>{view.prompt.type !== 'none' && <strong>{label(PROMPTS[view.prompt.type], lang)}</strong>}{view.prompt.duration && <small>{t('Удерживайте', 'Hold')} {view.prompt.duration} {t('с', 's')}</small>}{carryFeedback && <small className={`kf-carry-feedback ${heldBattery?.obstruction ? 'obstructed' : ''}`} role="status">{carryFeedback}</small>}</div>{view.self.hold && <div className="kf-hold-progress"><i style={{ width: `${view.self.hold.progress / view.self.hold.duration * 100}%` }} /></div>}</div>}
        {view.self.notice && <div className="kf-world-notice" role="status">{noticeText(view.self.notice, lang)}</div>}
        <div className="kf-hud-bottom"><div className="kf-body-status"><span>{view.self.carrying ? t('Рукоять занята', 'Holding a handle') : t('Руки свободны', 'Hands free')}</span><div className="kf-stamina"><i style={{ width: `${view.self.stamina / 5.5 * 100}%` }} /></div><small>{t('Бег', 'Sprint')} · {view.charges} {t('аварийных возврата', 'emergency returns')}</small></div>
          {!settings.touch && <div className="kf-keyboard-hints"><span><kbd>Q</kbd>{label(KNOCK_ACTION_COPY[view.knockKind], lang)}{view.self.knockReadyIn > 0 && ` · ${view.self.knockReadyIn.toFixed(1)}`}</span><span><kbd>F</kbd>{t('Таймер', 'Timer')} {view.self.timer ? '1' : '0'}</span><button onClick={() => setMenu('marks')}><kbd>G</kbd>{t('Метка', 'Mark')}</button><button onClick={() => { setControlled(false); scene.current?.releaseControl(); }}><kbd>Esc</kbd>{t('Пауза / меню', 'Menu')}</button></div>}
        </div>
        {settings.captions && <div className="kf-captions" aria-live="polite">{captions.map(c => <div key={c.id} className={`kf-caption ${c.strength}`}><b>{({ left: '←', right: '→', front: '↑', behind: '↓', near: '◉' })[c.direction]}</b><span>{c.label}<small>{c.occluded ? t('за преградой · ', 'behind an obstacle · ') : ''}{c.vertical === 'above' ? t('выше · ', 'above · ') : c.vertical === 'below' ? t('ниже · ', 'below · ') : ''}{c.strength === 'loud' ? t('громко', 'loud') : c.strength === 'clear' ? t('отчётливо', 'clear') : t('тихо', 'faint')}</small></span></div>)}</div>}
        {settings.touch && controlled && menu === 'none' && <TouchControls scene={scene} language={lang} view={view} onKnock={() => action('knock')} onTimer={() => action('timer')} onMark={() => setMenu('marks')} onMenu={() => { setControlled(false); scene.current?.releaseControl(); }} />}
        {view.tutorial && !view.tutorial.completed && <section className="kf-tutorial"><span>{String(view.tutorial.step + 1).padStart(2, '0')} / 10</span><div><h2>{TUTORIAL_COPY[Math.min(view.tutorial.step, 9)][lang === 'ru' ? 0 : 1]}</h2><p>{settings.touch ? touchLesson[Math.min(view.tutorial.step, 9)][lang === 'ru' ? 0 : 1] : TUTORIAL_COPY[Math.min(view.tutorial.step, 9)][lang === 'ru' ? 2 : 3]}</p></div></section>}
        {view.phase === 'preparation' && controlled && <div className="kf-preparation"><strong>{t('Готовы к спуску: ', 'Ready to descend: ')}{view.team.filter(member => member.ready).length}/{view.team.length}</strong><p>{t('В шкафу два шумовых таймера. Они сработают через 4 секунды после установки.', 'There are two noise timers in the cabinet. Each sounds 4 seconds after placement.')}</p><small>{settings.touch ? t('Готовность можно подтвердить в меню.', 'Confirm readiness in the menu.') : t('Esc — подтвердить готовность в меню.', 'Esc — confirm readiness in the menu.')}</small></div>}
        {view.resumeRemaining > 0 && <div className="kf-recovery"><strong>{t('Вылазка восстановлена', 'Mission restored')}</strong><b>{Math.ceil(view.resumeRemaining)}</b><span>{t('Продолжаем с того же места', 'Continuing where you left off')}</span></div>}
        {!controlled && !result && menu === 'none' && context === 'ready' && connection === 'connected' && <div className="kf-return-panel">
          <p className="kf-eyebrow">{view.phase === 'preparation' ? t('КАБИНА ЛИФТА', 'LIFT CABIN') : t('ВЫЛАЗКА ПРОДОЛЖАЕТСЯ', 'MISSION IN PROGRESS')}</p>
          <h2>{tutorialSenses ? t('Начнём со звука', 'Start with sound') : view.paused ? t('Практика на паузе', 'Practice paused') : t('Возвращаемся?', 'Ready to return?')}</h2>
          <p>{tutorialSenses ? t('Включите звук или направленные подписи в настройках. Нажмите «Начать урок», когда будете готовы.', 'Enable audio or directional captions in Settings. Choose Start lesson when ready.') : settings.touch ? t('Левый стик — движение · правая область — обзор · кнопка руки — действие', 'Left stick — move · right area — look · hand button — interact') : t('WASD — движение · мышь — обзор · E — рука · Q — стук', 'WASD — move · mouse — look · E — hand · Q — knock')}</p>
          <div className="kf-return-main-actions"><button className="kf-button primary" disabled={tutorialSenses && !sensesAvailable} onClick={enter}>{tutorialSenses ? t('Начать урок', 'Start lesson') : t('Продолжить', 'Continue')} →</button>
            {view.phase === 'preparation' && <button className="kf-button" disabled={view.team.find(member => member.id === view.self.id)?.ready} onClick={() => command({ type: 'ready' })}>{view.team.find(member => member.id === view.self.id)?.ready ? t('Готовность подтверждена', 'Readiness confirmed') : t('К спуску готов', 'Ready to descend')}</button>}
          </div>
          <div className="kf-return-options"><button className="kf-text-button" onClick={() => setMenu('settings')}>{t('Настройки', 'Settings')}</button>{view.settings.practice && <button className="kf-text-button" onClick={() => command({ type: 'pause', paused: !view.paused })}>{view.paused ? t('Снять паузу', 'Unpause') : t('Пауза практики', 'Pause practice')}</button>}{view.tutorial && !view.tutorial.completed && <button className="kf-text-button" onClick={() => command({ type: 'tutorial', action: 'skip' })}>{t('Пропустить урок', 'Skip lesson')}</button>}<button className="kf-text-button" onClick={onExit}>{t('К комнатам', 'Rooms')}</button></div>
        </div>}
        {connection !== 'connected' && context === 'ready' && <div className="kf-network" role="status"><strong>{connection === 'superseded' ? t('Вы продолжили в другом окне', 'You continued in another window') : connection === 'closed' ? t('Соединение закрыто', 'Connection closed') : t('Восстанавливаем связь…', 'Reconnecting…')}</strong><span>{t('Ваше место и груз сохранены', 'Your place and cargo are kept')}</span>{connection === 'closed' && <button className="kf-button" onClick={() => location.reload()}>{t('Обновить', 'Reload')}</button>}{connection === 'superseded' && <button className="kf-button" onClick={() => net.current?.reclaim()}>{t('Продолжить здесь', 'Continue here')}</button>}</div>}
        {context !== 'ready' && <div className="kf-recovery"><h2>{context === 'unavailable' ? t('Не удалось открыть 3D', 'Could not open 3D') : t('Восстанавливаем изображение', 'Restoring the image')}</h2><p>{t('Проверьте поддержку WebGL 2 и загрузку ресурсов. Ваше место сохранено.', 'Check WebGL 2 support and resource loading. Your place is kept.')}</p><button className="kf-button" onClick={() => location.reload()}>{t('Повторить', 'Retry')}</button><button className="kf-button" onClick={onExit}>{t('Вернуться в комнату', 'Back to rooms')}</button></div>}
        {result && <div className="kf-result"><div className="kf-result-paper"><p className="kf-eyebrow">№ 017 / {lessonResult ? t('ЖУРНАЛ ОБУЧЕНИЯ', 'TRAINING LOG') : t('ЖУРНАЛ СМЕНЫ', 'SHIFT LOG')}</p><span className={`kf-result-seal ${lessonResult ?? result.kind}`}>{lessonResult === 'skipped' ? '↗' : result.kind === 'full' ? '✓' : result.kind === 'partial' ? '◒' : '×'}</span><h1>{lessonResult === 'skipped' ? t('Урок пропущен', 'Lesson skipped') : lessonResult === 'complete' ? t('Урок пройден', 'Lesson complete') : result.kind === 'full' ? t('Все вышли', 'Everyone made it') : result.kind === 'partial' ? t('Вышли не все', 'Partial evacuation') : t('Вылазка прервана', 'Mission interrupted')}</h1><p>{lessonResult === 'skipped' ? t('Вы можете повторить урок или выбрать маршрут обычной вылазки.', 'You can repeat the lesson or choose a regular mission route.') : lessonResult === 'complete' ? t('Стук, дверь, две рукояти и помощь — вы проверили каждое действие. Выберите маршрут или повторите урок.', 'You tried knocking, doors, both handles and helping a partner. Choose a route or repeat the lesson.') : getLevel(view.levelId).name[lang]}</p>
          {!lessonResult && <><div className="kf-result-numbers"><div><strong>{result.batteries}/2</strong><span>{t('Батареи', 'Batteries')}</span></div><div><strong>{result.evacuated.length}/{view.team.length}</strong><span>{t('В лифте', 'In the lift')}</span></div><div><strong>{timeLabel(result.remaining)}</strong><span>{t('Остаток', 'Remaining')}</span></div><div><strong>{result.saves}</strong><span>{t('Спасения', 'Rescues')}</span></div></div>
            <ul className="kf-evacuated">{view.team.map(m => <li key={m.id}><span>{result.evacuated.includes(m.id) ? '✓' : '—'}</span>{m.name}{(m.kind === 'bot' || m.assistant) && <small>{t('бот', 'bot')}</small>}<b>{result.evacuated.includes(m.id) ? t('Вернулся', 'Returned') : t('Остался внизу', 'Left below')}</b></li>)}</ul>
            <div className="kf-key-echoes"><h3>{t('Эхо этой смены', 'Echoes of this shift')}</h3>{result.echoes.map(e => <p key={e.id}><time>{timeLabel(e.at)}</time><span>{e.type.toLowerCase().includes('reson') ? t('Сильный удар', 'Resonant strike') : e.type.toLowerCase().includes('reviv') ? t('Напарник поднят', 'Partner rescued') : e.type.toLowerCase().includes('install') ? t('Батарея установлена', 'Battery installed') : t('Сигнал команды', 'Crew signal')}</span>{e.zoneId && <b>{e.zoneId}</b>}</p>)}</div>
          </>}
          <div className="kf-result-actions"><button className={`kf-button ${lessonResult ? 'primary' : ''}`} disabled={rematchBusy} onClick={onChooseMission}>{t('Выбрать вылазку', 'Choose a mission')}</button>{room.hostPlayerId === userId && <button className={`kf-button ${lessonResult ? '' : 'primary'}`} disabled={rematchBusy} onClick={() => void onRematch()}>{rematchBusy ? t('Готовим комнату…', 'Preparing room…') : lessonResult ? t('Повторить урок', 'Repeat lesson') : t('Ещё одна смена', 'Another shift')} ↻</button>}</div>
        </div></div>}
      </>}
    </>}
    {notice && <div className="kf-notice" role="status">{notice}</div>}
    {menu === 'settings' && audio.current && <Dialog title={t('Настройки вылазки', 'Mission settings')} language={lang} onClose={closeMenu}><PreferencesPanel settings={settings} update={setSettings} language={lang} audio={audio.current} />{stats && <p className="kf-device-note">{stats.width} × {stats.height} · {settings.quality === 'high' ? t('Высокое качество', 'High quality') : t('Экономное качество', 'Low quality')}</p>}</Dialog>}
    {menu === 'hearing' && audio.current && <Dialog title={t('Проверка слуха', 'Hearing check')} language={lang} onClose={closeMenu}><HearingPanel settings={settings} setSettings={setSettings} language={lang} audio={audio.current} /></Dialog>}
    {menu === 'map' && view && <Dialog title={t('Проявленная схема', 'Revealed plan')} language={lang} onClose={closeMenu}><div className="kf-map"><RoutePlan route={view.levelId} discovered={view.discoveredZones} current={view.self.zoneId} /><div><h3>{t('Секторы батарей', 'Battery sectors')}</h3>{view.objectiveSectors.map((zones, i) => <p key={i}>0{i + 1} · {zones.map(zone => getLevel(view.levelId).zones.find(z => z.id === zone)?.name[lang] ?? zone).join(' / ')}</p>)}<p>{t('Схема запоминает стены. Положение скрытых предметов и Слушателя на неё не попадает.', 'The plan remembers walls. Hidden objects and the Listener are not shown.')}</p><p>{t('Вы здесь: ', 'You are here: ')}{view.self.zoneId}</p></div></div></Dialog>}
    {menu === 'marks' && view && <Dialog title={t('Метка команде', 'Mark for the crew')} language={lang} onClose={closeMenu}><div className="kf-mark-options">{([['here', 'Сюда', 'This way', '↗'], ['battery', 'Батарея', 'Battery', '▰'], ['danger', 'Опасно', 'Danger', '!'], ['handle', 'Возьми ручку', 'Take the handle', '⌁'], ['help', 'Нужна помощь', 'Need help', '+']] as const).map(([kind, ru, en, symbol]) => <button className="kf-button" key={kind} onClick={() => { command({ type: 'mark', kind }); closeMenu(); }}><b>{symbol}</b>{t(ru, en)}</button>)}{view.self.carrying && <button className="kf-button" onClick={() => { command({ type: 'call' }); closeMenu(); }}>{t('Позвать голосом', 'Call out')}</button>}</div></Dialog>}
  </div>;
}

export default KnockFirst;
