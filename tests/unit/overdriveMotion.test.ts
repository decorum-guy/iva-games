import { describe, expect, it } from 'vitest'
import { createPosition, transition, type Command, type GameState } from '../../src/overdrive/core'
import { TEACHING_FIXTURES } from '../../src/overdrive/core/teaching'
import { activationPulseAt, effectStrengthAt, motionDuration, motionTrails, piecePoseAt, sceneTiming, squarePoint, type BoardMotion } from '../../src/overdrive/ui/motion'

function scene(before:GameState,command:Command):BoardMotion {
  const next=transition(before,command)
  return {id:1,before,after:next.state,events:next.events,startedAt:0,duration:motionDuration(next.events,false)}
}
function lesson(id:string):BoardMotion {
  const fixture=TEACHING_FIXTURES.find(item=>item.id===id)!
  return scene(fixture.state,fixture.expected)
}
const pose=(motion:BoardMotion,id:string,at:number,reduced=false)=>piecePoseAt(motion,id,at,reduced)!
const distance=(a:{x:number;z:number},b:{x:number;z:number})=>Math.hypot(a.x-b.x,a.z-b.z)
const pos=(motion:BoardMotion,id:string,after=false)=>squarePoint((after?motion.after:motion.before).pieces.find(piece=>piece.id===id)!.square)

describe('committed Overdrive action choreography',()=>{
  it('sweeps only the forced target and draws its actual route, leaving the pawn stationary',()=>{
    const motion=lesson('sweep'),timing=sceneTiming(motion.events)
    expect(motion.events.find(event=>event.type==='ability')).toMatchObject({from:'e4',to:'e4'})
    for(let at=0;at<=timing.duration;at+=31){
      expect(pose(motion,'wp',at)).toMatchObject({...pos(motion,'wp'),lift:0})
      expect(pose(motion,'bn',at).lift).toBe(0)
    }
    const trails=motionTrails(motion)
    expect(trails).toHaveLength(1)
    expect(trails[0].pieceId).toBe('bn')
    expect(trails[0].points[0]).toMatchObject(squarePoint('f5'))
    expect(trails[0].points.at(-1)).toMatchObject(squarePoint('e5'))
    expect(distance(trails[0].points[0],trails[0].points.at(-1)!)).toBe(1)
  })

  it('ram approaches the target before pushing; a forced knight remains on the board',()=>{
    const motion=lesson('ram'),timing=sceneTiming(motion.events)
    const victim=pos(motion,'bn'),actor=pos(motion,'wr')
    expect(pose(motion,'bn',timing.contact-1)).toMatchObject({...victim,lift:0})
    expect(distance(pose(motion,'wr',timing.contact),actor)).toBeGreaterThan(1)
    expect(distance(pose(motion,'wr',timing.contact),victim)).toBeCloseTo(.64)
    expect(distance(pose(motion,'bn',timing.contact+80),victim)).toBeGreaterThan(0)
    for(let at=0;at<timing.duration;at+=17)expect(pose(motion,'bn',at).lift).toBe(0)
    expect(pose(motion,'wr',timing.land)).toMatchObject({...pos(motion,'wr',true),lift:0})
    expect(pose(motion,'bn',timing.land)).toMatchObject({...pos(motion,'bn',true),lift:0})
    expect(motionTrails(motion).find(trail=>trail.pieceId==='bn')!.showAt).toBe(timing.contact)
  })

  it('raid passes over the victim at the capture instant before landing on the empty destination',()=>{
    const motion=lesson('raid'),timing=sceneTiming(motion.events)
    const contact=pose(motion,'wn',timing.contact)
    expect(contact).toMatchObject(pos(motion,'br'))
    expect(contact.lift).toBeGreaterThan(.7)
    expect(pose(motion,'br',timing.contact)).toMatchObject({opacity:1,visible:true})
    expect(pose(motion,'br',(timing.contact+timing.captureEnd)/2).opacity).toBeCloseTo(.5)
    expect(pose(motion,'br',timing.captureEnd).visible).toBe(false)
    expect(timing.captureEnd).toBeLessThan(timing.land)
    expect(pose(motion,'wn',timing.land)).toMatchObject(pos(motion,'wn',true))
    expect(pose(motion,'wn',timing.land).lift).toBeCloseTo(0)
  })

  it('battery rises before translation and clears a king-height screen, then returns to the board',()=>{
    const before=createPosition({pieces:[{id:'wk',side:'white',type:'king',square:'d2'},{id:'bk',side:'black',type:'king',square:'h8'},
      {id:'wb',side:'white',type:'bishop',square:'c1'},{id:'br',side:'black',type:'rook',square:'h6'}],energy:{white:5}})
    const motion=scene(before,{type:'ability',mode:'impulse',pieceId:'wb',targetId:'br'}),timing=sceneTiming(motion.events)
    let screenSamples=0
    for(let at=0;at<timing.land;at+=2){
      const bishop=pose(motion,'wb',at)
      if(distance(bishop,pos(motion,'wk'))<.5){expect(bishop.lift).toBeGreaterThan(1.1);screenSamples++}
    }
    expect(screenSamples).toBeGreaterThan(5)
    expect(pose(motion,'wb',timing.moveStart+60)).toMatchObject(pos(motion,'wb'))
    expect(pose(motion,'wb',timing.moveStart+60).lift).toBeGreaterThan(0)
    expect(pose(motion,'wb',timing.land)).toMatchObject({...pos(motion,'wb',true),lift:0})
  })

  it('rotation uses opposing lateral arcs with clearance even for adjacent pieces',()=>{
    const adjacent=createPosition({pieces:[{id:'wk',side:'white',type:'king',square:'a1'},{id:'bk',side:'black',type:'king',square:'h8'},
      {id:'wq',side:'white',type:'queen',square:'c3'},{id:'wn',side:'white',type:'knight',square:'d3'}],energy:{white:5}})
    for(const motion of [lesson('rotation'),scene(adjacent,{type:'ability',mode:'impulse',pieceId:'wq',targetId:'wn'})]){
      const timing=sceneTiming(motion.events)
      for(let at=timing.moveStart;at<=timing.land;at+=5){
        const queen=pose(motion,'wq',at),knight=pose(motion,'wn',at)
        expect(distance(queen,knight)).toBeGreaterThan(.63)
        expect(knight.lift).toBe(0)
      }
      expect(pose(motion,'wq',timing.land)).toMatchObject(pos(motion,'wq',true))
      expect(pose(motion,'wn',timing.land)).toMatchObject(pos(motion,'wn',true))
      expect(motionTrails(motion)).toHaveLength(2)
    }
  })

  it('cover lets the king vacate before the replacement begins moving',()=>{
    const motion=lesson('cover'),timing=sceneTiming(motion.events)
    expect(pose(motion,'wn',timing.followStart)).toMatchObject({...pos(motion,'wn'),lift:0})
    expect(pose(motion,'wk',timing.followStart)).toMatchObject(pos(motion,'wk',true))
    expect(pose(motion,'wn',timing.land)).toMatchObject({...pos(motion,'wn',true),lift:0})
    for(let at=0;at<timing.duration;at+=17)expect(distance(pose(motion,'wk',at),pose(motion,'wn',at))).toBeGreaterThan(.63)
  })

  it('retains an ordinary capture victim until arrival, then fades instead of disappearing early',()=>{
    const motion=lesson('capture'),timing=sceneTiming(motion.events)
    expect(pose(motion,'bn',timing.contact-1)).toMatchObject({opacity:1,visible:true})
    expect(pose(motion,'wr',timing.contact)).toMatchObject(pos(motion,'bn'))
    expect(pose(motion,'bn',timing.captureEnd).opacity).toBe(0)
    expect(pose(motion,'bn',timing.duration).visible).toBe(false)
    expect(pose(motion,'wr',timing.duration)).toMatchObject({opacity:1,visible:true})
  })

  it('keeps the pawn model through travel and swaps models only after promotion arrival',()=>{
    const before=createPosition({pieces:[{id:'wk',side:'white',type:'king',square:'a1'},{id:'bk',side:'black',type:'king',square:'h8'},
      {id:'wp',side:'white',type:'pawn',square:'b7'},{id:'br',side:'black',type:'rook',square:'c8'}]})
    const motion=scene(before,{type:'move',mode:'normal',pieceId:'wp',to:'c8',promotion:'queen'}),timing=sceneTiming(motion.events)
    expect(motion.after.pieces.find(piece=>piece.id==='wp')!.type).toBe('queen')
    for(let at=0;at<=timing.land;at+=5)expect(pose(motion,'wp',at).presentationType).toBe('pawn')
    expect(pose(motion,'wp',timing.promotionStart)).toMatchObject({...squarePoint('c8'),presentationType:'pawn'})
    expect(pose(motion,'wp',timing.promotionEnd)).toMatchObject({...squarePoint('c8'),presentationType:'queen',opacity:1,scale:1})
    expect(timing.energy).toBeGreaterThan(timing.promotionEnd)
    expect(timing.result).toBeGreaterThan(timing.energy)
  })

  it('forced promotion uses the displaced pawn during the push, including an enemy pawn',()=>{
    const before=createPosition({pieces:[{id:'wk',side:'white',type:'king',square:'d3'},{id:'bk',side:'black',type:'king',square:'h8'},
      {id:'wr',side:'white',type:'rook',square:'a4'},{id:'bp',side:'black',type:'pawn',square:'a2'}],energy:{white:5}})
    const motion=scene(before,{type:'ability',mode:'impulse',pieceId:'wr',targetId:'bp'}),timing=sceneTiming(motion.events)
    expect(motion.events).toContainEqual(expect.objectContaining({type:'promotion',pieceId:'bp',forced:true,promotion:'queen'}))
    expect(pose(motion,'bp',timing.contact-1)).toMatchObject({...squarePoint('a2'),presentationType:'pawn'})
    expect(pose(motion,'bp',(timing.contact+timing.land)/2)).toMatchObject({presentationType:'pawn',lift:0})
    expect(pose(motion,'bp',timing.promotionEnd)).toMatchObject({...squarePoint('a1'),presentationType:'queen',opacity:1})
  })

  it.each([
    {side:'white',rank:'1',pawnRank:'2',rookFile:'h',kingTo:'g1'},
    {side:'white',rank:'1',pawnRank:'2',rookFile:'a',kingTo:'c1'},
    {side:'black',rank:'8',pawnRank:'7',rookFile:'h',kingTo:'g8'},
    {side:'black',rank:'8',pawnRank:'7',rookFile:'a',kingTo:'c8'},
  ] as const)('$side castling to $kingTo keeps both bases separated and the rook inside the chassis',({side,rank,pawnRank,rookFile,kingTo})=>{
    const pawns=Array.from({length:8},(_,index)=>({id:`pawn-${index}`,side,type:'pawn' as const,square:String.fromCharCode(97+index)+pawnRank}))
    const before=createPosition({side,pieces:[{id:'king',side,type:'king',square:'e'+rank,castleEligible:true},
      {id:'rook',side,type:'rook',square:rookFile+rank,castleEligible:true},
      {id:'enemy',side:side==='white'?'black':'white',type:'king',square:side==='white'?'e8':'e1'},...pawns]})
    const motion=scene(before,{type:'move',mode:'normal',pieceId:'king',to:kingTo}),timing=sceneTiming(motion.events)
    expect(motion.events.filter(event=>event.type==='move')).toHaveLength(2)
    for(const id of ['king','rook']){
      expect(pose(motion,id,timing.moveStart)).toMatchObject({...pos(motion,id),lift:0})
      expect(pose(motion,id,timing.land)).toMatchObject({...pos(motion,id,true),lift:0})
    }
    for(let at=0;at<=timing.duration;at++){
      const king=pose(motion,'king',at),rook=pose(motion,'rook',at)
      expect(distance(king,rook)).toBeGreaterThan(.63)
      expect(Math.abs(rook.z)+.31).toBeLessThanOrEqual(4.56)
      expect(rook.lift).toBe(0)
      for(const pawn of pawns)expect(distance(rook,squarePoint(pawn.square))).toBeGreaterThan(.63)
    }
    expect(Math.abs(pose(motion,'rook',(timing.moveStart+timing.land)/2).z)).toBeCloseTo(4.22)
    const reduced=sceneTiming(motion.events,true)
    for(let at=0;at<=reduced.duration;at+=3){
      const rook=pose(motion,'rook',at,true)
      expect(rook.z).toBe(pos(motion,'rook').z)
      expect(rook.lift).toBe(0)
      expect(Math.min(distance(rook,pos(motion,'rook')),distance(rook,pos(motion,'rook',true)))).toBe(0)
    }
  })

  it('reduced motion uses only source and destination fades without arcs, scaling or camera movement',()=>{
    for(const id of ['sweep','raid','battery','ram','rotation','cover']){
      const motion=lesson(id),timing=sceneTiming(motion.events,true)
      for(const event of motion.events.filter(event=>event.type==='move')){
        const from=squarePoint(event.from),to=squarePoint(event.to)
        for(let at=0;at<=timing.duration;at+=7){
          const sample=pose(motion,event.pieceId,at,true)
          expect(sample.lift).toBe(0)
          expect(sample.scale).toBe(1)
          expect(Math.min(distance(sample,from),distance(sample,to))).toBe(0)
        }
      }
      expect(motionTrails(motion,true)).toEqual([])
      expect(timing.duration).toBeLessThan(sceneTiming(motion.events).duration)
    }
  })

  it('activation expands only its own model collar and all transient effects expire before unlock',()=>{
    const motion=lesson('form'),timing=sceneTiming(motion.events)
    expect(activationPulseAt(motion,'wn',0)).toBe(0)
    expect(activationPulseAt(motion,'wn',200)).toBeGreaterThan(.5)
    expect(activationPulseAt(motion,'wp',200)).toBe(0)
    expect(activationPulseAt(motion,'wn',timing.duration)).toBe(0)
    for(const id of ['sweep','raid','battery','ram','rotation','cover','form']){
      const current=lesson(id),clock=sceneTiming(current.events)
      expect(effectStrengthAt(clock,clock.moveStart-1)).toBe(0)
      expect(effectStrengthAt(clock,(clock.moveStart+clock.land)/2)).toBeGreaterThan(0)
      expect(effectStrengthAt(clock,clock.effectEnd)).toBe(0)
      expect(effectStrengthAt(clock,clock.duration+100)).toBe(0)
      expect(clock.duration).toBeGreaterThanOrEqual(clock.effectEnd)
    }
    expect(piecePoseAt(motion,'unknown',500)).toBeNull()
  })
})
