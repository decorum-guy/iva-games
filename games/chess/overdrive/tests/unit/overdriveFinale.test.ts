import { describe, it, expect, vi } from 'vitest'
import { createPosition, transition } from '../../src/core'
import { checkmateEdge, fallAngles, planKingFall, rimPose, stepFall, type FallPlayback } from '../../src/ui/finale'
import { sceneTiming } from '../../src/ui/motion'
import { finaleFixtures } from '../fixtures/finale'

const fixture = (id:string) => finaleFixtures.find(f=>f.id===id)!
const play = (id:string) => {const {before,command}=fixture(id);return transition(before,command)}
const mate = (id:string) => planKingFall(play(id).state)!
describe('checkmated king on the arena',()=>{
  it.each(['corner','capture','white-edge','crowded','ability','promotion'])('has a real core mate and a deterministic final pose in %s',id=>{
    const {before}=fixture(id),{state,events}=play(id)
    expect(state.outcome?.reason).toBe('checkmate')
    expect(checkmateEdge('A',before,state,events)).toBeTruthy()
    expect(checkmateEdge('B',before,state,events)).not.toBe(checkmateEdge('A',before,state,events))
    expect(checkmateEdge('A',state,state,events)).toBeNull()
    expect(checkmateEdge('A',before,state,[])).toBeNull()
    const plan=planKingFall(state)!
    expect(plan).toEqual(planKingFall({...state,pieces:[...state.pieces].reverse()}))
    expect(plan.king).toBe(state.outcome?.winner==='white'?'bk':'wk')
    expect(plan.duration).toBeGreaterThan(1000);expect(plan.duration).toBeLessThan(1800)
    expect(fallAngles(plan,0)).toEqual({king:0,neighbour:0})
    expect(fallAngles(plan,5000)).toEqual({king:plan.angle,neighbour:0})
    const offset=rimPose(plan.dx,plan.dz,plan.rim,plan.angle,.02)
    expect(Math.hypot(offset.x,offset.z)).toBeLessThan(.45)
    expect(offset.y+.02).toBeCloseTo(plan.rim*Math.sin(plan.angle))
  })
  it('clears the corner without rocking the nearby pieces, stops at a real support in a crowd',()=>{
    const open=mate('corner'),crowd=mate('crowded')
    expect(open.support).toBeNull();expect(open.dx).toBeLessThan(0);expect(open.dz).toBeGreaterThan(0)
    expect(open.angle).toBeGreaterThan(Math.PI/2);expect(fallAngles(open,open.contactMs+100).neighbour).toBe(0)
    expect(crowd.support).toBe('gp');expect(crowd.angle).toBeLessThan(Math.PI/2)
    expect(fallAngles(crowd,crowd.contactMs-1).neighbour).toBe(0)
    expect(fallAngles(crowd,crowd.contactMs).king).toBe(crowd.angle)
    expect(fallAngles(crowd,crowd.contactMs+100).neighbour).toBeGreaterThan(.04)
    expect(fallAngles(crowd,crowd.duration).neighbour).toBe(0)
    // The bishop occupies the captured rook's cell after battery; the ghost cannot support the king.
    expect(mate('ability').support).not.toBe('br')
  })
  it('checks actual post-promotion type and knight facing at the support square',()=>{
    const terminal=play('crowded').state
    const withKnight=(side:'white'|'black')=>createPosition({...terminal,pieces:terminal.pieces.map(p=>p.id==='gp'?{...p,type:'knight',side}:p)})
    const white=planKingFall(withKnight('white'))!, black=planKingFall(withKnight('black'))!
    expect(white.support).toBe('gp');expect(black.support).toBe('gp')
    expect(white.angle).not.toBe(black.angle)
  })
  it('never tips for ordinary check, resignation or draw',()=>{
    expect(planKingFall(play('check').state)).toBeNull()
    for(const type of ['agreeDraw','resign'] as const){
      const {before}=fixture('corner'),{events,state}=transition(before,{type})
      expect(planKingFall(state)).toBeNull();expect(checkmateEdge('A',before,state,events)).toBeNull()
    }
  })
  it('bounds elapsed time across stalls and resume and emits exactly one contact',()=>{
    const plan=mate('crowded'), hit=vi.fn(), startsAt=sceneTiming(play('crowded').events).result
    const clock:FallPlayback={key:'a',elapsed:0,previousFrame:null,settled:false,startsAt,onContact:hit}
    stepFall(clock,plan,startsAt-1);expect(clock.elapsed).toBe(0)
    stepFall(clock,plan,startsAt);stepFall(clock,plan,startsAt+50_000);expect(clock.elapsed).toBe(48)
    clock.previousFrame=null;stepFall(clock,plan,startsAt+100_000);expect(clock.elapsed).toBe(48)
    for(let i=0;i<100;i++)stepFall(clock,plan,startsAt+100_000+20*i)
    expect(hit).toHaveBeenCalledExactlyOnceWith(true);expect(clock.settled).toBe(true)
    const end={...clock};stepFall(clock,plan,startsAt+200_000);expect(clock).toEqual(end)
  })
})
