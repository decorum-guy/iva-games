import { expect, it } from 'vitest';
import { TyagaWorld } from '../src/server-world/world';
import { observedGround } from '../src/bots';
import { clamp, V } from '../src/core/math';

it('Quarry junctions share the real main-road grade and bots query the actual triangle surface',async()=>{
 const w=await TyagaWorld.create({matchId:'junction-geometry-fixture',mapId:'quarry',mode:'practice',participants:[{participantId:'human',displayName:'Human',seatIndex:0,bot:false},{participantId:'other',displayName:'Other',seatIndex:1,bot:false}]});
 try{
  const view=w.view('human');
  for(const x of [83,84,85,86,87,88,89,90,91])for(const z of [46.8,48,49.2]){
   const expected=-4+4*clamp((x-72)/18,0,1),physical=w.ground(V(x,4,z),10)?.point.y,observed=observedGround(view,V(x,2,z));
   expect(physical).toBeCloseTo(expected,3);expect(observed).toBeCloseTo(physical!,3);
  }
  // Inside the mesh's bounding box but outside the actual road footprint.
  expect(w.ground(V(80.5,2,60),10)).toBeNull();expect(observedGround(view,V(80.5,2,60))).toBeNull();
 }finally{w.dispose();}
});
