import { useRef, useState } from 'react';
import type { Side } from '../core';
import type { Locale, Translate } from '../i18n/catalog';
import { onlineErrorText, onlineText } from '../i18n/online';
import type { OnlineTransportState } from '../online/client';
import { roomLink } from '../online/location';
import { ONLINE_NAME_LIMIT } from '../online/protocol';
import type { OnlineCommand, OnlineErrorCode, RoomSnapshot } from '../online/protocol';
import { Dialog } from './Dialogs';
import './online.css';

export function OnlineSetup({ t, locale, invitation, previousRoom, busy, error, onClose, onCreate, onJoin, onResume }: {
  t: Translate; locale: Locale; invitation?: { roomId: string; invite: string }; previousRoom: string | null;
  busy: boolean; error: OnlineErrorCode | null; onClose: () => void;
  onCreate: (name: string, side: Side | 'random') => void;
  onJoin: (roomId: string, invite: string, name: string) => void;
  onResume: (roomId: string) => void;
}) {
  const [name, setName] = useState(() => { try { return localStorage.getItem('remorse-online-name-v1') ?? ''; } catch { return ''; } });
  const [side, setSide] = useState<Side | 'random'>('random');
  const nt = (key: Parameters<typeof onlineText>[1]) => onlineText(locale, key);
  return <Dialog title={nt('title')} closeLabel={t('nav.close')} onClose={onClose}>
    <form className="online-setup" onSubmit={event => {
      event.preventDefault();
      if (busy || !name.trim()) return;
      try { localStorage.setItem('remorse-online-name-v1', name.trim()); } catch { /* Name is optional to remember. */ }
      if (invitation) onJoin(invitation.roomId, invitation.invite, name.trim());
      else onCreate(name.trim(), side);
    }}>
      <p>{nt(invitation ? 'joining' : 'intro')}</p>
      <label className="online-name">{nt('name')}<input data-testid="online-name" autoComplete="nickname"
        autoFocus maxLength={ONLINE_NAME_LIMIT} required value={name} onChange={event => setName(event.target.value)} disabled={busy} /></label>
      {!invitation && <fieldset><legend>{nt('side')}</legend><div className="segmented" role="group">
        {(['white', 'random', 'black'] as const).map(choice => <button type="button" key={choice}
          aria-pressed={side === choice} disabled={busy} onClick={() => setSide(choice)} data-testid={`online-side-${choice}`}>
          {choice === 'random' ? nt('random') : t(`side.${choice}`)}</button>)}
      </div></fieldset>}
      {error && <p className="notice" role="alert">{onlineErrorText(locale, t, error)}</p>}
      <button type="submit" className="button primary" disabled={busy || !name.trim()} data-testid={invitation ? 'online-join' : 'online-create'}>
        {nt(busy ? 'working' : invitation ? 'join' : 'create')}</button>
      {!invitation && previousRoom && <button type="button" className="text-button" disabled={busy}
        onClick={() => onResume(previousRoom)} data-testid="online-resume">{nt('resume')}</button>}
      <small className="field-note">{nt('friendly')}</small>
    </form>
  </Dialog>;
}

export function OnlinePanel({ t, locale, room, transport, invite, error, working, queued, showResult, onCommand, onInvite, onReconnect, onDismissError }: {
  t: Translate; locale: Locale; room: RoomSnapshot; transport: OnlineTransportState | null;
  invite: string | null; error: OnlineErrorCode | null; working: boolean; queued: number; showResult: boolean;
  onCommand: (command: OnlineCommand) => boolean; onInvite: () => void; onReconnect: () => void; onDismissError: () => void;
}) {
  const nt = (key: Parameters<typeof onlineText>[1]) => onlineText(locale, key);
  const input = useRef<HTMLInputElement>(null);
  const [copyState, setCopyState] = useState<'copied' | 'selectCopy' | null>(null);
  const connected = transport?.status === 'connected';
  const blocked = !connected || transport.pending || working;
  const peer = room.players[room.you === 'white' ? 'black' : 'white'];
  const mine = room.players[room.you];
  const link = invite ? roomLink(room.id, invite) : '';
  const status = room.status === 'expired' ? 'expired' : transport?.status === 'replaced' ? 'replaced'
    : !connected ? transport?.status === 'reconnecting' ? 'reconnecting' : 'connecting'
      : peer && !peer.connected ? room.status === 'waiting' ? 'waitingOffline'
        : room.status === 'finished' ? 'finishedOffline' : 'opponentOffline'
        : queued ? 'catchingUp' : 'connected';
  return <section className="online-panel" data-testid="online-room" data-room-id={room.id}
    data-room-status={room.status} data-connection={transport?.status ?? 'connecting'} data-authoritative-revision={room.game.revision}>
    <div className="online-connection" role="status" data-testid="online-connection"><i data-connected={connected && Boolean(peer?.connected)} />{nt(status)}</div>
    {!connected && ['error', 'closed', 'replaced'].includes(transport?.status ?? '') && <button type="button" className="button compact" onClick={onReconnect}>
      {nt(transport?.status === 'replaced' ? 'takeover' : 'reconnect')}</button>}
    {error && <div className="notice" role="alert"><span>{onlineErrorText(locale, t, error)}</span>
      <button type="button" className="text-button" aria-label={t('nav.close')} onClick={onDismissError}>×</button></div>}
    {room.status === 'waiting' && <div className="online-waiting">
      <h3>{nt(peer ? 'preparing' : 'waiting')}</h3>
      <ul className="online-seats" aria-label={nt('side')}>{(['white', 'black'] as const).map(side => <li key={side}>
        <span className={`mini-stamp ${side}`} aria-label={t(`side.${side}`)} /><span>{room.players[side]?.name ?? nt('emptySeat')}{room.you === side ? ` · ${nt('you')}` : ''}</span>
        <small data-ready={Boolean(room.players[side]?.connected && room.players[side]?.ready)} data-testid={`online-seat-${side}`}>
          {room.players[side] ? nt(!room.players[side]!.connected ? 'seatOffline' : room.players[side]!.ready ? 'readyLabel' : 'notReady') : t(`side.${side}`)}</small>
      </li>)}</ul>
      {!peer && <div className="online-invitation">
        <p>{nt('share')}</p>
        {link ? <>
          <input ref={input} readOnly value={link} aria-label={nt('invite')} data-testid="online-invite" onFocus={event => event.target.select()} />
          <button type="button" className="button compact" data-testid="online-copy" onClick={() => {
            void (async () => { try { await navigator.clipboard.writeText(link); setCopyState('copied'); }
              catch { input.current?.focus(); input.current?.select(); setCopyState('selectCopy'); } })();
          }}>{nt('copy')}</button>
          {copyState && <small role="status">{nt(copyState)}</small>}
        </> : <button type="button" className="button compact" disabled={working} onClick={onInvite}>{nt('newInvite')}</button>}
      </div>}
      <button type="button" className={`button ${mine?.ready ? '' : 'primary'}`} disabled={blocked} data-testid="online-ready"
        aria-pressed={mine?.ready ?? false} onClick={() => onCommand({ type: 'ready', ready: !mine?.ready })}>{nt(mine?.ready ? 'unready' : 'ready')}</button>
    </div>}
    {room.status === 'playing' && room.drawOffer && <div className="online-offer" role="status">
      <p>{nt(room.drawOffer.from === room.you ? 'drawSent' : 'drawReceived')}</p>
      {room.drawOffer.from !== room.you && <div className="online-buttons">
        <button type="button" className="button compact" disabled={blocked} data-testid="online-draw-accept"
          onClick={() => onCommand({ type: 'answerDraw', offerId: room.drawOffer!.id, accept: true })}>{nt('accept')}</button>
        <button type="button" className="text-button" disabled={blocked}
          onClick={() => onCommand({ type: 'answerDraw', offerId: room.drawOffer!.id, accept: false })}>{nt('decline')}</button>
      </div>}
    </div>}
    {room.status === 'playing' && !room.drawOffer && <details className="online-room-tools">
      <summary>{nt('room')}</summary><p>{nt('friendly')}</p>
      <button type="button" className="text-button" disabled={blocked || !peer?.connected} data-testid="online-draw-offer"
        onClick={() => onCommand({ type: 'offerDraw' })}>{nt('offerDraw')}</button>
    </details>}
    {room.status === 'finished' && showResult && <div className="online-rematch">
      {room.rematchVotes.length > 0 && <p role="status">{nt(room.rematchVotes.includes(room.you) ? 'rematchSent' : 'rematchReceived')}</p>}
      <button type="button" className="button primary" disabled={blocked || !peer?.connected} data-testid="online-rematch"
        onClick={() => onCommand({ type: 'rematch', accept: !room.rematchVotes.includes(room.you) })}>
        {nt(room.rematchVotes.includes(room.you) ? 'cancelRematch' : 'rematch')}</button>
    </div>}
  </section>;
}
