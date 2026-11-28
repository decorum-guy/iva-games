import { RESOURCES, emptyStock } from '@iva-games/district/territorial';
import type { Stock, TerritoryOffer, TerritoryView } from '@iva-games/district/territorial';

export interface TradeDraft {
  version: 1;
  targetId: string;
  give: Stock;
  receive: Stock;
  parentId: string | null;
  editing: boolean;
}

export const stockTotal = (stock: Partial<Stock>) => RESOURCES.reduce((sum, resource) => sum + (stock[resource] ?? 0), 0);
export const missingStock = (hand: Stock, cost: Partial<Stock>): Stock => Object.fromEntries(
  RESOURCES.map(resource => [resource, Math.max(0, (cost[resource] ?? 0) - hand[resource])]),
) as Stock;

export function tradeDraftKey(matchId: string, participantId: string) {
  return `iva.district.trade.v1:${encodeURIComponent(matchId)}:${encodeURIComponent(participantId)}`;
}

export function emptyTradeDraft(targetId = ''): TradeDraft {
  return { version: 1, targetId, give: emptyStock(), receive: emptyStock(), parentId: null, editing: false };
}

/** Stored drafts are input, never authority. A corrupt draft cannot enable an action. */
export function parseTradeDraft(value: string | null): TradeDraft | null {
  if (!value || value.length > 5000) return null;
  try {
    const candidate: unknown = JSON.parse(value);
    if (!candidate || typeof candidate !== 'object') return null;
    const data = candidate as Record<string, unknown>;
    const validId = (id: unknown): id is string => typeof id === 'string' && id.length <= 128;
    const stock = (input: unknown): input is Stock => !!input && typeof input === 'object' &&
      RESOURCES.every(resource => {
        const amount = (input as Record<string, unknown>)[resource];
        return typeof amount === 'number' && Number.isInteger(amount) && amount >= 0 && amount <= 100;
      });
    if (data.version !== 1 || !validId(data.targetId) || !(data.parentId === null || validId(data.parentId)) ||
      !stock(data.give) || !stock(data.receive) || typeof data.editing !== 'boolean') return null;
    return {
      version: 1, targetId: data.targetId, parentId: data.parentId, editing: data.editing,
      give: Object.fromEntries(RESOURCES.map(resource => [resource, (data.give as Stock)[resource]])) as Stock,
      receive: Object.fromEntries(RESOURCES.map(resource => [resource, (data.receive as Stock)[resource]])) as Stock,
    };
  } catch { return null; }
}

export function counterDraft(offer: TerritoryOffer): TradeDraft {
  return { version: 1, targetId: offer.authorId, give: { ...offer.receive }, receive: { ...offer.give }, parentId: offer.id, editing: true };
}

/** Revalidation preserves the chosen person and amounts when the active seat changes. */
export function inspectTradeDraft(view: TerritoryView, draft: TradeDraft) {
  const own = view.you.participantId;
  const target = view.players.find(player => player.participantId === draft.targetId);
  const targetAllowed = view.players.some(player => player.participantId !== own && !player.left);
  const parent = draft.parentId ? view.offers.find(offer => offer.id === draft.parentId &&
    offer.authorId === draft.targetId && offer.targetId === own) : undefined;
  const closedParent = draft.parentId ? view.offerHistory?.find(offer => offer.id === draft.parentId) : undefined;
  const shortage = missingStock(view.you.hand, draft.give);
  const overlaps = RESOURCES.some(resource => draft.give[resource] > 0 && draft.receive[resource] > 0);
  return {
    target, targetAllowed, parent, closedParent, shortage, overlaps,
    ready: view.legal.trade && targetAllowed && (!draft.parentId || !!parent) &&
      stockTotal(draft.give) > 0 && stockTotal(draft.receive) > 0 && stockTotal(shortage) === 0 && !overlaps,
  };
}
