import { useEffect, useState } from 'react';
import { getLevel } from '../core/level';
import type { Difficulty, KnockSettings, Locale, RouteId } from '../core/types';
import { BOT_NAMES, BOT_NAMES_EN, copy, DIFFICULTY_COPY, label, ROUTE_COPY } from './copy';
import './knock-first.css';

export interface KnockRoom {
  roomId: string; title: string; hostPlayerId: string; capacity: number; revision: number;
  state: 'lobby' | 'starting' | 'playing' | 'finished' | 'cancelled'; matchId: string | null;
  settings: Record<string, unknown>; reservedSeats: number;
  members: { participantId: string; playerId: string | null; displayName: string; seatIndex: number; ready: boolean; controller: { kind: 'human' | 'bot'; difficulty?: string } }[];
}
export interface KnockFriend { playerId: string; displayName: string }
export type PortalRequest = (path: string, body?: unknown) => Promise<unknown>;
export const roomSettings = (value: Record<string, unknown>): KnockSettings => ({
  route: ['archive', 'pump', 'relay'].includes(String(value.route)) ? value.route as RouteId : 'archive',
  difficulty: ['calm', 'normal', 'tense'].includes(String(value.difficulty)) ? value.difficulty as Difficulty : 'normal',
  practice: value.practice === true, tutorial: value.tutorial === true,
});

export function RoutePlan({ route, discovered, current }: { route: RouteId | 'tutorial'; discovered?: string[]; current?: string }) {
  const level = getLevel(route), known = (id: string) => !discovered || discovered.includes(id);
  const centers = level.zones.map(z => z.center);
  const minX = Math.min(...centers.map(p => p.x)) - 8, minZ = Math.min(...centers.map(p => p.z)) - 8;
  const maxX = Math.max(...centers.map(p => p.x)) + 8, maxZ = Math.max(...centers.map(p => p.z)) + 8;
  return <svg className="kf-route-plan" viewBox={`${minX} ${minZ} ${maxX - minX} ${maxZ - minZ}`} aria-hidden="true">
    {level.portals.filter(p => known(p.a) && known(p.b)).map(p => {
      const a = level.zones.find(z => z.id === p.a)!.center, b = level.zones.find(z => z.id === p.b)!.center;
      return <line key={p.id} x1={a.x} y1={a.z} x2={b.x} y2={b.z} stroke={p.channel ? '#e0a15c' : '#91d7ec'} strokeOpacity={p.channel ? 0.5 : 0.75} strokeWidth={p.channel ? 0.6 : 1.2} strokeDasharray={p.channel ? '2 2' : undefined} />;
    })}
    {level.zones.filter(z => known(z.id)).map(z => <g key={z.id}>
      <rect x={z.center.x - 4} y={z.center.z - 4} width={8} height={8} rx={0.8} fill={z.safe ? '#d9a46e' : current === z.id ? '#91d7ec' : '#1b343d'} stroke={z.safe ? '#eacb98' : '#91d7ec'} strokeWidth={0.5} />
      <text x={z.center.x} y={z.center.z + 1.5} textAnchor="middle" fontSize={4.3} fill={z.safe || current === z.id ? '#10212a' : '#d4e6e9'}>{z.id}</text>
      {z.center.y > 0 && <text x={z.center.x + 5} y={z.center.z - 3} fontSize={2.7} fill="#e0a15c">+{z.center.y}</text>}
    </g>)}
  </svg>;
}

export function KnockSettingsFields({ value, onChange, language, disabled = false }: { value: KnockSettings; onChange: (value: KnockSettings) => void; language: Locale; disabled?: boolean }) {
  const t = (ru: string, en: string) => copy(language, ru, en);
  return <div className="kf-settings-fields">
    <fieldset disabled={disabled}><legend>{t('Маршрут вылазки', 'Mission route')}</legend>
      <div className="kf-route-cards">{(Object.keys(ROUTE_COPY) as RouteId[]).map((route, index) => <button type="button" key={route} className={`kf-route-card ${value.route === route ? 'selected' : ''}`} aria-pressed={value.route === route} onClick={() => onChange({ ...value, route })}>
        <span className="kf-route-index">0{index + 1}</span><RoutePlan route={route} />
        <strong>{label(ROUTE_COPY[route].name, language)}</strong><small>{label(ROUTE_COPY[route].note, language)}</small>
      </button>)}</div>
    </fieldset>
    <fieldset disabled={disabled}><legend>{t('Напряжение', 'Tension')}</legend><div className="kf-segmented">{(['calm', 'normal', 'tense'] as const).map(difficulty => <button type="button" key={difficulty} aria-pressed={value.difficulty === difficulty} className={value.difficulty === difficulty ? 'selected' : ''} onClick={() => onChange({ ...value, difficulty })}>{label(DIFFICULTY_COPY[difficulty], language)}</button>)}</div></fieldset>
  </div>;
}

export function KnockLanding({ language, signedIn, onCreate, onExit }: { language: Locale; signedIn: boolean; onCreate: (settings: KnockSettings, capacity: number) => void; onExit: () => void }) {
  const [settings, setSettings] = useState<KnockSettings>({ route: 'archive', difficulty: 'normal', practice: false, tutorial: false });
  const [capacity, setCapacity] = useState(3);
  const t = (ru: string, en: string) => copy(language, ru, en);
  return <div className="kf kf-landing">
    <div className="kf-cover" /><div className="kf-grain" />
    <header className="kf-topline"><button className="kf-text-button" onClick={onExit}>← IVA GAMES</button><span>{t('Архивная смена · 02–05 человек', 'Archive shift · 02–05 people')}</span></header>
    <main className="kf-landing-content"><p className="kf-eyebrow">№ 017 / {t('СЛУЖЕБНЫЙ СПУСК', 'SERVICE DESCENT')}</p><h1>{t('Сначала', 'Knock')}<br /><em>{t('постучи', 'first')}</em></h1>
      <p className="kf-lead">{t('Звук покажет дорогу. И приведёт его.', 'Sound shows you the way. And brings it closer.')}</p>
      <p className="kf-intro">{t('Найдите две батареи в затопленном комплексе. Несите их вдвоём, отвлекайте Слушателя и вернитесь к лифту всей командой.', 'Find two batteries in a flooded complex. Carry together, distract the Listener and bring everyone back to the lift.')}</p>
      <div className="kf-landing-actions"><button className="kf-button primary" onClick={() => onCreate({ ...settings, practice: true, tutorial: true }, 2)}>{signedIn ? t('Пройти короткий урок', 'Take the short lesson') : t('Войти и начать', 'Sign in and begin')} <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" aria-hidden="true" focusable="false"><path d="M6 18 18 6M6 6h12v12" /></svg></button><span className="kf-small">{t('3D от первого лица · кооператив', 'First-person 3D · co-op')}</span></div>
    </main>
    <section className="kf-expedition-plan"><div className="kf-section-title"><span>{t('Собрать вылазку', 'Plan an expedition')}</span><small>{t('Резерв: 14 минут', 'Reserve: 14 minutes')}</small></div>
      <KnockSettingsFields value={settings} onChange={setSettings} language={language} />
      <div className="kf-expedition-footer"><label>{t('Мест в лифте', 'Places in the lift')}<select aria-label={t('Мест в лифте', 'Places in the lift')} value={capacity} onChange={e => setCapacity(Number(e.target.value))}>{[2, 3, 4, 5].map(n => <option key={n}>{n}</option>)}</select></label>
        <button className="kf-button" onClick={() => onCreate({ ...settings, practice: true, tutorial: false }, 2)}>{t('Практика с ботом', 'Practice with a bot')}</button>
        <button className="kf-button primary" onClick={() => onCreate({ ...settings, practice: false, tutorial: false }, capacity)}>{t('Создать комнату', 'Create a room')} →</button>
      </div><p className="kf-device-note">{t('Клавиатура и мышь или сенсорный экран. Нужен WebGL 2. Звук можно заменить направленными подписями.', 'Keyboard and mouse or touch. Requires WebGL 2. Directional captions can replace sound.')}</p>
    </section>
  </div>;
}

export function KnockLobby({ room, userId, friends, language, request, refresh, onExit, onSound, onLanguage }: {
  room: KnockRoom; userId: string; friends: KnockFriend[]; language: Locale; request: PortalRequest; refresh: () => Promise<void>; onExit: () => void; onSound: () => void; onLanguage: () => void;
}) {
  const t = (ru: string, en: string) => copy(language, ru, en);
  const [draft, setDraft] = useState(roomSettings(room.settings));
  const [capacity, setCapacity] = useState(room.capacity);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [inviting, setInviting] = useState(false);
  const host = room.hostPlayerId === userId, self = room.members.find(m => m.playerId === userId);
  const editable = host && !busy && room.state === 'lobby';
  const settings = roomSettings(room.settings), free = room.capacity - room.members.length - room.reservedSeats;
  const minimumCapacity = Math.max(room.members.length + room.reservedSeats, ...room.members.map(member => member.seatIndex + 1));
  const availableFriends = friends.filter(friend => !room.members.some(member => member.playerId === friend.playerId));
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings) || capacity !== room.capacity;
  useEffect(() => { setDraft(roomSettings(room.settings)); setCapacity(room.capacity); setInviting(false); setError(''); }, [room.roomId, host, room.settings.route, room.settings.difficulty, room.settings.practice, room.settings.tutorial, room.capacity]);
  const act = async (path: string, body: unknown = {}) => {
    setBusy(true); setError('');
    try { await request(`/rooms/${room.roomId}${path}`, body); await refresh(); }
    catch { setError(t('Действие не получилось. Обновите комнату и попробуйте снова.', 'That did not work. Refresh the room and try again.')); }
    finally { setBusy(false); }
  };
  const ready = room.members.length >= 2 && room.members.every(m => m.ready) && !room.reservedSeats && !dirty;
  return <div className="kf kf-lobby"><div className="kf-cover" /><div className="kf-grain" />
    <header className="kf-topline"><button className="kf-text-button" onClick={onExit}>← {t('Мои комнаты', 'My rooms')}</button><span className="kf-room-title">{room.title}</span><button className="kf-text-button" onClick={onLanguage}>{language === 'ru' ? 'EN' : 'RU'}</button></header>
    <div className="kf-lobby-heading"><div><p className="kf-eyebrow">№ 017 / {t('ВЕДОМОСТЬ СМЕНЫ', 'SHIFT MANIFEST')}</p><h1>{t('Сначала постучи', 'Knock First')}</h1><p>{settings.tutorial ? t('Учебный спуск с напарником', 'Training descent with a partner') : t('Две батареи. Один лифт. Возвращаемся вместе.', 'Two batteries. One lift. Return together.')}</p></div><div className="kf-reserve-stamp"><strong>14:00</strong><span>{t('ЭНЕРГОРЕЗЕРВ', 'ENERGY RESERVE')}</span></div></div>
    <div className="kf-lobby-grid"><section className="kf-panel kf-route-section"><div className="kf-section-title"><h2>{t('Куда спускаемся', 'Where we descend')}</h2><span>{settings.tutorial ? t('Урок', 'Lesson') : settings.practice ? t('Практика', 'Practice') : t('Вылазка', 'Mission')}</span></div>
      {settings.tutorial ? <div className="kf-lesson-preview"><RoutePlan route="tutorial" /><h3>{t('Учебный отсек', 'Training Annex')}</h3><p>{t('Шаг, стук, дверь, две рукояти и помощь. Всё проверите своими руками.', 'Walking, knocking, a door, two handles and a rescue. Try each action yourself.')}</p></div> : <KnockSettingsFields value={draft} onChange={setDraft} language={language} disabled={!editable} />}
      {host && !settings.tutorial && <div className="kf-lobby-edit"><label>{t('Мест в лифте', 'Lift capacity')}<select value={capacity} onChange={e => setCapacity(Number(e.target.value))} disabled={!editable}>{[2, 3, 4, 5].map(n => <option key={n} disabled={n < minimumCapacity}>{n}</option>)}</select></label>{dirty && <button className="kf-button" disabled={!editable} onClick={() => void act('/settings', { settings: draft, capacity, title: room.title, expectedRevision: room.revision })}>{t('Сохранить маршрут', 'Save route')}</button>}</div>}
      <p className="kf-route-advice">{label(ROUTE_COPY[draft.route].detail, language)}</p><button className="kf-button kf-sound-check" onClick={onSound}>◖ {t('Проверить звук и подписи', 'Check audio and captions')}</button>
    </section><section className="kf-panel kf-crew-section"><div className="kf-section-title"><h2>{t('Состав смены', 'Shift crew')}</h2><span>{room.members.length}/{room.capacity}</span></div>
      <div className="kf-crew-list">{Array.from({ length: room.capacity }, (_, index) => {
        const m = room.members.find(member => member.seatIndex === index);
        return <div key={index} className={`kf-crew-card ${m?.ready ? 'ready' : ''}`}>
          <span className={`kf-crew-number crew-${index}`}>{String(index + 1).padStart(2, '0')}</span><div>{m ? <><strong>{m.controller.kind === 'bot' ? (language === 'ru' ? BOT_NAMES : BOT_NAMES_EN)[index] : m.displayName}</strong><span>{m.controller.kind === 'bot' ? t('Бот · напарник', 'Bot · partner') : m.playerId === userId ? t('Вы', 'You') : t('Участник', 'Crew member')}</span></> : <><strong>{t('Свободное место', 'Open place')}</strong><span>{t('Друг или бот', 'Friend or bot')}</span></>}</div>
          {m && <span className="kf-ready-mark">{m.ready ? '✓' : '—'}<small>{m.ready ? t('Готов', 'Ready') : t('Сборы', 'Packing')}</small></span>}
          {host && m?.controller.kind === 'bot' && <button className="kf-remove" title={t('Убрать бота', 'Remove bot')} aria-label={t('Убрать бота', 'Remove bot')} disabled={!editable} onClick={() => void act(`/bots/${m.participantId}/remove`, { expectedRevision: room.revision })}>×</button>}
        </div>;
      })}</div>
      {host && free > 0 && <div className="kf-add-crew"><button className="kf-button" disabled={!editable} onClick={() => void act('/bots', { difficulty: 'normal', expectedRevision: room.revision })}>+ {t('Бот-напарник', 'Bot partner')}</button><button className="kf-button" disabled={!editable || settings.tutorial} onClick={() => setInviting(!inviting)}>{t('Пригласить друга', 'Invite a friend')}</button></div>}
      {inviting && <div className="kf-friend-list">{availableFriends.map(f => <button className="kf-button" key={f.playerId} disabled={!editable} onClick={() => void act('/invitations', { playerId: f.playerId }).then(() => setInviting(false))}>{f.displayName} ↗</button>)}{!availableFriends.length && <p>{friends.length ? t('Все ваши друзья уже в этой комнате.', 'All your friends are already in this room.') : t('Добавьте друзей в разделе Iva Games «Друзья».', 'Add friends in the Friends section of Iva Games.')}</p>}</div>}
      {room.reservedSeats > 0 && <p className="kf-small">{t('Ждём приглашённых: ', 'Waiting for invitations: ')}{room.reservedSeats}</p>}
      <div className="kf-lobby-rules"><span>Q</span><p>{t('Стук проявляет путь и привлекает Слушателя.', 'Knocking reveals the way and attracts the Listener.')}</p><span>E</span><p>{t('Берите рукоять. Вдвоём быстрее и тише.', 'Take a handle. Together is faster and quieter.')}</p></div>
    </section></div>
    <footer className="kf-lobby-bottom">{error && <p role="alert">{error}</p>}<span>{room.state === 'starting' ? t('Лифт готовится к спуску…', 'The lift is preparing to descend…') : room.state !== 'lobby' ? t('Комната закрыта. Вернитесь к списку комнат.', 'This room is closed. Return to your rooms.') : dirty ? t('Сохраните настройки перед готовностью', 'Save settings before getting ready') : room.members.length < 2 ? t('Нужен ещё один участник или бот', 'Add one more crew member or bot') : room.reservedSeats > 0 ? t('Ждём приглашённых участников', 'Waiting for invited crew members') : ready ? t('Команда готова к спуску', 'The crew is ready to descend') : t('Все участники подтверждают готовность', 'Every crew member confirms readiness')}</span><div><button className={`kf-button ${self?.ready ? '' : 'primary'}`} disabled={busy || dirty || room.state !== 'lobby'} onClick={() => void act('/ready', { ready: !self?.ready, expectedRevision: room.revision })}>{self?.ready ? t('Я ещё собираюсь', 'Still packing') : t('Я готов', 'I’m ready')}</button>{host && <button className="kf-button primary" disabled={busy || !ready || room.state !== 'lobby'} onClick={() => void act('/start', { expectedRevision: room.revision })}>{room.state === 'starting' ? t('Лифт готовится…', 'Lift preparing…') : t('Спуститься', 'Descend')} ↓</button>}</div></footer>
  </div>;
}
