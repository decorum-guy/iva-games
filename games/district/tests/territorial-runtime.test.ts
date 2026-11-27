import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import type { ActionEnvelope, Participant, StartMatchRequest } from '@iva-games/session-kit';
import { createDistrictRegistration, DistrictRuntime } from '../src/runtime';
import { availableZones, newsBoundary, tutorialNews } from '../src/territorial/news';
import { newsCatalogVersion, newsProfiles } from '../src/territorial/news-catalog';
import type { NewsStage } from '../src/territorial/news-catalog';
import { TERRITORY_BOT, TERRITORY_CONTENT, TERRITORY_RULES, TERRITORY_SAVE } from '../src/territorial/types';
import type { TerritoryState, TerritoryView } from '../src/territorial/types';
import type { DistrictView } from '../src/types';
import { PlatformService } from '../../../apps/platform/src/service';
import { MemoryMailbox } from '../../../apps/platform/src/mail';

const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function registrationFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'district-v4-runtime-'));
  const databasePath = join(directory, 'sessions.sqlite');
  const clock = { now: 10_000 };
  const open = (territorialDefault = true) => createDistrictRegistration({ databasePath, territorialDefault, now: () => clock.now });
  let game = open();
  const db = new Database(databasePath);
  cleanups.push(() => { game.close(); db.close(); rmSync(directory, { recursive: true, force: true }); });
  const rawState = (id: string): string => db.prepare('SELECT state_json FROM district_territorial_matches WHERE match_id=?').pluck().get(id) as string;
  const receiptCount = (id: string): number => db.prepare('SELECT COUNT(*) FROM district_territorial_receipts WHERE match_id=?').pluck().get(id) as number;
  return {
    directory, databasePath, clock, db, rawState, receiptCount,
    get registration() { return game; },
    get runtime() { return game.runtime!; },
    reopen(territorialDefault = true) { game.close(); game = open(territorialDefault); },
    read(id: string): TerritoryState { return JSON.parse(rawState(id)); },
    write(s: TerritoryState) {
      db.prepare('UPDATE district_territorial_matches SET state_json=? WHERE match_id=?').run(JSON.stringify(s), s.matchId);
    },
    async view(id: string, account = 'owner') { return await game.runtime!.viewForPlayer(id, account) as TerritoryView; },
  };
}

const participants: Participant[] = ['owner','guest'].map((playerId, seatIndex) => ({
  participantId: 'seat-' + seatIndex, playerId, displayName: playerId, seatIndex, controller: { kind: 'human', playerId },
}));
function request(key = 'modern'): StartMatchRequest {
  return { startCommandId: 'start-' + key, roomId: 'room-' + key, participants: structuredClone(participants),
    rulesVersion: TERRITORY_RULES, contentVersion: TERRITORY_CONTENT, settings: { mapId: 'two-shores', newsPreset: 'hard' } };
}
function envelope(view: { revision: number; phaseId: string }, actionId: string, action: Record<string, unknown>): ActionEnvelope {
  return { expectedRevision: view.revision, actionId, payload: { phaseId: view.phaseId, ...action } };
}

describe('Territorial SQLite registration and compatibility', () => {
  it('advertises the current profile while resolving the settings and bot policy of every supported room version', () => {
    const f = registrationFixture();
    expect(f.registration).toMatchObject({ rulesVersion: TERRITORY_RULES, contentVersion: TERRITORY_CONTENT });
    expect(f.registration.normalizeSettings?.(undefined)).toMatchObject({ mapVersion: '2', newsPreset: 'medium' });
    expect(f.registration.resolveRoomVersion?.(TERRITORY_RULES, TERRITORY_CONTENT)?.botVersion).toBe(TERRITORY_BOT);
    for (const [rules, content, botVersion, mapId] of [
      ['district@0.2', 'district-maps@0.1', '1', 'crossroads'],
      ['district@0.3', 'district-maps@0.2', '2', 'azure-bay'],
    ]) {
      const version = f.registration.resolveRoomVersion?.(rules, content);
      expect(version?.botVersion).toBe(botVersion);
      expect(version?.normalizeSettings({ mapId })).toEqual({ mapId, mapVersion: '1' });
    }
    expect(f.registration.resolveRoomVersion?.('district@0.5', TERRITORY_CONTENT)).toBeUndefined();
  });

  it('reads real v0.2/v0.3 records and saved receipts before and after v0.4 activity in the same database', async () => {
    const f = registrationFixture();
    const legacy = new DistrictRuntime({ databasePath: f.databasePath, now: () => f.clock.now });
    const old: { id: string; command: ActionEnvelope; snapshot: string; receipt: unknown }[] = [];
    try {
      for (const [key, content, mapId] of [['0.2','district-maps@0.1','crossroads'],['0.3','district-maps@0.2','azure-bay']]) {
        const start = { ...request(key.replace('.', '-')), rulesVersion: 'district@' + key, contentVersion: content, settings: { mapId } };
        const { matchId: id } = await legacy.createMatch(start);
        const view = await legacy.viewForPlayer(id, 'owner');
        const command = envelope(view, 'saved-choice-legacy', { type: 'choose-goal', goal: view.you.goalOptions[0] });
        const receipt = await legacy.applyAction(id, 'owner', command);
        const snapshot = f.db.prepare('SELECT state FROM district_matches WHERE match_id=?').pluck().get(id) as string;
        old.push({ id, command, snapshot, receipt });
      }
    } finally { legacy.close(); }
    f.reopen();
    const config = request();
    const { matchId } = await f.runtime.createMatch(config);
    expect(await f.runtime.createMatch(structuredClone(config))).toEqual({ matchId });
    await expect(f.runtime.createMatch({ ...config, settings: { newsPreset: 'easy' } })).rejects.toMatchObject({ code: 'START_CONFLICT' });
    expect(f.read(matchId)).toMatchObject({
      schemaVersion: TERRITORY_SAVE, rulesVersion: TERRITORY_RULES, contentVersion: TERRITORY_CONTENT, botVersion: TERRITORY_BOT,
      map: { id: 'two-shores', schemaVersion: 3 }, news: { version: newsCatalogVersion, preset: 'hard', profile: newsProfiles.hard },
    });
    expect(f.read(matchId).news.catalog).toHaveLength(25);
    const current = await f.view(matchId);
    await f.runtime.applyAction(matchId, 'owner', envelope(current, 'modern-placement', { type: 'place', nodeId: current.legal.options[0].id }));
    f.reopen(false);
    expect(f.registration.rulesVersion).toBe('district@0.3');
    expect((await f.view(matchId)).phase).toBe('setup-route');
    for (const saved of old) {
      expect(await f.runtime.applyAction(saved.id, 'owner', saved.command)).toEqual(saved.receipt);
      const view = await f.runtime.viewForPlayer(saved.id, 'owner') as DistrictView;
      expect(view.you.participantId).toBe('seat-0');
      expect(f.db.prepare('SELECT state FROM district_matches WHERE match_id=?').pluck().get(saved.id)).toBe(saved.snapshot);
    }
  });

  it('rejects stale writes, unknown actions and outsiders, and returns the original receipt after later accepted commands', async () => {
    const f = registrationFixture();
    const { matchId } = await f.runtime.createMatch(request());
    const view = await f.view(matchId);
    const first = envelope(view, 'first-place', { type: 'place', nodeId: view.legal.options[0].id });
    await expect(f.runtime.applyAction(matchId,'outsider',first)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(f.runtime.viewForPlayer(matchId, 'outsider')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (const type of ['force-event','tutorial-news','set-news-preset']) {
      await expect(f.runtime.applyAction(matchId,'owner',envelope(view, 'invalid-' + type, { type }))).rejects.toMatchObject({ code: 'INVALID_ACTION' });
    }
    await expect(f.runtime.applyAction(matchId,'owner',{ ...first, payload: { phaseId: 'old', type: 'roll' } })).rejects.toMatchObject({ code: 'STALE_PHASE' });
    const placed = await f.runtime.applyAction(matchId,'owner',first) as TerritoryView;
    await expect(f.runtime.applyAction(matchId,'owner',{ ...first, actionId: 'stale-placement' })).rejects.toMatchObject({ code: 'STALE_REVISION' });
    const route = envelope(placed, 'second-route', { type: 'route', edgeId: placed.legal.options[0].id });
    const routed = await f.runtime.applyAction(matchId,'owner',route) as TerritoryView;
    expect(routed.revision).toBe(placed.revision + 1);
    f.reopen();
    expect(await f.runtime.applyAction(matchId,'owner',first)).toEqual(placed);
    await expect(f.runtime.applyAction(matchId,'owner',{ ...route, actionId: first.actionId })).rejects.toMatchObject({ code: 'ACTION_ID_REUSED' });
    expect((await f.view(matchId)).revision).toBe(routed.revision);
    expect(f.receiptCount(matchId)).toBe(2);
  });

  it('serializes competing writes from independent open SQLite runtime connections', async () => {
    const f = registrationFixture();
    const second = createDistrictRegistration({ databasePath: f.databasePath, territorialDefault: true, now: () => f.clock.now });
    try {
      const { matchId } = await f.runtime.createMatch(request());
      const left = await f.view(matchId);
      const right = await second.runtime!.viewForPlayer(matchId, 'owner') as TerritoryView;
      const commands = [envelope(left,'connection-one',{ type: 'place', nodeId: left.legal.options[0].id }),
        envelope(right,'connection-two',{ type: 'place', nodeId: right.legal.options[1].id })];
      const writes = await Promise.allSettled([f.runtime.applyAction(matchId,'owner',commands[0]), second.runtime!.applyAction(matchId,'owner',commands[1])]);
      expect(writes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = writes.find(result => result.status === 'rejected');
      expect(rejected?.reason).toMatchObject({ code: 'STALE_REVISION' });
      expect(f.receiptCount(matchId)).toBe(1);
      expect(Object.keys(f.read(matchId).buildings)).toHaveLength(1);
      expect(f.read(matchId).revision).toBe(left.revision + 1);
      const index = writes.findIndex(result => result.status === 'fulfilled');
      const committed = writes[index];
      if (committed.status !== 'fulfilled') throw new Error('Expected one accepted placement');
      expect(await second.runtime!.applyAction(matchId,'owner',commands[index])).toEqual(committed.value);
    } finally { second.close(); }
  });

  it('refuses incompatible saved state, catalogue and preset schemas without rewriting the match', async () => {
    const f = registrationFixture();
    const { matchId } = await f.runtime.createMatch(request());
    const valid = f.rawState(matchId);
    const edits: ((state: TerritoryState) => unknown)[] = [
      state => ({ ...state, schemaVersion: 2 }),
      state => ({ ...state, news: { ...state.news, version: 'district-news@2' } }),
      state => ({ ...state, news: { ...state.news, profile: { ...state.news.profile, version: 'district-news-profile@2' } } }),
    ];
    for (const edit of edits) {
      const raw = JSON.stringify(edit(JSON.parse(valid)));
      f.db.prepare('UPDATE district_territorial_matches SET state_json=? WHERE match_id=?').run(raw, matchId);
      f.reopen();
      await expect(f.runtime.viewForPlayer(matchId, 'owner')).rejects.toMatchObject({ code: 'INCOMPATIBLE_VERSION' });
      await expect(f.runtime.applyAction(matchId, 'owner', { actionId: 'declined-future', expectedRevision: 0, payload: { type: 'roll' } })).rejects.toMatchObject({ code: 'INCOMPATIBLE_VERSION' });
      expect(f.rawState(matchId)).toBe(raw);
      expect(f.receiptCount(matchId)).toBe(0);
    }
  });

  it('commits a deadline move even if the triggering player POST is stale', async () => {
    const f = registrationFixture();
    const { matchId } = await f.runtime.createMatch(request());
    const before = await f.view(matchId);
    f.clock.now = before.deadlineAt!;
    const old = envelope(before,'deadline-command',{ type: 'place', nodeId: before.legal.options[0].id });
    await expect(f.runtime.applyAction(matchId,'owner',old)).rejects.toMatchObject({ code: 'STALE_REVISION' });
    expect(f.read(matchId).revision).toBe(before.revision + 1);
    expect(f.receiptCount(matchId)).toBe(0);
    f.reopen();
    expect((await f.view(matchId)).revision).toBe(before.revision + 1);
  });
});

type Scenario = { name: string; family: string; stage: NewsStage; launch?: boolean; draws?: number[]; deadline?: 'confirmAt'|'at' };
const stages: Scenario[] = [
  { name: 'surprise meteor', family: 'H04', stage: 'applied', launch: true },
  { name: 'early hidden meteor', family: 'H04', stage: 'forecast', launch: true },
  { name: 'confirmed weather', family: 'H01', stage: 'confirmed', draws: [99,0,0], deadline: 'confirmAt' },
  { name: 'cancelled weather', family: 'H01', stage: 'cancelled', draws: [99,0,99], deadline: 'confirmAt' },
  { name: 'confirmed meteor impact', family: 'H04', stage: 'applied', draws: [30], deadline: 'at' },
  { name: 'local outbreak and immediate city-risk forecast', family: 'E01', stage: 'forecast', launch: true },
  { name: 'outbreak update', family: 'E01', stage: 'update', draws: [99,1,0], deadline: 'confirmAt' },
  { name: 'citywide outbreak', family: 'E01', stage: 'success', draws: [99,1,0], deadline: 'at' },
  { name: 'outbreak containment', family: 'E01', stage: 'cancelled', draws: [99,1,99], deadline: 'at' },
  { name: 'exploration payout', family: 'P01', stage: 'success', draws: [0,0], deadline: 'at' },
  { name: 'contest rejection', family: 'P02', stage: 'cancelled', draws: [0,99], deadline: 'at' },
];

function arrange(s: TerritoryState, scenario: Scenario) {
  // Only fixture setup can alter a saved board. After setup every tested mutation runs through GameRuntime.
  s.round = 10;
  s.turn = 20;
  s.activeIndex = 1;
  s.phase = 'play';
  s.news.processedRound = 10;
  s.news.nextRound = 1000;
  const template = s.news.catalog.find(t => t.templateId === scenario.family)!;
  const level = template.chain === 'hazard' ? 2 : 1;
  const site = s.map.nodes.find(node => {
    s.buildings = { [node.id]: { ownerId: 'seat-0', level } };
    return availableZones(s, template).includes(node.eventSectorId);
  });
  if (!site) throw new Error('Missing suitable fixture geography: ' + scenario.family);
  s.players['seat-0'].cards = [{ id: 'owner-secret', kind: 'patrol', bought: 0 }];
  s.players['seat-1'].cards = [{ id: 'guest-secret', kind: 'supply', bought: 0 }];
  s.news.catalog = [template];
  if (scenario.launch) {
    s.news.profile.warningWeights = scenario.stage === 'forecast' ? [0,0,100] : [100,0,0];
    s.news.nextRound = 11;
    return;
  }
  const rolls = [...scenario.draws!];
  tutorialNews(s, template.templateId, site.eventSectorId, maximum => {
    const n = rolls.shift();
    if (n === undefined || n >= maximum) throw new Error('Invalid fixture draw');
    return n;
  });
  const until = s.news.chains[0][scenario.deadline!];
  while (s.round + 1 < until) {
    s.round++;
    newsBoundary(s);
  }
}

describe('SQLite news crash and lost-response acceptance', () => {
  it.each(stages)('$name writes all consequences and its action receipt together', async scenario => {
    const f = registrationFixture();
    const { matchId } = await f.runtime.createMatch(request());
    const state = f.read(matchId);
    arrange(state, scenario);
    f.write(state);
    const before = f.rawState(matchId);
    const view = await f.view(matchId, 'guest');
    const command = envelope(view, 'close-news-round', { type: 'end' });
    // AFTER INSERT exercises rollback after both snapshot UPDATE and receipt INSERT have executed.
    f.db.exec(`CREATE TRIGGER simulated_power_loss AFTER INSERT ON district_territorial_receipts
      BEGIN SELECT RAISE(ABORT,'fixture-power-loss'); END;`);
    await expect(f.runtime.applyAction(matchId, 'guest', command)).rejects.toThrow('fixture-power-loss');
    expect(f.rawState(matchId)).toBe(before);
    expect(f.receiptCount(matchId)).toBe(0);
    f.db.exec('DROP TRIGGER simulated_power_loss');
    f.reopen();
    expect(f.rawState(matchId)).toBe(before);

    const applied = await f.runtime.applyAction(matchId, 'guest', command) as TerritoryView;
    expect(applied.news.at(-1)).toMatchObject({ stage: scenario.stage, templateId: scenario.family });
    expect(applied.revision).toBe(view.revision + 1);
    expect(applied.round).toBe(view.round + 1);
    if (scenario.launch && scenario.family === 'E01') expect(applied.news.map(card => card.stage)).toEqual(['applied','forecast']);
    const afterCommit = f.rawState(matchId);
    // The response can be lost after commit. Reopen while a separate reader still holds the SQLite file.
    f.reopen();
    expect(await f.runtime.applyAction(matchId, 'guest', command)).toEqual(applied);
    const other = await f.view(matchId, 'owner');
    expect(other.news).toEqual(applied.news);
    expect(other.threats).toEqual(applied.threats);
    expect(new Set(other.news.map(item => item.messageId)).size).toBe(other.news.length);
    expect(other.you.cards[0].id).toBe('owner-secret');
    expect(applied.you.cards[0].id).toBe('guest-secret');
    expect(JSON.stringify(other)).not.toContain('guest-secret');
    expect(JSON.stringify(applied)).not.toContain('owner-secret');
    expect(applied).not.toHaveProperty('seed');
    for (const message of other.news.filter(card => 'dueRound' in card)) {
      expect(Object.keys(message).every(key => ['templateId','eventInstanceId','chainId','messageId','stage','headline','round','zone','dueRound'].includes(key))).toBe(true);
    }
    expect(f.rawState(matchId)).toBe(afterCommit);
    expect(f.receiptCount(matchId)).toBe(1);
    expect(await f.runtime.status(matchId)).toEqual({ finished: false });
    expect(f.rawState(matchId)).toBe(afterCommit);
  });
});

describe('Platform territorial room settings', () => {
  it('round-trips all presets, clears both players’ readiness and freezes the host selection at start', async () => {
    const f = registrationFixture();
    const mail = new MemoryMailbox();
    const service = new PlatformService({ publicOrigin: 'http://district.test', games: [f.registration], mail,
      databasePath: join(f.directory, 'platform.sqlite'), now: () => f.clock.now });
    try {
      await service.ready;
      const signup = async (handle: string) => {
        const email = handle + '@example.test';
        const account = await service.register({ email, handle, displayName: handle, password: 'Valid local fixture password 102' });
        const link = mail.messages.find(message => message.to === email)!.text.match(/https?:\/\/\S+/)![0];
        service.verifyEmail(new URL(link).searchParams.get('token'));
        return account.user.playerId;
      };
      const host = await signup('news_owner');
      const guest = await signup('news_guest');
      const friendship = service.requestFriend(host, guest);
      service.respondFriend(guest, friendship.requestId, 'accept');
      let room = service.createRoom(host, { gameId: 'district', capacity: 3 });
      expect(room.settings.newsPreset).toBe('medium');
      const invite = service.invite(host, room.roomId, guest);
      service.acceptInvitation(guest, invite.invitationId);
      room = service.joinRoom(guest, room.roomId);
      room = service.addBot(host, room.roomId, { difficulty: 'normal', expectedRevision: room.revision });
      expect(room.members.find(member => member.controller.kind === 'bot')?.controller).toMatchObject({ botVersion: TERRITORY_BOT });
      expect(() => service.changeSettings(guest,room.roomId,{ expectedRevision: room.revision, settings: { newsPreset: 'easy' } })).toThrow();
      for (const preset of ['easy','medium','hard','very-hard'] as const) {
        for (const user of [host, guest]) service.setReady(user,room.roomId,{ ready: true, expectedRevision: room.revision });
        room = service.changeSettings(host,room.roomId,{ expectedRevision: room.revision, settings: { ...room.settings, newsPreset: preset } });
        const seen = service.getRoom(guest, room.roomId);
        expect(seen.settings.newsPreset).toBe(preset);
        expect(seen.members.filter(member => member.controller.kind === 'human').every(member => !member.ready)).toBe(true);
        expect(seen.members.find(member => member.controller.kind === 'bot')?.ready).toBe(true);
      }
      for (const user of [host, guest]) service.setReady(user,room.roomId,{ ready: true, expectedRevision: room.revision });
      service.startRoom(host,room.roomId,{ expectedRevision: room.revision });
      await service.reconcile();
      const started = service.getRoom(host, room.roomId);
      expect(started).toMatchObject({ state: 'playing', rulesVersion: TERRITORY_RULES, contentVersion: TERRITORY_CONTENT });
      expect(() => service.changeSettings(host,room.roomId,{ expectedRevision: started.revision, settings: { newsPreset: 'easy' } })).toThrow();
      const state = f.read(started.matchId!);
      expect(state.news.profile).toEqual(newsProfiles['very-hard']);
      expect(state.news.catalog).toHaveLength(25);
      const hostView = await service.matchView(host, room.roomId) as TerritoryView;
      const guestView = await service.matchView(guest, room.roomId) as TerritoryView;
      expect(hostView.you.participantId).not.toBe(guestView.you.participantId);
      expect(hostView.preset).toBe('very-hard');
      expect(guestView.preset).toBe(hostView.preset);
    } finally {
      await service.settle();
      service.close();
    }
  });
});
