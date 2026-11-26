import { applyAction,createGame,editPractice,planIntent } from '../core';
import type { Action,GameState,Localized } from '../core';
export interface Lesson { title:Localized; text:Localized; done:Localized; }
export const LESSONS:Lesson[]=[
 {title:{ru:'Сначала броня',en:'Break the armor'},text:{ru:'Выбери ладью на a6 и ударь босса. Затем атакуй ферзём с c5: открытое тело потеряет здоровье.',en:'Choose the rook on a6 and strike the boss. Then attack with the queen on c5: the exposed body loses health.'},done:{ru:'Ладья сняла броню. Следующий удар дошёл до здоровья. Обе фигуры остались на поле.',en:'The rook removed the armor. The next attack reached health. Both pieces remain on the board.'}},
 {title:{ru:'Удар и отход',en:'Strike and retreat'},text:{ru:'Выбери коня на f5, затем клетку босса. После этого выбери одну из отмеченных клеток отхода.',en:'Choose the knight on f5, then a boss square. Finally choose a highlighted retreat square.'},done:{ru:'Конь ударил и завершил отход одной командой. Отход не делает его неуязвимым.',en:'The knight struck and completed its retreat in one command. Retreat does not make it invulnerable.'}},
 {title:{ru:'Живой заслон',en:'A living shield'},text:{ru:'Пешка прикрывает короля от луча на 2 урона. Нажми «Ответ босса». Затем сравни луч с огнём.',en:'The pawn covers the king from a 2-damage ray. Press Boss response. Then compare the ray with fire.'},done:{ru:'Луч остановился на пешке. Огонь поражает обе клетки, поэтому заслон от него не спасает.',en:'The ray stopped at the pawn. Fire hits both squares, so a blocker cannot protect against it.'}},
 {title:{ru:'Щит расходуется',en:'A shield is consumed'},text:{ru:'Выбери пешку на e2 и нажми «Оборона». Затем дай боссу ответить двумя отдельными ударами по 1.',en:'Choose the pawn on e2 and press Guard. Then let the boss respond with two separate hits of 1.'},done:{ru:'Щит поглотил первый удар и исчез. Второй снял 1 HP. Пешка выжила.',en:'The shield absorbed the first hit and vanished. The second dealt 1 HP. The pawn survived.'}},
 {title:{ru:'Два ответа под защитой',en:'Two protected responses'},text:{ru:'Сыграй «Мраморный обет» на короля и заверши фазу. Следи за фокусом и числом возле знака защиты.',en:'Play Marble Vow on the king and end the phase. Watch focus and the number beside the ward.'},done:{ru:'Карта стоила 5 фокуса. Король не получил урона, а защита осталась ещё на один ответ босса.',en:'The card cost 5 focus. The king took no damage, and protection lasts for one more response.'}},
 {title:{ru:'Подготовь сильный раунд',en:'Prepare a powerful round'},text:{ru:'Используй три команды и заверши фазу. Босс начнёт восстановление. Ударь его в этот момент: атака усилится на 1.',en:'Use three commands and end the phase. The boss will recover. Strike during recovery to deal +1 damage.'},done:{ru:'Ты используешь полный цикл боя: подготовка, ответ босса, затем усиленная атака. Теперь можно выйти на охоту.',en:'You used the full rhythm: preparation, boss response, then a stronger attack. You are ready for a hunt.'}}
];
export function lessonState(index:number,fireComparison=false):GameState{
 let state=createGame({mode:'practice',boss:'regent',difficulty:'knight',bossCards:false,seed:'tutorial-'+index,roundLimit:null});
 const allowed:Record<string,number>=index===0||index===5?{king:4,rook:40,queen:34,...(index===5?{knight:37}:{})}:index===1?{king:4,knight:37}:{king:4,'pawn-e':12};
 state=editPractice(state,{units:state.units.map(u=>({id:u.id,square:allowed[u.id]??null,hp:u.id in allowed?u.maxHp:0})),boss:{anchor:43,armor:index===0?4:0,hp:28}});
 state.intent={name:{ru:'Учебная атака',en:'Practice attack'},pattern:1,rest:false,steps:[],cancelledStep:null,bossCard:null};
 if(index===2)state.intent.steps=fireComparison?
 [{kind:'fire',label:{ru:'Огненная вертикаль',en:'Burning file'},cells:[4,12,20,28,36,44,52,60],damage:1}]:
 [{kind:'rays',label:{ru:'Луч на 2',en:'Ray of 2'},cells:[36,28,20,12,4],rays:[[36,28,20,12,4]],damage:2}];
 if(index===3)state.intent.steps=[0,1].map(()=>({kind:'rays' as const,label:{ru:'Один удар',en:'One hit'},cells:[12],rays:[[12]],damage:1}));
 if(index===4){state=editPractice(state,{hand:['marble-vow'],focus:5});state.intent={name:{ru:'Удар по королю',en:'Strike at the king'},pattern:1,rest:false,steps:[{kind:'rays',label:{ru:'Луч на 2',en:'Ray of 2'},cells:[4],rays:[[4]],damage:2}],cancelledStep:null,bossCard:null};}
 if(index===5){state.round=3;state.boss.combatCount=2;state.boss.nextPattern=3;state.intent=planIntent(state);}
 return state;
}
export function lessonComplete(index:number,before:GameState,after:GameState,action:Action,fireComparison=false):boolean{
 if(index===0)return after.boss.armor===0&&after.boss.hp<28;
 if(index===1)return action.type==='attack'&&action.unitId==='knight';
 if(index===2)return action.type==='end'&&(fireComparison?after.units.find(u=>u.id==='king')?.hp===19:after.units.find(u=>u.id==='king')?.hp===20&&after.units.find(u=>u.id==='pawn-e')?.hp===0);
 if(index===3)return action.type==='end'&&after.units.find(u=>u.id==='pawn-e')?.hp===1&&before.units.find(u=>u.id==='pawn-e')?.shield===1;
 if(index===4)return action.type==='end'&&after.units.find(u=>u.id==='king')?.invulnerable===1;
 return before.intent.rest&&action.type==='attack';
}
export function tutorialProbe(){
 return LESSONS.map((_,index)=>lessonState(index)).every(s=>s.mode==='practice'&&!!s.secret);
}
/** Teaching fixtures only; every player action is still applied by the live rules core. */
export const applyLessonAction=applyAction;
