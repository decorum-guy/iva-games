import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planSceneCues } from '../scene/audio';
import { promotionTiming } from '../scene/promotionMotion';
import { makePlayback, variantsFor } from './audio';
import type { Library } from './audio';
import { createDemo, demoFrame, groups } from './demos';

const catalog = JSON.parse(readFileSync(new URL('../../public/assets/audio/auditions/catalog.json', import.meta.url), 'utf8')) as Library['catalog'];
const buffer = {} as AudioBuffer;
const library: Library = { catalog, bank: buffer, buffers: new Map(catalog.candidates.map(candidate => [candidate.id, buffer])) };

describe('audition comparisons', () => {
  it('uses committed rules for every scene, including the third capture without a throw', () => {
    for (const group of groups) {
      const demo = createDemo(group, 'bishop', false);
      if (group.startsWith('reaction.')) expect(demo.result.affliction).toBe(group.split('.')[1]);
      if (demo.face) {
        expect(demo.events).toContainEqual(expect.objectContaining({ face: demo.face, type: 'reaction' }));
        expect(demoFrame(demo, 0, 0).showDie).toBe(false);
        expect(demoFrame(demo, demo.plan.roll!.start, 0).rolling).toBe(true);
        expect(demoFrame(demo, demo.plan.roll!.settle, 0)).toMatchObject({ rolling: false, awaitingReaction: true });
      }
    }
    const bloodlust = createDemo('reaction.bloodlust', 'bishop', false);
    expect(bloodlust.events).toContainEqual(expect.objectContaining({ type: 'affliction', cause: 'bloodlust' }));
    expect(bloodlust.face).toBeUndefined();
    expect(bloodlust.result.capturesSinceRebirth).toBe(3);
    expect(bloodlust.plan.roll).toBeNull();
  });

  for (const reduced of [false, true]) it(`uses one replacement at the shared cue in ${reduced ? 'reduced' : 'normal'} motion`, () => {
    for (const group of groups) {
      const demo = createDemo(group, 'bishop', reduced);
      const stock = makePlayback(library, group, 'current', demo);
      expect(stock.cues).toEqual(planSceneCues(demo.events, { plan: demo.plan }));
      for (const variant of variantsFor(group).slice(1)) {
        const { clip, cues, asset } = makePlayback(library, group, variant, demo);
        if (!clip || !asset) throw new Error(`Missing ${group} ${variant}`);
        expect(clip.duration).toBeLessThanOrEqual(asset.decoded_duration_seconds - clip.offset);
        expect(clip.fadeIn + clip.fadeOut).toBeLessThan(clip.duration);
        expect(clip.gain).toBeLessThanOrEqual(1);
        if (demo.plan.promotion) {
          expect(cues.map(cue => cue.kind)).toEqual(['move']);
          const { event, formationAt, aftermathAt } = demo.plan.promotion;
          const anchor = asset.sync.physical_contact_seconds ?? asset.sync.main_formation_layer_onset_seconds!;
          const impact = asset.sync.physical_contact_seconds == null ? reduced ? 55 : 150 : promotionTiming(event.promotion, reduced).impact;
          expect(clip.at + anchor - clip.offset).toBeCloseTo((formationAt + impact) / 1000, 6);
          expect(clip.at + clip.duration).toBeLessThanOrEqual((aftermathAt + .00001) / 1000);
        } else {
          const reaction = group.split('.')[1];
          expect(cues.some(cue => cue.kind === reaction)).toBe(false);
          expect(clip.at).toBe(stock.cues.find(cue => cue.kind === reaction)?.at);
          expect(cues.map(cue => cue.kind)).toEqual(demo.face ? ['capture', 'dice'] : ['capture']);
        }
      }
    }
  });

  it('keeps the queen fracture identity fixed across full and isolated playlists', () => {
    const group = 'promotion.queen';
    const demo = createDemo(group, 'bishop', false);
    const boundary = demo.plan.promotion!.formationAt;
    const cue = demoFrame(demo, boundary, 0).promotion;
    expect(cue?.id).toBe(demoFrame(createDemo(group, 'knight', false), boundary, 500).promotion?.id);
    const solo = makePlayback(library, group, 'P1-STONE-SOLO', demo);
    const stockSolo = makePlayback(library, group, 'CURRENT-STONE-SOLO', demo);
    const full = makePlayback(library, group, 'P1', demo);
    expect(solo.asset?.file).toBe('promotion-p1-queen-fracture-only.mp3');
    expect(solo.clip?.at).toBe(full.clip?.at);
    expect(solo.cues).toHaveLength(0);
    expect(stockSolo.cues.map(cue => cue.kind)).toEqual(['promotionQueenFracture']);
    expect(full.asset?.file).toBe('promotion-p1-queen.mp3');
    expect(full.cues.map(cue => cue.kind)).toEqual(['move']);
  });

  it('gives the bloodlust edit and the explicit raw chant separate timings', () => {
    const group = 'reaction.bloodlust';
    const demo = createDemo(group, 'bishop', false);
    const edited = makePlayback(library, group, 'R2', demo);
    const raw = makePlayback(library, group, 'R2', demo, true);
    expect(edited.clip?.duration).toBe(1.54);
    expect(raw.clip?.duration).toBe(6);
    expect(raw.cues).toHaveLength(0);
  });
});
