import type { Action, CardId, PromotionType } from '@chess-2/colossus/core';
import { CARDS } from '@chess-2/colossus/core';
import { ONLINE_PROTOCOL } from '@chess-2/colossus/online/protocol';
import type { CommandEnvelope, CreateRoomRequest, JoinRoomRequest, OnlineCommand, RoomOptions } from '@chess-2/colossus/online/protocol';

export class ColossusError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); this.name = 'ColossusError'; }
}
function fail(): never { throw new ColossusError('invalidMessage'); }
function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail();
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !keys.includes(key))) return fail();
  return value;
}
export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) return fail();
  return value;
}
function name(value: unknown): string {
  if (typeof value !== 'string') return fail();
  const clean = value.normalize('NFKC').trim();
  if (!clean || clean.length > 24 || /[\p{C}]/u.test(clean)) throw new ColossusError('invalidName');
  return clean;
}
function protocol(value: unknown) {
  if (value !== ONLINE_PROTOCOL) throw new ColossusError('protocolMismatch', 409);
}
function bool(value: unknown): boolean { if (typeof value !== 'boolean') return fail(); return value; }
function square(value: unknown): number { if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 63) return fail(); return Number(value); }
function choice<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) return fail(); return value as T;
}
function card(value: unknown): CardId { return choice(value, Object.keys(CARDS) as CardId[]); }
function promotion(value: unknown): PromotionType { return choice(value, ['Q', 'R', 'B', 'N']); }
function action(input: unknown): Action {
  const type = (input as { type?: unknown } | null)?.type;
  if (type === 'move') {
    const v = object(input, ['type', 'unitId', 'to', 'promotion']);
    return { type, unitId: identifier(v.unitId), to: square(v.to), ...(v.promotion === undefined ? {} : { promotion: promotion(v.promotion) }) };
  }
  if (type === 'attack') {
    const v = object(input, ['type', 'unitId', 'target', 'retreat', 'lunge']);
    return { type, unitId: identifier(v.unitId), target: square(v.target),
      ...(v.retreat === undefined ? {} : { retreat: square(v.retreat) }), ...(v.lunge === undefined ? {} : { lunge: bool(v.lunge) }) };
  }
  if (type === 'guard') { const v = object(input, ['type', 'unitId']); return { type, unitId: identifier(v.unitId) }; }
  if (type === 'discard') { const v = object(input, ['type', 'cardId']); return { type, cardId: card(v.cardId) }; }
  if (type === 'promote') { const v = object(input, ['type', 'unitId', 'promotion']); return { type, unitId: identifier(v.unitId), promotion: promotion(v.promotion) }; }
  if (type === 'camp') {
    const v = object(input, ['type', 'reviveId', 'healId']);
    return { type, ...(v.reviveId === undefined ? {} : { reviveId: identifier(v.reviveId) }), ...(v.healId === undefined ? {} : { healId: identifier(v.healId) }) };
  }
  if (type === 'card') {
    const v = object(input, ['type', 'cardId', 'targets', 'to', 'step', 'promotions']);
    let targets: string[] | undefined;
    if (v.targets !== undefined) {
      if (!Array.isArray(v.targets) || v.targets.length > 3) return fail();
      targets = v.targets.map(identifier);
    }
    if (v.step !== undefined && (!Number.isSafeInteger(v.step) || Number(v.step) < 0 || Number(v.step) > 12)) return fail();
    let promotions: Record<string, PromotionType> | undefined;
    if (v.promotions !== undefined) {
      if (!v.promotions || typeof v.promotions !== 'object' || Array.isArray(v.promotions) || Object.keys(v.promotions).length > 3) return fail();
      promotions = Object.fromEntries(Object.entries(v.promotions).map(([key, value]) => [identifier(key), promotion(value)]));
    }
    return { type, cardId: card(v.cardId), ...(targets ? { targets } : {}), ...(v.to === undefined ? {} : { to: square(v.to) }),
      ...(v.step === undefined ? {} : { step: Number(v.step) }), ...(promotions ? { promotions } : {}) };
  }
  if (type === 'transfer' || type === 'end' || type === 'surrender') { object(input, ['type']); return { type }; }
  return fail();
}
export function createRequest(input: unknown): CreateRoomRequest {
  const v = object(input, ['protocol', 'requestId', 'name', 'options']); protocol(v.protocol);
  const o = object(v.options ?? {}, ['boss', 'difficulty', 'mode', 'deck', 'bossCards']);
  const options: RoomOptions = {};
  if (o.boss !== undefined) options.boss = choice(o.boss, ['regent', 'spire', 'archivist'] as const);
  if (o.difficulty !== undefined) options.difficulty = choice(o.difficulty, ['initiate', 'knight', 'veteran', 'abyss'] as const);
  if (o.mode !== undefined) options.mode = choice(o.mode, ['hunt', 'campaign'] as const);
  if (o.bossCards !== undefined) options.bossCards = bool(o.bossCards);
  if (o.deck !== undefined) { if (!Array.isArray(o.deck) || o.deck.length > 16) return fail(); options.deck = o.deck.map(card); }
  return { protocol: ONLINE_PROTOCOL, requestId: identifier(v.requestId), name: name(v.name), options };
}
export function joinRequest(input: unknown): JoinRoomRequest {
  const v = object(input, ['protocol', 'name', 'invite']); protocol(v.protocol);
  if (typeof v.invite !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(v.invite)) throw new ColossusError('inviteInvalid', 403);
  return { protocol: ONLINE_PROTOCOL, name: name(v.name), invite: v.invite };
}
export function presenceRequest(input: unknown): boolean {
  const v = object(input, ['protocol', 'connected']); protocol(v.protocol); return bool(v.connected);
}
export function emptyRequest(input: unknown, withProtocol = true) {
  const v = object(input, withProtocol ? ['protocol'] : []); if (withProtocol) protocol(v.protocol);
}
export function commandRequest(input: unknown): CommandEnvelope {
  const v = object(input, ['protocol', 'commandId', 'expectedRevision', 'command']); protocol(v.protocol);
  if (!Number.isSafeInteger(v.expectedRevision) || Number(v.expectedRevision) < 0) return fail();
  const type = (v.command as { type?: unknown } | null)?.type;
  let command: OnlineCommand;
  if (type === 'action') { const c = object(v.command, ['type', 'action']); command = { type, action: action(c.action) }; }
  else if (type === 'takeover' || type === 'request-return') { object(v.command, ['type']); command = { type }; }
  else if (type === 'restore-control') { const c = object(v.command, ['type', 'accept']); command = { type, accept: bool(c.accept) }; }
  else return fail();
  return { protocol: ONLINE_PROTOCOL, commandId: identifier(v.commandId), expectedRevision: Number(v.expectedRevision), command };
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
