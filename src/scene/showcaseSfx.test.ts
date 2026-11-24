import { describe, expect, it } from 'vitest'
import { createDemo } from '../auditions/demos'
import type { Group } from '../auditions/demos'
import { applyResolvedCommand, createPosition } from '../core'
import { actionPlan } from './actionPresentation'
import { planSceneCues } from './audio'
import { getDieMotionTiming } from './diceMotion'
import { promotionTiming } from './promotionMotion'
import { replaceShowcaseCues, showcaseSources } from './showcaseSfx'
import type { ShowcaseSound } from './showcaseSfx'

const buffers = new Map((Object.keys(showcaseSources) as ShowcaseSound[])
  .map((name): [ShowcaseSound, AudioBuffer] => [name, { duration: name === 'queen' ? 5 : name === 'bloodlust' ? 6 : 3.5 } as AudioBuffer]))

function mix(group: Group, reduced = false) {
  const demo = createDemo(group, 'bishop', reduced)
  return replaceShowcaseCues(planSceneCues(demo.events, { plan: demo.plan }), buffers, demo.plan, undefined, false)
}

describe('selected showcase playback', () => {
  it.each([false, true])('plays only D2 at 40% on each committed contact (reduced=%s)', reduced => {
    const demo = createDemo('reaction.guilt', 'bishop', reduced)
    const cue = planSceneCues(demo.events, { plan: demo.plan }).find(cue => cue.kind === 'dice')!
    const { stock, clips } = replaceShowcaseCues([cue], buffers, demo.plan, undefined, false)
    const timing = getDieMotionTiming(reduced)
    expect(showcaseSources.dice).toBe('dice-auditions/d2.mp3')
    expect(stock).toEqual([])
    expect(clips).toHaveLength(timing.impactsMs.length)
    clips.forEach((clip, index) => {
      expect(clip).toMatchObject({ buffer: buffers.get('dice'), duration: .108, gain: .4 })
      expect(clip.offset).toBeCloseTo(index * .128, 6)
      expect(clip.at - cue.at).toBeCloseTo((timing.impactsMs[index] - 9) / 1000, 6)
    })
  })

  it.each([false, true])('plays the selected steel strike and room tail (reduced=%s)', reduced => {
    const { stock, clips } = replaceShowcaseCues([
      { kind: 'royalCheck', at: .243 },
    ], buffers, undefined, undefined, false, reduced)
    expect(stock).toEqual([])
    const gain = reduced ? .73 : 1
    expect(clips).toMatchObject([
      { buffer: buffers.get('royalCheck'), at: .243, duration: reduced ? .57 : .70, gain },
    ])
  })

  it.each([false, true])('plays separate fragment and E/G/D landing recordings (reduced=%s)', reduced => {
    const release = reduced ? 1.02 : 1.03
    const landing = reduced ? 1.43 : 1.70
    const charge = { kind: 'royalCharge', at: release - .76 } as const
    const end = { kind: 'royalEnd', at: reduced ? 2.08 : 2.37 } as const
    const { stock, clips } = replaceShowcaseCues([
      charge, { kind: 'royalBreak', at: release }, { kind: 'royalGround', at: landing }, end,
    ], buffers, undefined, undefined, false, reduced)
    expect(stock).toEqual([charge, end])
    expect(clips).toMatchObject([
      { buffer: buffers.get('royalBreak'), at: release, offset: 0, duration: 1.32 },
      { buffer: buffers.get('royalGround'), at: landing, offset: 0, duration: .92 },
    ])
    expect(clips[0].at + clips[0].duration).toBeGreaterThan(clips[1].at)
    expect(clips[0].at + clips[0].duration).toBeLessThan(clips[1].at + clips[1].duration)
  })

  it('uses the short chant and the requested per-state levels', () => {
    expect(mix('reaction.guilt').clips.find(clip => clip.buffer === buffers.get('guilt'))?.gain).toBeCloseTo(10 ** (-8 / 20) * .80)
    expect(mix('reaction.devastated').clips.find(clip => clip.buffer === buffers.get('devastated'))?.gain).toBeCloseTo(10 ** (-2 / 20) * .80)
    expect(mix('reaction.berserk').clips.find(clip => clip.buffer === buffers.get('berserk'))?.gain).toBeCloseTo(10 ** (-12 / 20) * .95)
    expect(mix('reaction.bloodlust').clips.find(clip => clip.buffer === buffers.get('bloodlust'))).toMatchObject({ offset: 0, duration: 1.54 })
    const pawn = createPosition({ pieces: [
      { side: 'white', type: 'king', square: 'a1' }, { side: 'black', type: 'king', square: 'h7' },
      { side: 'white', type: 'pawn', square: 'b7' }, { side: 'black', type: 'rook', square: 'a8' },
    ] })
    const { events } = applyResolvedCommand(pawn, { type: 'move', from: 'b7', to: 'a8', promotion: 'queen' }, 2)
    const plan = actionPlan(events, true, false, false)
    const clips = replaceShowcaseCues(planSceneCues(events, { plan }), buffers, plan, undefined, false).clips
    const guilt = clips.find(clip => clip.buffer === buffers.get('guilt'))!
    expect(guilt.gain).toBeCloseTo(10 ** (-8 / 20))
    expect(guilt.at + guilt.duration).toBeCloseTo(plan.promotion!.formationAt / 1000)
  })

  it.each([false, true])('schedules integrated promotion contacts once (reduced=%s)', reduced => {
    for (const kind of ['rook', 'queen'] as const) {
      const demo = createDemo(`promotion.${kind}`, 'bishop', reduced)
      const { clips, stock } = mix(`promotion.${kind}`, reduced)
      expect(stock.map(cue => cue.kind)).toEqual(['move'])
      expect(clips).toHaveLength(1)
      const [clip] = clips
      expect(clip.buffer).toBe(buffers.get(kind))
      expect(clip.at + .420 - clip.offset).toBeCloseTo((demo.plan.promotion!.formationAt + promotionTiming(kind, reduced).impact) / 1000)
      expect(clip.at + clip.duration).toBeCloseTo(demo.plan.promotion!.aftermathAt / 1000)
      expect(clip.gain).toBeCloseTo(kind === 'queen' ? 10 ** (-8 / 20) * .90 : 1)
    }
  })

  it('leaves the selected formation unqueued during the learner reaction and rebases it after confirmation', () => {
    const demo = createDemo('promotion.formation', 'bishop', false)
    const cues = planSceneCues(demo.events, { plan: demo.plan, playback: 'reaction' })
    expect(replaceShowcaseCues(cues, buffers, demo.plan, 'reaction', false).clips).toEqual([])
    const confirm = planSceneCues(demo.events, { plan: demo.plan, playback: 'formation' })
    expect(replaceShowcaseCues(confirm, buffers, demo.plan, 'formation', false).clips[0].at).toBeCloseTo(.03)
  })

  it('adds the selected ignition over R1 only at the genuine state reveal', () => {
    const demo = createDemo('reaction.berserk', 'bishop', false)
    const cues = planSceneCues(demo.events, { plan: demo.plan })
    const { clips } = replaceShowcaseCues(cues, buffers, demo.plan, undefined, false)
    const fire = clips.find(clip => clip.buffer === buffers.get('berserkIgnite'))
    const reaction = clips.find(clip => clip.buffer === buffers.get('berserk'))
    expect(fire).toMatchObject({ at: reaction?.at, offset: 0, duration: .88 })
  })
})
