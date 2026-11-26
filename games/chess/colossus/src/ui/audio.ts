import type { GameEvent } from '../core/types';
const bank=new Map<string,HTMLAudioElement>();
let enabled=false;
export function setSoundEnabled(value:boolean){enabled=value;}
export function playSound(name:string){if(!enabled)return;let sound=bank.get(name);if(!sound){sound=new Audio('/assets/colossus/audio/'+name+'.wav');sound.volume=.45;bank.set(name,sound);}sound.currentTime=0;void sound.play().catch(()=>{});}
export function soundForEvents(events:GameEvent[]){
 if(events.some(e=>e.type==='victory'))return playSound('victory');
 if(events.some(e=>e.type==='defeat'))return playSound('defeat');
 if(events.some(e=>e.type==='card'||e.type==='boss-card'))return playSound('card');
 if(events.some(e=>e.type==='fire'))return playSound('fire');
 if(events.some(e=>e.type==='damage'))return playSound('wound');
 if(events.some(e=>e.type==='attack'))return playSound(events.some(e=>(e.armor??0)>0)?'armour':'stone');
 if(events.some(e=>e.type==='shield'))return playSound('shield');
 if(events.some(e=>e.type==='move'))playSound('move');
}

