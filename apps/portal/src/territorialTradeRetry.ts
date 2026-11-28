import type { TerritoryAction, TerritoryView } from '@iva-games/district/territorial';

type Command = { actionId: string; expectedRevision: number; payload: TerritoryAction & { phaseId: string } };

/** Refresh only an author's unchanged decision after a proven stale rejection. */
export function retryTradeCommand(before: TerritoryView, command: Command, next: TerritoryView): Command | null {
  const action = command.payload;
  if (action.type !== 'accept' && action.type !== 'cancel') return null;
  if (before.matchId !== next.matchId || action.phaseId !== next.phaseId || before.you.participantId !== next.you.participantId ||
      next.outcome || !next.legal.trade || next.phase !== 'play' || next.serverNow >= (next.deadlineAt ?? Infinity)) return null;
  const original = before.offers.find(o => o.id === action.offerId);
  if (!original?.groupId || original.authorId !== next.you.participantId) return null;
  const sameTerms = (o: typeof original) => o.groupId === original.groupId && o.authorId === original.authorId &&
    Object.keys(original.give).every(k => o.give[k as keyof typeof o.give] === original.give[k as keyof typeof o.give] &&
      o.receive[k as keyof typeof o.receive] === original.receive[k as keyof typeof o.receive]);
  const offer = action.type === 'accept'
    ? next.offers.find(o => o.id === original.id && o.targetId === original.targetId && o.agreedAt === original.agreedAt && o.agreedAt !== undefined && o.canAccept === true && sameTerms(o))
    : next.offers.find(o => sameTerms(o));
  if (!offer) return null;
  return { ...command, expectedRevision: next.revision, payload: { ...action, offerId: offer.id } };
}
