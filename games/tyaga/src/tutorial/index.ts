import { distance } from '../core/math';
import type { TutorialView } from '../core/types';
import type { TyagaWorld } from '../server-world/world';
const LESSONS:Omit<TutorialView,'step'|'total'|'completed'>[]=[
  {title:{ru:'Сначала — своими ногами',en:'Start on your own two feet'},instruction:{ru:'Пройдите несколько шагов и прыгните. На клавиатуре — WASD и пробел.',en:'Walk a few steps and jump. Use WASD and Space on a keyboard.'}},
  {title:{ru:'Почувствуйте вес',en:'Feel the weight'},instruction:{ru:'Возьмите лёгкую балку за ручку и перенесите её на метр.',en:'Grab the light beam by its handle and carry it one metre.'},targetId:'training-light'},
  {title:{ru:'Вдвоём легче',en:'Two pairs of hands'},instruction:{ru:'Возьмите тяжёлый настил. Попросите бота «Помоги нести» и сдвиньте его вместе.',en:'Grab the heavy deck. Ask your bot to help carry, then move it together.'},targetId:'training-heavy'},
  {title:{ru:'Два ремня',en:'Two straps'},instruction:{ru:'Снимите и снова закрепите два ремня на малом грузе. Выберите две проушины.',en:'Remove and reattach two straps on a small cargo. Select two attachment rings.'},targetId:'cargo-2'},
  {title:{ru:'В горку',en:'Up the slope'},instruction:{ru:'Сядьте за руль и поднимитесь на учебный склон. Затем остановитесь.',en:'Enter the cab and drive up the training slope, then stop.'},targetId:'truck'},
  {title:{ru:'Тянем с опоры',en:'Pull from a secure anchor'},instruction:{ru:'Установите якорь в грунт, подключите лебёдку и потяните. Остановите барабан при росте нагрузки.',en:'Install an anchor in soil, connect the winch and pull. Stop the drum when the load rises.'},targetId:'training-anchor'},
  {title:{ru:'Настил на опорах',en:'A supported deck'},instruction:{ru:'Подведите раскрытый настил к двум опорам и закрепите его проушины.',en:'Bring an unfolded deck onto the two supports and fasten its rings.'},targetId:'training-heavy'},
  {title:{ru:'Стоянка и возврат',en:'Save camp and return'},instruction:{ru:'Соберите машину, грузы и команду в учебной стоянке. Сохраните её и предложите возврат.',en:'Gather the truck, cargo and crew in the training camp. Save it, then request a return.'}},
];
export function tutorialView(w:TyagaWorld):TutorialView{const t=w.state.tutorial;return{step:t.step,total:8,completed:t.completed,...(LESSONS[t.step]??{title:{ru:'Можно в экспедицию',en:'Ready for an expedition'},instruction:{ru:'Выберите любую карту. Помощник отправится вместе с вами.',en:'Choose any map. Your helper will join you.'}})};}
export function advanceTutorial(w:TyagaWorld):void{
  if(w.map.id!=='tutorial'||w.state.tutorial.completed)return;const t=w.state.tutorial;const human=Object.values(w.state.characters).find(c=>!c.participant.bot);if(!human)return;
  const actor=w.body(human.bodyId);const events=w.state.events.filter(e=>e.tick>=t.stepStartedAt);
  let complete=false;
  if(t.step===0)complete=human.grounded&&distance(actor.translation(),t.stepStartPosition)>=2&&events.some(e=>e.type==='jump'&&e.participantId===human.participant.participantId);
  else if(t.step===1){const item=w.maybeBody('training-light');if(item&&human.holding?.itemId==='training-light'){if(t.flags['light-x']===undefined){t.flags['light-x']=item.translation().x;t.flags['light-z']=item.translation().z;}complete=Math.hypot(item.translation().x-t.flags['light-x'],item.translation().z-t.flags['light-z'])>=1;}}
  else if(t.step===2){const holders=Object.values(w.state.characters).filter(c=>c.holding?.itemId==='training-heavy');const deck=w.maybeBody('training-heavy');if(holders.length>=2&&deck){if(t.flags['heavy-x']===undefined){t.flags['heavy-x']=deck.translation().x;t.flags['heavy-z']=deck.translation().z;}if(holders.some(c=>c.controller.kind==='human'&&Math.hypot(w.inputs[c.participant.participantId]?.moveX??0,w.inputs[c.participant.participantId]?.moveZ??0)>.2))t.flags['heavy-walking']=1;complete=Boolean(t.flags['heavy-walking'])&&Math.hypot(deck.translation().x-t.flags['heavy-x'],deck.translation().z-t.flags['heavy-z'])>.6;}}
  else if(t.step===3)complete=Object.keys(t.flags).filter(key=>key.startsWith('secured:')).length>=2&&Object.values(w.state.links).filter(l=>!l.broken&&l.kind==='strap'&&(l.fromId==='cargo-2'||l.toId==='cargo-2')).length>=2;
  else if(t.step===4){const truck=w.body('truck');complete=truck.translation().y>2&&Math.abs(truck.linvel().x)<.4;}
  else if(t.step===5){const anchor=Object.values(w.state.entities).some(e=>e.kind==='anchor'&&e.anchored);const rope=Object.values(w.state.links).find(l=>l.kind==='rope'&&!l.broken);if(anchor&&rope){if(t.flags['rope-length']===undefined)t.flags['rope-length']=rope.length;complete=t.flags['rope-length']-rope.length>.3&&!Object.values(w.inputs).some(i=>i.tool>0);}}
  else if(t.step===6)complete=Object.values(w.state.links).filter(l=>l.kind==='deck'&&!l.broken).length>=2;
  else if(t.step===7)complete=t.checkpointDone&&w.state.rewinds>0;
  if(complete){t.step++;t.stepStartedAt=w.state.tick;t.stepStartPosition={...actor.translation()};t.flags={};t.completed=t.step>=8;if(!t.completed){w.state.checkpointId=`tutorial-lesson-${t.step}`;w.state.pendingCheckpointId=w.state.checkpointId;}w.emit(t.completed?'tutorial-complete':'tutorial-step',undefined,human.participant.participantId,t.step);}
}
