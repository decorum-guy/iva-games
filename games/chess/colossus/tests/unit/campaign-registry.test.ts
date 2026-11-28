import { describe, expect, it, vi } from 'vitest';
import type { HuntBossId } from '../../src/core/types';

// Isolated module fixtures exercise an expanded, reordered campaign without
// changing the shipped roster or adding test-only hooks to production code.
const fixture = vi.hoisted(() => ({ huntOnlyId: 'fixture-hunt-only' }));
vi.mock('../../src/core/data', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/core/data')>();
  const huntOnlyId = fixture.huntOnlyId as HuntBossId;
  return {
    ...original,
    CAMPAIGN_BOSSES: ['spire', 'regent', 'archivist', 'spire'],
    BOSSES: { ...original.BOSSES, [huntOnlyId]: { ...original.BOSSES.regent, id: huntOnlyId } },
    HUNT_BOSSES: [...original.HUNT_BOSSES, huntOnlyId],
  };
});

import { CAMPAIGN_BOSSES, HUNT_BOSSES, applyAction, createGame, getActiveActor, restoreGame, validateState } from '../../src/core';
import { checkOutcome } from '../../src/core/combat';
import { bossWinDifficulties, earnedBossIds, retainResultRecords } from '../../src/ui/records';
import type { ResultRecord } from '../../src/ui/records';

const huntOnlyId = fixture.huntOnlyId as HuntBossId;
function record(overrides: Partial<ResultRecord> = {}): ResultRecord {
  return {
    id: 'campaign-win', boss: 'archivist', difficulty: 'knight', mode: 'campaign',
    coop: false, cards: true, round: 9, lost: 0, kingHp: 20, armyHp: 21,
    winner: 'army', assisted: false, ...overrides,
  };
}

describe('campaign roster extension', () => {
  it.each([false, true])('uses the configured start and all four encounters (co-op %s)', coop => {
    let state = createGame({ mode: 'campaign', boss: 'regent', bossCards: false, coop });
    expect(CAMPAIGN_BOSSES).toHaveLength(4);
    expect(state.boss.id).toBe('spire');
    const campActors: string[] = [];
    for (const [index, boss] of CAMPAIGN_BOSSES.entries()) {
      expect(state.campaignIndex).toBe(index);
      expect(state.boss.id).toBe(boss);
      expect(validateState(state)).toEqual([]);
      state.boss.hp = 0;
      expect(checkOutcome(state)).toBe(true);
      expect(validateState(state)).toEqual([]);
      expect(restoreGame(state)).toEqual(state);
      if (index < CAMPAIGN_BOSSES.length - 1) {
        expect(state.phase).toBe('camp');
        expect(state.outcome).toBeNull();
        const actor = getActiveActor(state);
        campActors.push(actor);
        state = applyAction(state, { type: 'camp' }, actor);
      } else {
        expect(state.phase).toBe('finished');
        expect(state.outcome).toMatchObject({ winner: 'army', reason: 'boss-defeated' });
      }
    }
    expect(campActors).toEqual(coop ? ['A', 'B', 'A'] : ['solo', 'solo', 'solo']);
  });

  it.each([-1, 4, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects malformed campaign index %s', index => {
    const state = createGame({ mode: 'campaign', bossCards: false });
    state.campaignIndex = index;
    expect(validateState(state)).toContain('invalid-progress');
    expect(() => restoreGame(state)).toThrow('invalid-progress');
  });

  it('rejects a camp after the last configured encounter', () => {
    const state = createGame({ mode: 'campaign', bossCards: false });
    state.campaignIndex = CAMPAIGN_BOSSES.length - 1;
    state.phase = 'camp';
    state.boss.hp = 0;
    expect(validateState(state)).toContain('invalid-progress');
  });
});

describe('earned boss medals across roster changes', () => {
  it('does not credit a newly registered hunt-only boss for an existing campaign win', () => {
    expect(HUNT_BOSSES).toContain(huntOnlyId);
    expect(CAMPAIGN_BOSSES).not.toContain(huntOnlyId);
    const completed = record({ campaignBosses: [...CAMPAIGN_BOSSES] });
    expect(bossWinDifficulties([completed], huntOnlyId)).toEqual(new Set());
    const hunt = record({ id: 'hunt-win', mode: 'hunt', boss: huntOnlyId });
    expect(bossWinDifficulties([completed, hunt], huntOnlyId)).toEqual(new Set(['knight']));
  });

  it('legacy wins retain only the original three bosses; an explicit later roster earns its extra boss', () => {
    const legacy = record();
    expect(earnedBossIds(legacy)).toEqual(['regent', 'spire', 'archivist']);
    expect(bossWinDifficulties([legacy], huntOnlyId)).toEqual(new Set());
    const expanded = record({ id: 'expanded-win', campaignBosses: ['regent', 'spire', 'archivist', huntOnlyId] });
    expect(bossWinDifficulties([legacy, expanded], huntOnlyId)).toEqual(new Set(['knight']));
    const reordered = record({ id: 'shorter-win', campaignBosses: ['spire', 'regent'] });
    expect(bossWinDifficulties([reordered], 'archivist')).toEqual(new Set());
  });

  it('trimming history retains a distinct older campaign medal after a roster change', () => {
    const current = record({ id: 'recent-win', campaignBosses: ['regent', 'spire', 'archivist'] });
    const older = record({ id: 'older-expanded-win', campaignBosses: ['regent', 'spire', 'archivist', huntOnlyId] });
    const redundant = record({ id: 'redundant-legacy-win' });
    const retained = retainResultRecords([current, older, redundant], 1);
    expect(retained.map(item => item.id)).toEqual(['recent-win', 'older-expanded-win']);
    expect(bossWinDifficulties(retained, huntOnlyId)).toEqual(new Set(['knight']));
  });

  it('retains campaign completion even when newer hunts already cover every boss medal', () => {
    const hunts = (['regent', 'spire', 'archivist'] as const).map(boss => record({ id: `hunt-${boss}`, mode: 'hunt', boss }));
    const campaign = record({ id: 'older-campaign-completion' });
    expect(retainResultRecords([...hunts, campaign], 3).map(item => item.id))
      .toEqual(['hunt-regent', 'hunt-spire', 'hunt-archivist', 'older-campaign-completion']);
  });

  it.each([
    { winner: 'boss' }, { assisted: true }, { mode: 'practice' as const }, { mode: 'tutorial' as const },
  ])('does not award non-earned medals: %j', changes => {
    expect(earnedBossIds(record({ campaignBosses: [huntOnlyId], ...changes }))).toEqual([]);
  });

  it('ignores invalid stored roster entries without treating them as a legacy victory', () => {
    const malformed = record({ campaignBosses: ['sentinel', 'missing-boss'] as unknown as HuntBossId[] });
    expect(earnedBossIds(malformed)).toEqual([]);
    expect(earnedBossIds(record({ campaignBosses: null } as unknown as Partial<ResultRecord>))).toEqual([]);
  });
});
