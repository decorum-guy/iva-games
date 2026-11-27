/** Matched tournament, driving real seat-scoped decisions and authoritative transitions. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { BotDifficulty, Participant } from '@iva-games/session-kit';
import { chooseTerritoryBot } from '../src/territorial/bot';
import { applyTerritory, createTerritory, currentId, fallbackTerritory, points, viewTerritory } from '../src/territorial/core';
import { territoryMaps } from '../src/territorial/maps';
import type { TerritoryMap } from '../src/territorial/maps';
import { newsProfiles } from '../src/territorial/news-catalog';
import type { NewsPreset } from '../src/territorial/news-catalog';
import { RESOURCES, TERRITORY_BOT, TERRITORY_CONTENT, TERRITORY_RULES } from '../src/territorial/types';
import type { TerritoryState } from '../src/territorial/types';

const difficulties: BotDifficulty[] = ['easy', 'normal', 'hard'];
const out = resolve('.qa/territorial-balance');
mkdirSync(out, { recursive: true });
const mapFilter = process.argv.find(arg => arg.startsWith('--map='))?.slice(6);
const only = process.argv.includes('--quick');
const samples = Number(process.argv.find(arg => arg.startsWith('--samples='))?.slice(10) ?? 3);
if (!Number.isInteger(samples) || samples < 1 || samples > 100) throw new Error('samples must be an integer from 1 to 100');
const roundLimit = 180;
const actionLimit = 6000;
const add = (counts: Record<string, number>, key: string, amount = 1) => { counts[key] = (counts[key] ?? 0) + amount; };
function leaders(s: TerritoryState) {
  const scores = s.participants.map(p => points(s, p.participantId, false));
  const best = Math.max(...scores);
  return s.participants.filter((_, i) => scores[i] === best).map(p => p.participantId).join(',');
}
function simulate(map: TerritoryMap, seats: number, preset: NewsPreset, sample: number) {
  const profiles = Array.from({ length: seats }, (_, i) => difficulties[(i + sample) % difficulties.length]);
  const participants: Participant[] = profiles.map((difficulty, seatIndex) => ({
    participantId: 's' + seatIndex, displayName: difficulty, seatIndex, playerId: null,
    controller: { kind: 'bot', difficulty, botVersion: TERRITORY_BOT, botProfileId: 'district:' + difficulty },
  }));
  const id = [map.id, seats, preset, sample].join('-');
  const seed = 'district-04-matrix:' + sample;
  let s = createTerritory({ matchId: id, roomId: id, participants, map, preset, seed, now: 0 });
  const actions: Record<string, number> = {};
  const actors: Record<string, Record<string, number>> = Object.fromEntries(participants.map(p => [p.participantId, {}]));
  const newsTemplates: Record<string, number> = {}, newsStages: Record<string, number> = {}, newsByOwner: Record<string, Record<string, number>> = {};
  const struck: Record<string, number> = {};
  const recoveryRounds: number[] = [];
  const concentration = participants.map(() => ({ observations: 0, share: 0, portRounds: 0, largestLoss: 0 }));
  let afterNewsWins = 0, newsLeaderChanges = 0, couponsUsed = 0, expiredCoupons = 0, reserveTurns = 0;
  let failure = '', illegal = 0, fallbacks = 0, steps = 0;
  let handledMessages = 0;
  const digest = createHash('sha256');
  const sectorByNode = new Map(map.nodes.map(node => [node.id, node.eventSectorId]));
  while (!s.outcome && !failure && s.round < roundLimit && steps < actionLimit) {
    const active = currentId(s);
    // Offer recipients get a decision before the next active play action.
    const order = [...participants].sort((a, b) =>
      Number(!s.offers.some(o => o.targetId === a.participantId)) - Number(!s.offers.some(o => o.targetId === b.participantId)) ||
      Number(a.participantId !== active) - Number(b.participantId !== active));
    let advanced = false;
    for (const p of order) {
      const id = p.participantId;
      if (id !== active && !s.discard[id] && !s.offers.some(offer => offer.targetId === id)) continue;
      const view = viewTerritory(s, id, steps);
      const decision = chooseTerritoryBot(view, profiles[p.seatIndex], `district-04-policy:${sample}:${s.revision}:${id}`);
      const action = decision ?? fallbackTerritory(view);
      if (!action) continue;
      if (!decision) fallbacks++;
      let next: TerritoryState;
      try { next = applyTerritory(s, id, action, steps + 1); }
      catch (error) {
        illegal++;
        failure = JSON.stringify({ round: s.round, revision: s.revision, phase: s.phase, id, action, error: String(error) });
        break;
      }
      add(actions, action.type);
      add(actors[id], action.type);
      if (action.type === 'route' && s.phase === 'play') add(actors[id], map.edges.find(edge => edge.id === action.edgeId)!.kind);
      if (action.type === 'bank') add(actors[id], 'bank-' + view.legal.bank[action.give]);
      digest.update(JSON.stringify([id, action]));
      for (const coupon of s.news.coupons) if (!next.news.coupons.some(c => c.id === coupon.id)) {
        if (coupon.endsAfterRound <= next.round) expiredCoupons++; else couponsUsed++;
      }
      if (action.type === 'end' && view.you.hand.ore >= 1 && view.you.hand.brick >= 1) reserveTurns++;
      if (next.round > s.round) {
        for (const p of participants) {
          const zones: Record<string, number> = {};
          let total = 0;
          for (const [nodeId, b] of Object.entries(s.buildings)) if (b.ownerId === p.participantId) {
            total += b.level;
            add(zones, sectorByNode.get(nodeId)!, b.level);
          }
          const stats = concentration[p.seatIndex];
          stats.observations++;
          stats.share += total ? Math.max(...Object.values(zones)) / total : 0;
          if (map.ports.some(port => s.buildings[port.nodeId]?.ownerId === p.participantId)) stats.portRounds++;
        }
        if (RESOURCES.some(key => next.bank[key] < 0 || Object.values(next.players).some(p => p.hand[key] < 0) ||
          next.bank[key] + Object.values(next.players).reduce((n, p) => n + p.hand[key], 0) !== next.rules.stockPerResource)) {
          failure = 'resource conservation failed at round ' + next.round;
        }
      }
      for (const nodeId of Object.keys(struck)) if (!next.news.damage[nodeId]) {
        recoveryRounds.push(next.round - struck[nodeId]);
        delete struck[nodeId];
      }
      for (const [nodeId, damage] of Object.entries(next.news.damage)) struck[nodeId] = damage.round;
      const issued = next.news.messages.slice(handledMessages);
      if (issued.length) {
        if (next.outcome) afterNewsWins++;
        if (leaders(s) !== leaders(next)) newsLeaderChanges++;
      }
      handledMessages = next.news.messages.length;
      s = next;
      steps++;
      advanced = true;
      break;
    }
    if (!advanced && !failure) failure = 'no available action at ' + s.phase;
  }
  if (!s.outcome && !failure) failure = 'exceeded ' + (s.round >= roundLimit ? 'round' : 'action') + ' limit';
  const instances = new Set<string>();
  const hazardWarnings: Record<string, number> = {};
  for (const note of s.news.messages) {
    if (!instances.has(note.eventInstanceId)) {
      add(newsTemplates, note.templateId);
      if (note.templateId.startsWith('H')) add(hazardWarnings, note.stage === 'forecast' ? 'two' : note.stage === 'confirmed' ? 'one' : 'zero');
    }
    instances.add(note.eventInstanceId);
    add(newsStages, note.templateId + ':' + note.stage);
    if (!('changes' in note)) continue;
    const loss: Record<string, number> = {};
    for (const change of note.changes) {
      const owner = newsByOwner[change.ownerId] ??= {};
      if (change.kind === 'level' && change.after < change.before) add(loss, change.ownerId, change.before - change.after);
      if (change.kind === 'level') add(owner, change.after >= change.before ? 'gainedLevels' : 'lostLevels', Math.abs(change.after - change.before));
      else if (change.kind === 'resources' || change.kind === 'production') {
        for (const amount of Object.values(change.resources)) {
          const metric = change.kind === 'resources' ? 'resources' : amount < 0 ? 'productionReduction' : 'productionBonus';
          add(owner, metric, Math.abs(amount));
        }
      }
      else add(owner, change.kind);
    }
    for (const [id, count] of Object.entries(loss)) {
      const stats = concentration[participants.findIndex(p => p.participantId === id)];
      stats.largestLoss = Math.max(stats.largestLoss, count);
    }
  }
  return { map: map.id, seats, preset, sample, profiles, rules: TERRITORY_RULES, content: TERRITORY_CONTENT, bot: TERRITORY_BOT, news: s.news.version,
    finished: !!s.outcome, winners: s.outcome?.winnerParticipantIds ?? [], scores: participants.map(p => points(s, p.participantId, true)),
    turns: s.turn, rounds: s.round, steps, illegal, failure, fallbacks, actions, actors, newsTemplates, newsStages, newsByOwner, hazardWarnings,
    recoveryRounds, unrepaired: Object.keys(struck).length, couponsUsed, expiredCoupons, unusedAtEnd: s.news.coupons.length, reserveTurns,
    newsLeaderChanges, afterNewsWins, concentration, transcriptSha256: digest.digest('hex') };
}
const maps = territoryMaps.filter(map => !mapFilter || map.id === mapFilter);
if (!maps.length) throw new Error('Unknown map ' + mapFilter);
for (const map of only ? maps.slice(0, 1) : maps) {
  const results = [];
  for (const seats of only ? [2] : [2, 3, 4]) {
    for (const preset of only ? ['very-hard'] as const : Object.keys(newsProfiles) as NewsPreset[]) {
      for (let sample = 0; sample < (only ? 1 : samples); sample++) {
        const game = simulate(map, seats, preset, sample);
        results.push(game);
        if (!game.finished) console.error(JSON.stringify({ map: map.id, seats, preset, sample, failure: game.failure, rounds: game.rounds }));
      }
    }
    console.info(JSON.stringify({ map: map.id, seats, finished: results.filter(r => r.seats === seats && r.finished).length, games: results.filter(r => r.seats === seats).length }));
  }
  writeFileSync(resolve(out, map.id + (only ? '-quick' : '') + '.json'), JSON.stringify(results, null, 2) + '\n');
  if (results.some(result => !result.finished || result.illegal)) process.exitCode = 1;
}
