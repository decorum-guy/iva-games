/** Reproducible rules/bot smoke tournament, not a human-balance or network test. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { applyDistrictAction, assertDistrictInvariants, advanceDistrictTime, createDistrictState, parkIntentSignature, tradeIntentSignature } from '../src/core';
import { chooseDistrictBotAction } from '../src/bot';
import { DISTRICT_MAPS } from '../src/maps';
import { viewDistrict } from '../src/view';
import { runParkProbe } from './park-probe';
import type { BotNegotiationMemory, DistrictAction, DistrictState, DistrictView } from '../src/types';
import type { BotDifficulty, Participant } from '@iva-games/session-kit';

type Step = { now: number; participantId?: string; action?: DistrictAction; hash: string };
const output = resolve('.qa/district-simulation');
mkdirSync(output, { recursive: true });
const hash = (state: DistrictState): string => createHash('sha256').update(JSON.stringify(state)).digest('hex');
const samples: number[] = [];
if (process.argv.includes('--park-probe')) {
  const probe = runParkProbe();
  writeFileSync(resolve(output, 'park-probe.json'), JSON.stringify(probe, null, 2));
  console.info(JSON.stringify(probe, null, 2));
  process.exit(0);
}
const gameResults: Array<Record<string, unknown>> = [];
const groups = ['normal', 'mixed', 'hard'] as const;
const kinds: BotDifficulty[] = ['easy', 'normal', 'hard'];
const POLICY_SEED_DOMAIN = 'district-policy-smoke-v1';
let transitions = 0;

// A real match needs a human seat. For this synthetic experiment a scripted
// controller drives that seat through the same legal actions as a human.
// Only its permitted view is given to the bot policy; its local policy bookkeeping
// does not alter authoritative state or give it access to other seats' information.
function memory(round: number): BotNegotiationMemory {
  return { round, created: 0, lastInitiativeAt: null, counteredOfferIds: [], rejectedSignatures: [], bankActions: 0 };
}
function recordDriverAction(book: BotNegotiationMemory, action: DistrictAction, now: number): void {
  if (['offer-trade', 'replace-trade', 'counter-trade', 'offer-park', 'replace-park'].includes(action.type)) {
    book.created++;
    if (action.type === 'counter-trade') book.counteredOfferIds.push(action.offerId);
    else book.lastInitiativeAt = now;
  }
  if (action.type === 'bank') book.bankActions++;
}
function synchronizeDriver(book: BotNegotiationMemory, view: DistrictView, observedRejections: Set<string>): BotNegotiationMemory {
  if (book.round !== view.round) { book = memory(view.round); observedRejections.clear(); }
  for (const offer of view.you.offers) {
    if (offer.authorId === view.you.participantId && offer.status === 'declined' && !observedRejections.has(offer.id)) {
      // Record once, immediately after refusal. Re-signing old refusals against a
      // later economy would incorrectly forbid fresh offers after a real change.
      const signature = offer.kind === 'trade'
        ? tradeIntentSignature(offer.targetId, offer.give, offer.receive, view.history.length, view.you.available)
        : parkIntentSignature(offer.parkId, offer.contributions, view.history.length, view.you.available);
      book.rejectedSignatures.push(signature); observedRejections.add(offer.id);
    }
  }
  view.you.botMemory = structuredClone(book);
  return book;
}

for (const map of DISTRICT_MAPS) for (const seats of [2, 3, 4]) for (const group of groups) for (let seedIndex = 0; seedIndex < 4; seedIndex++) {
  const difficulties = Array.from({ length: seats }, (_, i): BotDifficulty => group === 'mixed' ? kinds[(seedIndex + i) % 3] : group);
  const participants: Participant[] = difficulties.map((difficulty, i) => ({
    participantId: `seat-${i}`, playerId: i === 0 ? 'synthetic-human' : null,
    displayName: i === 0 ? 'Scripted human seat' : `Bot ${i}`, seatIndex: i,
    controller: i === 0 ? { kind: 'human', playerId: 'synthetic-human' } : { kind: 'bot', botProfileId: `district:${difficulty}`, botVersion: '1', difficulty },
  }));
  const identity = `${map.id}-${seats}-${group}-${seedIndex}`;
  // Same rule seed and decision streams across maps permit matched comparisons.
  const input = { matchId: identity, roomId: identity, participants, map, now: 1_000_000, seed: `district-smoke:${seats}:${group}:${seedIndex}` };
  let state = createDistrictState(input), now = input.now, book = memory(0), cursor = 0;
  const observedRejections = new Set<string>();
  const tape: Step[] = [];
  const decisions: Record<string, number> = {};
  let expired = 0;
  while (state.phase !== 'finished') {
    if (tape.length >= 2_000) throw new Error(`Match did not finish: ${identity}, ${state.phase}, ${state.round}`);
    let acted = false;
    for (let offset = 0; offset < seats; offset++) {
      const i = (cursor + offset) % seats;
      const p = participants[i], view = viewDistrict(state, p.participantId, now);
      if (i === 0) book = synchronizeDriver(book, view, observedRejections);
      const began = performance.now();
      // A separate reproducible policy stream never passes the rules/deck seed
      // across the permitted-view boundary. Production uses independently random roots.
      const decisionSeed = createHash('sha256').update(JSON.stringify([POLICY_SEED_DOMAIN, seats, group, seedIndex, p.participantId, state.revision])).digest('hex');
      const action = chooseDistrictBotAction(view, difficulties[i], decisionSeed);
      samples.push(performance.now() - began);
      if (!action) continue;
      const next = applyDistrictAction(state, p.participantId, action, now);
      if (next.revision <= state.revision) throw new Error(`Non-progressing accepted action: ${identity}`);
      state = next;
      if (i === 0) recordDriverAction(book, action, now);
      book = synchronizeDriver(book, viewDistrict(state, participants[0].participantId, now), observedRejections);
      decisions[action.type] = (decisions[action.type] ?? 0) + 1;
      tape.push({ now, participantId: p.participantId, action, hash: hash(state) });
      cursor = (i + 1) % seats;
      now += 100;
      acted = true;
      break;
    }
    if (!acted) {
      if (state.deadlineAt === null) throw new Error('Missing interactive deadline');
      now = Math.max(now, state.deadlineAt);
      state = advanceDistrictTime(state, now);
      book = synchronizeDriver(book, viewDistrict(state, participants[0].participantId, now), observedRejections);
      tape.push({ now, hash: hash(state) });
      expired++;
    }
    assertDistrictInvariants(state);
    // Exercise JSON persistence at fixed intervals without changing the state.
    if (tape.length % 17 === 0) state = JSON.parse(JSON.stringify(state)) as DistrictState;
  }
  if (state.outcome?.reason !== 'completed' || state.history.filter(entry => entry.type === 'income').length !== state.totalRounds) throw new Error(`Incomplete finalization: ${identity}`);
  let replay = createDistrictState(input);
  for (const step of tape) {
    replay = step.action && step.participantId ? applyDistrictAction(replay, step.participantId, step.action, step.now) : advanceDistrictTime(replay, step.now);
    assertDistrictInvariants(replay);
    if (hash(replay) !== step.hash) throw new Error(`Replay diverged: ${identity}, revision ${replay.revision}`);
  }
  const result = {
    identity, map: `${map.id}@${map.version}`, seats, group, seedIndex, difficulties,
    transitions: tape.length, deadlineTransitions: expired, rounds: state.totalRounds,
    initialPriority: state.initialOrder, outcome: state.outcome, decisions,
    completedTrades: state.history.filter(entry => entry.type === 'trade').length,
    parks: state.history.filter(entry => entry.type === 'park').length,
    buildings: Object.fromEntries(['house', 'cafe', 'workshop'].map(kind => [kind, state.cells.filter(cell => cell.building?.kind === kind).length])),
    finalHash: hash(state), simulatedSeconds: (now - input.now) / 1_000,
  };
  gameResults.push(result); transitions += tape.length;
  writeFileSync(resolve(output, `${identity}.json`), JSON.stringify({ input, tape, result }));
}
samples.sort((a, b) => a - b);
const summary = {
  schema: 'district-simulation-v1', policySeedDomain: POLICY_SEED_DOMAIN, games: gameResults.length, transitions, replayedTransitions: transitions,
  maps: DISTRICT_MAPS.map(map => `${map.id}@${map.version}`), seats: [2, 3, 4], groups, seedsPerGroup: 4,
  policyCalls: samples.length, policyP50Ms: samples[Math.floor(samples.length * .5)], policyP95Ms: samples[Math.floor(samples.length * .95)], policyMaxMs: samples.at(-1),
  limits: 'Pure-core synthetic matches: one scripted human seat plus ordinary bots, simulated clock, JSON restart and exact replay. Not a browser/network test, human playtest, rating calibration or proof of balance.',
  results: gameResults,
};
writeFileSync(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2));
console.info(JSON.stringify({ ...summary, results: `${gameResults.length} per-match records in ignored .qa/district-simulation/summary.json` }, null, 2));
