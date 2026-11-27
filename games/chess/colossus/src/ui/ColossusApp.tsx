import { Component,useCallback,useEffect,useMemo,useRef,useState } from 'react';
import type { ReactNode } from 'react';
import {
 BASE_DECK,BOSSES,BOSS_CARDS,BOSS_CARD_LIST,CAMPAIGN_BOSSES,CARDS,DIFFICULTIES,UNIT_NAMES,applyAction,bossCells,createGame,
 editPractice,getActiveActor,getLeader,legalActions,legalCardActions,previewResponse,restoreGame,squareName,undoGame
} from '../core';
import type { Action,Actor,CardId,CreateOptions,GameState,Language,Seat } from '../core';
import { ColossusOnlineClient } from '../online/client';
import type { RoomSnapshot } from '../online/protocol';
import { Board2D } from './Board2D';
import { Board3D } from './Board3D';
import { Card } from './Card';
import { PieceIcon } from './PieceIcon';
import { Setup } from './Setup';
import { Modal } from './Modal';
import { PracticeEditor } from './PracticeEditor';
import { LESSONS,lessonComplete,lessonState,lessonGuidance,isLessonActionAllowed } from './tutorial';
import { copy,errorText,rarityNames } from './i18n';
import { setSoundEnabled,soundForEvents,soundForTransition,stopSounds,unlockSounds } from './audio';
import { describeAction,useHint } from './useHint';
import { bestHuntResults,retainResultRecords } from './records';
import type { ResultRecord } from './records';
import './colossus.css';
import './experience.css';

const SAVE='colossus.save.v1',PRACTICE='colossus.practice.v1',SETTINGS='colossus.settings.v1',RECORDS='colossus.records.v1',TUTORIAL='colossus.tutorial.v1',ROOM='colossus.room.v1';
interface Preferences {lang:Language;view:'3d'|'2d';sound:boolean;reduced:boolean;theme:'ivory'|'jade'|'bronze'}
interface Saved {state:GameState;options:CreateOptions;attemptId:string}
const rememberRoom=(id:string)=>{try{localStorage.setItem(ROOM,JSON.stringify(id));}catch{/* A valid server session does not depend on local storage. */}};
const read=<T,>(key:string,fallback:T):T=>{try{return JSON.parse(localStorage.getItem(key)??'null')??fallback;}catch{return fallback;}};
function loadSaved(key=SAVE):Saved|null{try{const raw=read<Saved|null>(key,null);if(!raw)return null;return {...raw,state:restoreGame(raw.state)};}catch{return null;}}
function loadRecords():ResultRecord[]{
 const entries=read<unknown>(RECORDS,[]);if(!Array.isArray(entries))return [];
 return entries.filter((r):r is ResultRecord=>!!r&&typeof r==='object'&&Object.hasOwn(BOSSES,r.boss)&&Object.hasOwn(DIFFICULTIES,r.difficulty)&&typeof r.id==='string'&&[r.round,r.lost,r.kingHp,r.armyHp].every(x=>typeof x==='number'&&Number.isFinite(x))&&typeof r.coop==='boolean'&&typeof r.cards==='boolean'&&typeof r.assisted==='boolean'&&['hunt','campaign','practice'].includes(r.mode)).map(r=>({...r,rulesVersion:typeof r.rulesVersion==='string'?r.rulesVersion:undefined,seed:r.seed===null?null:typeof r.seed==='number'&&Number.isFinite(r.seed)?r.seed:undefined}));
}
function preferences():Preferences{const raw=read<Partial<Preferences>>(SETTINGS,{});return{lang:raw.lang==='en'?'en':'ru',view:raw.view==='2d'?'2d':'3d',sound:raw.sound!==false,reduced:raw.reduced??matchMedia('(prefers-reduced-motion: reduce)').matches,theme:raw.theme==='jade'||raw.theme==='bronze'?raw.theme:'ivory'};}
class SceneBoundary extends Component<{children:ReactNode;fallback:ReactNode},{failed:boolean}>{
 state={failed:false};static getDerivedStateFromError(){return{failed:true};}render(){return this.state.failed?this.props.fallback:this.props.children;}
}
function Meter({value,max,type,label}:{value:number;max:number;type:string;label:string}){return <div className={'boss-meter '+type}><span className="meter-label">{label}</span><div className="meter-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}><i style={{width:(max?100*value/max:0)+'%'}}/></div><b>{value}<small>/{max}</small></b></div>}
const sameTargets=(a:string[]=[],b:string[]=[])=>a.length===b.length&&a.every(x=>b.includes(x));

export default function ColossusApp(){
 const stored=useMemo(()=>({normal:loadSaved(),practice:loadSaved(PRACTICE)}),[]);const saved=stored.normal??stored.practice;const [prefs,setPrefs]=useState(preferences);const lang=prefs.lang,c=copy[lang];
 const [game,setGame]=useState<GameState>(()=>saved?.state??createGame({seed:crypto.randomUUID(),bossCards:true}));
 const [options,setOptions]=useState<CreateOptions>(saved?.options??{boss:'regent',difficulty:'knight',mode:'hunt',deck:BASE_DECK,bossCards:true});
 const [attempt,setAttempt]=useState(saved?.attemptId??crypto.randomUUID());const [setup,setSetup]=useState(true);
 const [hasStarted,setHasStarted]=useState(!!saved);const localRun=useRef<Saved|null>(stored.normal);const practiceRun=useRef<Saved|null>(stored.practice);const tutorialReturn=useRef<Saved|null>(null);
 const [selected,setSelected]=useState<string|null>(null);const [actionMode,setActionMode]=useState<'move'|'attack'>('move');
 const [selectedCard,setSelectedCard]=useState<CardId|null>(null);const [cardTargets,setCardTargets]=useState<string[]>([]);const [cardTo,setCardTo]=useState<number|null>(null);const [cardStep,setCardStep]=useState<number|null>(null);
 const [pendingAttack,setPendingAttack]=useState<Array<Extract<Action,{type:'attack'}>>>([]);const [choice,setChoice]=useState<Action[]>([]);
 const [history,setHistory]=useState<GameState[]>([]);const [localSeat,setLocalSeat]=useState<Seat>(()=>saved&&getActiveActor(saved.state)==='B'?'B':'A');
 const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [panel,setPanel]=useState<'rules'|'settings'|'records'|'boss-cards'|'editor'|'online'|null>(null);
 const [lesson,setLesson]=useState<number|null>(null);const [lessonDone,setLessonDone]=useState(false);const [fireComparison,setFireComparison]=useState(false);const [tutorialDone,setTutorialDone]=useState(()=>read<boolean>(TUTORIAL,false)===true);
 const [records,setRecords]=useState<ResultRecord[]>(loadRecords);const [snapshot,setSnapshot]=useState<RoomSnapshot|null>(null);
 const [inviteLink,setInviteLink]=useState('');const [copied,setCopied]=useState(false);
 const client=useRef<ColossusOnlineClient|null>(null);const gameRef=useRef(game);gameRef.current=game;
 const lastNetworkGame=useRef(-1);const lastRoomSnapshot=useRef<RoomSnapshot|null>(null);const [intentOpen,setIntentOpen]=useState(false);
 const actor:Actor=snapshot?snapshot.you:game.coop?localSeat:'solo';
 const paused=!!snapshot?.paused;const active=getActiveActor(game);const leader=getLeader(game);
 const clearSelection=useCallback(()=>{setSelected(null);setSelectedCard(null);setCardTargets([]);setCardTo(null);setCardStep(null);setPendingAttack([]);setChoice([]);},[]);
 const adopt=useCallback((incoming:RoomSnapshot)=>{const connection=client.current;if(!connection)return;const current=connection.snapshot;if(!current||current.id!==incoming.id)return;const s=current.revision>incoming.revision?current:incoming;const previous=lastRoomSnapshot.current;if(previous?.id===s.id&&previous.revision>s.revision)return;lastRoomSnapshot.current=s;setSnapshot(s);if(s.state.revision!==lastNetworkGame.current){lastNetworkGame.current=s.state.revision;setGame(s.state);if(previous?.id===s.id)soundForTransition(previous.state,s.state,`room/${s.id}/${s.state.revision}`);clearSelection();}setBusy(false);},[clearSelection]);
 const disconnect=useCallback(()=>{client.current?.stop();client.current=null;setSnapshot(null);lastNetworkGame.current=-1;lastRoomSnapshot.current=null;setInviteLink('');setCopied(false);try{localStorage.removeItem(ROOM);}catch{/* local storage can be unavailable */}const url=new URL(location.href);url.searchParams.delete('room');url.searchParams.delete('invite');window.history.replaceState({},'',url.pathname+url.search+url.hash);},[]);
 useEffect(()=>{setSoundEnabled(prefs.sound);try{localStorage.setItem(SETTINGS,JSON.stringify(prefs));}catch{/* preferences still work for this session */}},[prefs]);
 useEffect(()=>{if(!hasStarted||snapshot||lesson!==null||!game.secret)return;const save={state:game,options,attemptId:attempt};if(game.mode==='practice')practiceRun.current=save;else localRun.current=save;try{localStorage.setItem(game.mode==='practice'?PRACTICE:SAVE,JSON.stringify(save));}catch{setError(c.saveError);}},[game,options,attempt,snapshot,lesson,c.saveError,hasStarted]);
 useEffect(()=>{if(!game.outcome||lesson!==null||game.mode==='tutorial')return;const id=snapshot?.id??attempt;setRecords(old=>{if(old.some(r=>r.id===id))return old;const record:ResultRecord={id,boss:game.boss.id==='sentinel'?'regent':game.boss.id,difficulty:game.difficulty,mode:game.mode==='tutorial'?'hunt':game.mode,coop:game.coop,cards:game.bossCardsEnabled,round:game.round,lost:game.units.filter(u=>u.hp<=0).length,kingHp:game.units.find(u=>u.type==='K')?.hp??0,armyHp:game.units.filter(u=>u.type!=='K').reduce((n,u)=>n+u.hp,0),winner:game.outcome!.winner,assisted:game.assisted,rulesVersion:game.version,seed:game.secret?.runSeed??null,...(game.mode==='campaign'&&game.outcome!.winner==='army'?{campaignBosses:[...CAMPAIGN_BOSSES]}:{})};const result=retainResultRecords([record,...old]);try{localStorage.setItem(RECORDS,JSON.stringify(result));}catch{/* result stays visible */}return result;});},[game,attempt,snapshot?.id,lesson]);
 useEffect(()=>{const onPageHide=()=>client.current?.stop();window.addEventListener('pagehide',onPageHide);return()=>{window.removeEventListener('pagehide',onPageHide);client.current?.stop();};},[]);
 useEffect(()=>{const query=new URLSearchParams(location.search);const room=query.get('room');const invitation=query.get('invite');const previous=read<string|null>(ROOM,null);if(!room&&!previous)return;const connection=new ColossusOnlineClient();client.current=connection;setBusy(true);
 const work=room&&invitation?connection.join(room,invitation,lang==='ru'?'Командир':'Commander'):connection.load(room??previous!);
 void work.then(s=>{adopt(s);setSetup(false);connection.start(adopt,e=>setError(errorText(e,lang)));rememberRoom(s.id);historyReplaceRoom(s.id);}).catch(e=>{setError(errorText(e,lang));setBusy(false);connection.stop(false);client.current=null;});
 // Reconnect once; changing language does not create or join another room.
 },[]);
 const guidance=useMemo(()=>lesson===null?null:lessonGuidance(lesson,game,fireComparison),[lesson,game,fireComparison]);
 const allActions=useMemo(()=>guidance?(lessonDone?[]:guidance.actions):legalActions(game,undefined,actor),[game,actor,guidance,lessonDone]);
 const unitActions=useMemo(()=>selected?allActions.filter(a=>'unitId' in a&&a.unitId===selected):[],[allActions,selected]);
 const cardActions=useMemo(()=>selectedCard?(guidance?allActions:legalCardActions(game,selectedCard,actor)).filter((a):a is Extract<Action,{type:'card'}>=>a.type==='card'&&a.cardId===selectedCard):[],[game,selectedCard,actor,allActions,guidance]);
 const forecast=useMemo(()=>game.phase==='army'&&!game.mustDiscard?previewResponse(game):null,[game]);
 const validCard=cardActions.filter(a=>sameTargets(a.targets,cardTargets)&&(CARDS[selectedCard!]?.target==='move'?a.to===cardTo:true)&&(CARDS[selectedCard!]?.target==='intent'?a.step===cardStep:true));
 const targetSquares=useMemo(()=>{
  if(pendingAttack.length)return pendingAttack.flatMap(a=>a.retreat===undefined?[]:[a.retreat]);
  if(selectedCard){if(CARDS[selectedCard].target==='move'&&cardTargets.length)return cardActions.filter(a=>sameTargets(a.targets,cardTargets)).flatMap(a=>a.to===undefined?[]:[a.to]);return cardActions.flatMap(a=>(a.targets??[]).map(id=>game.units.find(u=>u.id===id)?.square).filter((s):s is number=>s!==null&&s!==undefined));}
  return actionMode==='move'?unitActions.filter((a):a is Extract<Action,{type:'move'}>=>a.type==='move').map(a=>a.to):[];
 },[pendingAttack,selectedCard,cardTargets,cardActions,game.units,actionMode,unitActions]);
 const attackTargets=selectedCard&&CARDS[selectedCard].target==='boss'?bossCells(game.boss):actionMode==='attack'&&!selectedCard?unitActions.filter((a):a is Extract<Action,{type:'attack'}>=>a.type==='attack').map(a=>a.target):[];
 const currentUnit=game.units.find(u=>u.id===selected);
 const selectionHint=lessonDone?c.correct:pendingAttack.length?c.chooseRetreat:selectedCard?(CARDS[selectedCard].target==='intent'?c.chooseAttack:CARDS[selectedCard].target==='move'&&cardTargets.length?c.chooseCardSquare:c.chooseCardTarget):selected?actionMode==='move'?c.chooseSquare:c.chooseTarget:c.choosePiece;
 const isInteractive=!busy&&!paused&&game.phase==='army'&&!game.mustDiscard&&!setup&&!lessonDone;
 const hintEnabled=game.mode==='practice'&&!game.coop&&!snapshot&&!setup&&game.phase==='army'&&!game.mustDiscard;
 const hint=useHint(game,hintEnabled,()=>setGame(old=>({...old,assisted:true})));
 function menu(){
  stopSounds();client.current?.stop();setPanel(null);clearSelection();hint.cancel();
  if(lesson!==null){setLesson(null);setLessonDone(false);setHistory([]);const previous=tutorialReturn.current;setHasStarted(!!previous);if(previous){setGame(previous.state);setOptions(previous.options);setAttempt(previous.attemptId);setLocalSeat(getActiveActor(previous.state)==='B'?'B':'A');}}
  setSetup(true);
 }
 async function resume(practice=false){
  unlockSounds();hint.cancel();
  if(!practice&&snapshot&&client.current){setBusy(true);try{lastNetworkGame.current=-1;lastRoomSnapshot.current=null;adopt(await client.current.load(snapshot.id));setSetup(false);client.current.start(adopt,e=>setError(errorText(e,lang)));}catch(e){setError(errorText(e,lang));}finally{setBusy(false);}}
  else{const previous=practice?practiceRun.current:localRun.current;if(previous){if(snapshot)disconnect();setGame(previous.state);setOptions(previous.options);setAttempt(previous.attemptId);setHasStarted(true);setLesson(null);setHistory([]);setLocalSeat(getActiveActor(previous.state)==='B'?'B':'A');clearSelection();setSetup(false);}}
 }

 function historyReplaceRoom(id:string){const u=new URL(location.href);u.search='';u.searchParams.set('room',id);window.history.replaceState({},'',u.pathname+u.search);}
 function localAdopt(next:GameState,action?:Action){
  const before=gameRef.current;
  setHistory(old=>next.round===before.round&&next.campaignIndex===before.campaignIndex&&next.phase==='army'&&before.phase==='army'?[...old,before].slice(-30):[]);
  setGame(next);soundForEvents(next.events,{before,after:next,key:`${attempt}/${next.revision}`});clearSelection();
  if(game.coop){const endConsent=next.consents.end.length===1||next.consents.surrender.length===1;setLocalSeat(endConsent?(localSeat==='A'?'B':'A'):(getActiveActor(next)==='B'?'B':'A'));}
  if(lesson!==null&&action&&lessonComplete(lesson,before,next,action,fireComparison))setLessonDone(true);
 }
 async function dispatch(action:Action){
  if(busy||paused)return;setError('');
  if(lesson!==null&&(lessonDone||!isLessonActionAllowed(lesson,game,action,fireComparison))){setError(guidance?.text[lang]??c.finishAction);return;}
  if(action.type==='end'&&forecast?.kingDies&&!window.confirm(c.kingDanger))return;
  if(action.type==='surrender'&&!window.confirm(c.surrenderConfirm))return;
  setBusy(true);
  try{if(snapshot&&client.current){const result=await client.current.action(action);adopt(result.snapshot);}else localAdopt(applyAction(game,action,actor),action);}
  catch(e){setError(errorText(e,lang));}finally{setBusy(false);}
 }
 function chooseActions(actions:Action[]){const promotion=actions.some(a=>a.type==='move'&&a.promotion||a.type==='card'&&a.promotions);if(actions.length===1&&!promotion)void dispatch(actions[0]);else if(actions.length>0)setChoice(actions);}
 function clickSquare(sq:number){
  if(!isInteractive)return;
  if(pendingAttack.length){chooseActions(pendingAttack.filter(a=>a.retreat===sq));return;}
  const unit=game.units.find(u=>u.square===sq);
  if(selectedCard){
   if(unit&&cardActions.some(a=>a.targets?.includes(unit.id))){const max=CARDS[selectedCard].maxTargets;setCardTargets(old=>old.includes(unit.id)?old.filter(x=>x!==unit.id):max===1?[unit.id]:old.length<max?[...old,unit.id]:[...old.slice(1),unit.id]);setCardTo(null);return;}
   if(CARDS[selectedCard].target==='move'&&cardTargets.length&&targetSquares.includes(sq))setCardTo(sq);
   return;
  }
  if(actionMode==='attack'&&attackTargets.includes(sq)){
   const actions=unitActions.filter((a):a is Extract<Action,{type:'attack'}>=>a.type==='attack'&&a.target===sq);
   if(actions.some(a=>a.retreat!==undefined))setPendingAttack(actions);else chooseActions(actions);
   return;
  }
  if(actionMode==='move'&&targetSquares.includes(sq)){chooseActions(unitActions.filter(a=>a.type==='move'&&a.to===sq));return;}
  if(unit){const available=allActions.filter(a=>'unitId' in a&&a.unitId===unit.id);if(guidance&&!available.length)return;setSelected(unit.id);setActionMode(available.some(a=>a.type==='attack')&&!available.some(a=>a.type==='move')?'attack':'move');setPendingAttack([]);}
 }
 function selectCard(id:CardId){setSelected(null);setPendingAttack([]);setSelectedCard(old=>old===id?null:id);setCardTargets([]);setCardTo(null);setCardStep(null);setError('');if(id==='disrupt')setIntentOpen(true);}
 async function start(opts:CreateOptions,network=false){
  stopSounds();unlockSounds();setError('');setBusy(true);hint.cancel();disconnect();clearSelection();setLesson(null);setLessonDone(false);setHistory([]);setHasStarted(false);
  const nextOptions={...opts,seed:crypto.randomUUID()};setOptions(nextOptions);setAttempt(crypto.randomUUID());
  try{
   if(network){const connection=new ColossusOnlineClient();client.current=connection;const response=await connection.create(lang==='ru'?'Командир A':'Commander A',{boss:opts.boss,difficulty:opts.difficulty,mode:opts.mode==='campaign'?'campaign':'hunt',deck:opts.deck,bossCards:opts.bossCards});
    const u=new URL(location.href);u.search='';u.searchParams.set('room',response.snapshot.id);u.searchParams.set('invite',response.invite);setInviteLink(u.toString());adopt(response.snapshot);setSetup(false);connection.start(adopt,e=>setError(errorText(e,lang)));rememberRoom(response.snapshot.id);historyReplaceRoom(response.snapshot.id);setPanel('online');
   }else{setGame(createGame(nextOptions));setHasStarted(true);setLocalSeat('A');setSetup(false);window.history.replaceState({},'',location.pathname);}
  }catch(e){setError(errorText(e,lang));setSetup(true);}finally{setBusy(false);}
 }
 async function join(link:string,name:string){
  setError('');setBusy(true);hint.cancel();disconnect();setHasStarted(false);try{const u=new URL(link,location.href);const id=u.searchParams.get('room'),token=u.searchParams.get('invite');if(!id||!token)throw new Error('invite');const connection=new ColossusOnlineClient();client.current=connection;const state=await connection.join(id,token,name);adopt(state);setSetup(false);connection.start(adopt,e=>setError(errorText(e,lang)));rememberRoom(id);historyReplaceRoom(id);setLesson(null);}catch(e){setError(errorText(e,lang));}finally{setBusy(false);}
 }
 async function networkCommand(command:Parameters<ColossusOnlineClient['send']>[0]){
  if(!client.current)return;setBusy(true);setError('');try{adopt((await client.current.send(command)).snapshot);}catch(e){setError(errorText(e,lang));}finally{setBusy(false);}
 }
 function beginLesson(index=0,fire=false){stopSounds();unlockSounds();hint.cancel();setAttempt('tutorial-'+crypto.randomUUID());if(lesson===null)tutorialReturn.current=hasStarted&&game.secret&&!snapshot?{state:game,options,attemptId:attempt}:null;disconnect();setLesson(index);setFireComparison(fire);setLessonDone(false);setGame(lessonState(index,fire));setSetup(false);setHistory([]);setLocalSeat('A');clearSelection();setPanel(null);setError('');}
 function nextLesson(){hint.cancel();if(lesson===null)return;stopSounds();if(lesson===3&&!fireComparison){beginLesson(3,true);return;}if(lesson<LESSONS.length-1){beginLesson(lesson+1);return;}setTutorialDone(true);try{localStorage.setItem(TUTORIAL,'true');}catch{/* tutorial completion remains in session */}const previous=tutorialReturn.current;if(previous){setLesson(null);setLessonDone(false);setGame(previous.state);setOptions(previous.options);setAttempt(previous.attemptId);setHasStarted(true);setLocalSeat(getActiveActor(previous.state)==='B'?'B':'A');setHistory([]);clearSelection();setError('');}else void start({...options,coop:false,mode:'hunt',boss:'regent'});}
 function undo(){if(lesson!==null||snapshot||game.coop)return;const previous=history.at(-1);if(!previous)return;stopSounds();try{setGame(undoGame(game,previous));setHistory(old=>old.slice(0,-1));clearSelection();}catch(e){setError(errorText(e,lang));}}
 function retry(){stopSounds();unlockSounds();hint.cancel();if(snapshot){void start({boss:game.boss.id==='sentinel'?'regent':game.boss.id,difficulty:game.difficulty,mode:game.mode==='tutorial'?'hunt':game.mode,deck:game.selectedDeck,bossCards:game.bossCardsEnabled,coop:true},true);return;}disconnect();setHasStarted(true);setGame(createGame(options));setAttempt(crypto.randomUUID());setHistory([]);setSetup(false);clearSelection();setError('');}
 const boardProps={state:game,lang,selected,targets:targetSquares,attackTargets,onSquare:clickSquare,preview:forecast,guideSquares:guidance?.focusSquares??[],reducedMotion:prefs.reduced,theme:prefs.theme,disabled:!isInteractive};
 const wins=records.filter(r=>r.winner==='army'&&!r.assisted&&(r.mode==='hunt'||r.mode==='campaign'));const life=game.units.find(u=>u.type==='K')!;
 const resultTitle=game.outcome?.winner==='army'?(game.mode==='campaign'?c.campaignComplete:c.victory):game.outcome?.reason==='limit'?c.limit:c.defeat;
 const upcoming=[3,8,13].find(r=>r>game.round);
 const networkRecovery=snapshot&&<div className="mandatory-network-controls">
  {snapshot.paused&&<p>{snapshot.status==='waiting'?c.waitingPartner:c.onlinePaused}</p>}
  {snapshot.paused&&!snapshot.canTakeover&&snapshot.takeoverAt!==null&&<small>{c.takeoverAfter} {Math.max(0,Math.ceil((snapshot.takeoverAt-snapshot.serverTime)/1000))} {c.seconds}</small>}
  {snapshot.canTakeover&&<button type="button" className="primary-button" disabled={busy} onClick={()=>void networkCommand({type:'takeover'})}>{c.takeover}</button>}
  {snapshot.returnRequested&&snapshot.state.control===snapshot.you&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>void networkCommand({type:'restore-control',accept:true})}>{c.acceptReturn}</button>}
  {snapshot.state.control!=='shared'&&snapshot.state.control!==snapshot.you&&<button type="button" className="secondary-button" disabled={busy||!!snapshot.returnRequested} onClick={()=>void networkCommand({type:'request-return'})}>{snapshot.returnRequested?c.pending:c.returnControl}</button>}
  <button type="button" className="secondary-button" onClick={menu}>{c.menu}</button>
 </div>;
 const bestHunts=bestHuntResults(records,false),assistedHunts=bestHuntResults(records,true);
 const recordCard=(r:ResultRecord)=><article key={r.id}><b>{BOSSES[r.boss].name[lang]}</b><span>{DIFFICULTIES[r.difficulty].name[lang]} · {r.mode==='campaign'?c.campaign:r.mode==='practice'?c.practice:c.hunt} · {r.coop?c.coop:c.solo} · {r.cards?c.bossCardsOn:c.bossCardsOff}{r.assisted?' · '+c.training:''}</span><span>{r.winner==='army'?c.victory:c.defeat} · {c.round} {r.round} · {c.losses} {r.lost} · ♔ {r.kingHp} HP · {c.army} {r.armyHp} HP</span></article>;
 const board=<SceneBoundary key={prefs.view} fallback={<><div className="scene-fallback-note" role="status">{c.fallback3d}</div><Board2D {...boardProps}/></>}>{prefs.view==='3d'?<Board3D {...boardProps}/>:<Board2D {...boardProps}/>}</SceneBoundary>;

 return <div className={'colossus-app '+(prefs.reduced?'reduce-motion':'')+' theme-'+prefs.theme} data-game="colossus" onPointerDownCapture={unlockSounds} onKeyDownCapture={unlockSounds}>
 <header className="top-rail"><button type="button" className="wordmark" onClick={menu}>COLOSSUS<span>Iva Games</span></button><div className="top-tools">
 {!setup&&<button type="button" onClick={menu}>{c.menu}</button>}
 <button type="button" onClick={()=>setPanel('rules')} aria-label={c.help}>?</button>
 <button type="button" onClick={()=>{setSoundEnabled(!prefs.sound);unlockSounds();setPrefs(old=>({...old,sound:!old.sound}));}} aria-label={prefs.sound?c.sound:c.muted} aria-pressed={prefs.sound}>{prefs.sound?'♪':'♩'}</button>
 <button type="button" onClick={()=>setPanel('settings')} aria-label={c.settings}>⚙</button>
 <button type="button" className="language-switch" onClick={()=>setPrefs(old=>({...old,lang:old.lang==='ru'?'en':'ru'}))}>{lang==='ru'?'EN':'RU'}</button>
 </div></header>
 {setup?<Setup lang={lang} initial={options} records={records} tutorialDone={tutorialDone} hasSave={!!localRun.current||!!snapshot} hasPractice={!!practiceRun.current} onContinue={practice=>void resume(practice)} onStart={(o,n)=>void start(o,n)} onTutorial={()=>beginLesson()} onJoin={(l,n)=>void join(l,n)} busy={busy} error={error}/>:
 <main className={'battle-layout'+(lesson!==null?' is-tutorial':'')}>
 <section className="arena-column">
 <div className="boss-heading"><div><span className="mode-caption">{lesson!==null?c.tutorial:game.mode==='campaign'?c.campaign+' '+(game.campaignIndex+1)+'/'+CAMPAIGN_BOSSES.length:snapshot?c.online:game.coop?c.coop:game.mode==='practice'?c.practice:c.hunt} · {DIFFICULTIES[game.difficulty].name[lang]}</span><h1>{BOSSES[game.boss.id].name[lang]}</h1></div><div className="round-counter"><span>{c.round}</span><b>{game.round}<small>/{game.roundLimit??'∞'}</small></b></div></div>
 <div className="boss-bars"><Meter value={game.boss.armor} max={game.boss.maxArmor} type="armour" label={c.armour}/><Meter value={game.boss.hp} max={game.boss.maxHp} type="health" label={c.health}/></div>
 <div className="arena-surface">{board}<div className="board-view-toggle"><button type="button" onClick={()=>setPrefs(old=>({...old,view:old.view==='3d'?'2d':'3d'}))}>{prefs.view==='3d'?c.view2d:c.view3d}</button></div>
 {game.phase==='finished'&&lesson===null&&<div className="result-overlay" role="status"><span className="result-seal">{game.outcome?.winner==='army'?'✦':'◇'}</span><h2>{resultTitle}</h2><p>{game.outcome?.winner==='army'?c.armySaved:game.outcome?.reason==='king-dead'?c.kingFell:''}</p><div className="result-numbers"><span>{c.round}: {game.round}</span><span>{c.losses}: {game.units.filter(u=>u.hp<=0).length}</span><span>♔ {life.hp} HP</span></div><p className="result-category">{game.bossCardsEnabled?c.bossCardsOn:c.bossCardsOff}{game.assisted||game.mode==='practice'?' · '+c.training:''}</p><div><button type="button" className="primary-button" onClick={retry}>{c.retry}</button><button type="button" className="secondary-button" onClick={menu}>{c.newHunt}</button></div></div>}
 </div>
 <div className="command-bar"><div className="command-resource"><span>{c.commands}</span><div aria-label={game.commands+' '+c.commands}>{Array.from({length:Math.max(DIFFICULTIES[game.difficulty].commands,game.commands)},(_,i)=><i key={i} className={i<game.commands?'full':''}/>)}</div></div>
 <div className="selection-controls">{currentUnit?<><span className="selected-piece"><PieceIcon kind={currentUnit.type}/><b>{UNIT_NAMES[currentUnit.type][lang]}</b><small>{currentUnit.hp}/{currentUnit.maxHp}</small></span><div className="piece-actions"><button type="button" className={actionMode==='move'?'active':''} disabled={!isInteractive||!unitActions.some(a=>a.type==='move')} onClick={()=>{setActionMode('move');setPendingAttack([]);}}>{c.move}</button><button type="button" className={actionMode==='attack'?'active':''} disabled={!isInteractive||!unitActions.some(a=>a.type==='attack')} onClick={()=>setActionMode('attack')}>{c.attack}</button><button type="button" disabled={!isInteractive||!unitActions.some(a=>a.type==='guard')} onClick={()=>void dispatch({type:'guard',unitId:currentUnit.id})}>{c.guard}</button></div></>:<span className="selection-hint">{selectionHint}</span>}</div>
 <button type="button" className="end-button" disabled={busy||paused||!allActions.some(a=>a.type==='end')} onClick={()=>void dispatch({type:'end'})}>{c.end}</button></div>
 {pendingAttack.length>0&&<div className="target-instruction" role="status">{c.chooseRetreat}<button type="button" onClick={()=>setPendingAttack([])}>{c.cancel}</button></div>}
 {game.coop&&<div className="coop-bar"><span>{c.commander} {active} · {snapshot?(actor===active?c.yourTurn:c.partnerTurn):c.localCoop}</span>{!snapshot&&<div className="segmented">{(['A','B'] as const).map(seat=><button type="button" className={actor===seat?'active':''} key={seat} onClick={()=>{setLocalSeat(seat);clearSelection();}}>{seat}</button>)}</div>}<button type="button" disabled={!allActions.some(a=>a.type==='transfer')||busy||paused} onClick={()=>void dispatch({type:'transfer'})}>{c.transfer}</button>{(game.consents.end.length===1||game.consents.surrender.length===1)&&<b>{c.consent}</b>}</div>}
 </section>
 <aside className={'intent-column '+(intentOpen?'expanded':'')}>
 <button type="button" className="intent-mobile-toggle" aria-expanded={intentOpen} onClick={()=>setIntentOpen(x=>!x)}><span>{c.intent}: <b>{game.intent.name[lang]}</b></span><span>{intentOpen?'−':'+'}</span></button>
 <div className="intent-content"><div className="section-heading"><h2>{c.intent}</h2><span className={game.intent.rest?'rest-mark':'intent-mark'}>{game.intent.rest?'◇':'⌁'}</span></div><h3 className="intent-name">{game.intent.name[lang]}</h3>
 {game.intent.rest?<p className="rest-copy">{c.restHint}</p>:<ol className="intent-steps">{game.intent.steps.map((step,index)=><li key={index} className={(game.intent.cancelledStep===index?'cancelled ':'')+(forecast?.blockedSteps.includes(index)?'blocked':'')}>
 <button type="button" disabled={selectedCard!=='disrupt'||!cardActions.some(a=>a.step===index)} className={cardStep===index?'chosen':''} onClick={()=>{setCardStep(index);setIntentOpen(false);}}><span className={'step-symbol '+step.kind}>{step.kind==='move'?'↳':step.kind==='fire'?'♨':step.kind==='area'?'◇':'⟶'}</span><span><b>{step.label[lang]}</b><small>{step.kind==='move'?(step.path??[]).map(squareName).join(' → '):step.damage+' '+(lang==='ru'?'урона':'damage')}{step.requires!==undefined?' · '+(lang==='ru'?'после движения':'after movement'):''}</small></span>{game.intent.cancelledStep===index&&<i>×</i>}</button>
 </li>)}</ol>}
 {game.intent.bossCard&&<div className="announced-card"><span>{c.bossCards}</span><Card card={BOSS_CARDS[game.intent.bossCard]} lang={lang} compact onClick={()=>setPanel('boss-cards')}/></div>}
 <div className="forecast"><h3>{c.forecast}</h3>{forecast&&Object.entries(forecast.damage).some(([,v])=>v>0)?<div className="forecast-pieces">{Object.entries(forecast.damage).filter(([,v])=>v>0).map(([id,damage])=>{const u=game.units.find(x=>x.id===id)!;return <span key={id} className={forecast.deaths.includes(id)?'fatal':''}><PieceIcon kind={u.type}/><b>−{damage}</b>{forecast.deaths.includes(id)&&<i>×</i>}</span>})}</div>:<p>{c.noDamage}</p>}</div>
 {game.bossCardsEnabled&&<button type="button" className="boss-deck-peek" onClick={()=>setPanel('boss-cards')}><span className="tiny-card-fan"><i/><i/><i/></span><span><b>{c.bossCards}</b><small>{upcoming?c.nextDraw+': '+upcoming:c.allDrawn}</small></span></button>}
 <div className="army-strip" aria-label={c.health}>{game.units.map(u=><button type="button" key={u.id} className={(u.hp<=0?'fallen ':'')+(u.activated?'spent':'')} disabled={u.hp<=0} onClick={()=>{setSelected(u.id);setSelectedCard(null);setActionMode('move');}} aria-label={UNIT_NAMES[u.type][lang]+' '+u.hp+' HP'}><PieceIcon kind={u.type}/><span>{u.hp}</span></button>)}</div>
 {hintEnabled&&<div className="hint-panel"><button type="button" disabled={hint.thinking||busy} onClick={hint.request}>{hint.thinking?c.hintThinking:c.hint}</button>{hint.thinking&&<button type="button" onClick={hint.cancel}>{c.cancel}</button>}{hint.action&&<><p>{describeAction(hint.action,game,lang)}</p><small>{c.hintScope}</small><button type="button" onClick={()=>{if(hint.action)void dispatch(hint.action);}}>{c.apply}</button></>}{hint.failed&&<p>{c.hintUnavailable}</p>}<small>{c.hintAssisted}</small></div>}
 <div className="battle-extra"><button type="button" disabled={lesson!==null||!history.length||!!snapshot||game.coop} onClick={undo}>{c.undo}</button>{game.mode==='practice'&&lesson===null&&<><button type="button" onClick={()=>setPanel('editor')}>{c.editor}</button><button type="button" onClick={retry}>{c.reset}</button></>}<button type="button" onClick={()=>void dispatch({type:'surrender'})} disabled={game.phase!=='army'||busy||paused}>{c.surrender}</button></div>
 </div></aside>
 <section className="hand-section" hidden={lesson!==null&&lesson!==5}><div className="hand-heading"><h2>{c.hand}</h2><span className="focus-resource"><i>✦</i><b>{game.focus}</b><small>/5</small> {c.focus.toLowerCase()}</span><span className="draw-count">{c.drawLeft}: {game.deckRemaining}</span></div>
 <div className="hand-cards">{game.hand.map(id=><Card key={id} card={CARDS[id]} lang={lang} selected={selectedCard===id} compact unavailable={game.cardPlayed||game.focus<CARDS[id].cost||actor!==leader} onClick={()=>selectCard(id)}/>)}</div>
 {selectedCard&&!game.mustDiscard&&<div className={'card-target-panel '+CARDS[selectedCard].rarity}><div><h3>{CARDS[selectedCard].name[lang]} <small>{rarityNames[CARDS[selectedCard].rarity][lang]}</small></h3><p>{CARDS[selectedCard].description[lang]}</p><span>{cardTargets.map(id=>{const u=game.units.find(x=>x.id===id)!;return UNIT_NAMES[u.type][lang]+' '+squareName(u.square!);}).join(', ')}{cardTo!==null?' → '+squareName(cardTo):''}</span>{!cardActions.length&&<small className="card-unavailable-reason">{game.cardPlayed?c.cardUsed:game.focus<CARDS[selectedCard].cost?c.insufficient:actor!==leader?c.partnerTurn:c.unavailable}</small>}</div><button type="button" className="primary-button" disabled={!validCard.length||busy||paused} onClick={()=>chooseActions(validCard)}>{c.apply}</button><button type="button" className="icon-button" onClick={()=>setSelectedCard(null)} aria-label={c.cancel}>×</button></div>}
 </section>
 {lesson!==null&&<section className="tutorial-banner" role="status"><span className="lesson-number">{lesson+1}<small>/{LESSONS.length}</small></span><div><h3>{LESSONS[lesson].title[lang]}</h3><p>{lessonDone?(lesson===3&&!fireComparison?(lang==='ru'?'Пешка приняла луч и спасла короля. Теперь проверим ту же позицию с огнём.':'The pawn took the ray and saved the king. Now compare the same position with fire.'):LESSONS[lesson].done[lang]):guidance?.text[lang]}</p></div><button type="button" className="tutorial-skip" onClick={menu}>{lang==='ru'?'В меню':'Menu'}</button><button type="button" className="secondary-button" onClick={()=>beginLesson(lesson,fireComparison)}>{c.lessonReset}</button><button type="button" className="primary-button" disabled={!lessonDone} onClick={nextLesson}>{lesson===3&&!fireComparison?c.compareFire:lesson===LESSONS.length-1?c.tutorialDone:c.nextLesson}</button></section>}
 {snapshot&&(snapshot.paused||snapshot.returnRequested||snapshot.restoreScheduled||snapshot.state.control!=='shared')&&<div className="online-banner" role="status"><b>{snapshot.status==='waiting'?c.waitingPartner:snapshot.paused?c.partnerAway:snapshot.restoreScheduled?c.returnNext:c.soloControl+' · '+snapshot.state.control}</b>{snapshot.status==='waiting'&&<button type="button" onClick={()=>setPanel('online')}>{c.invitation}</button>}{snapshot.canTakeover&&<button type="button" onClick={()=>void networkCommand({type:'takeover'})}>{c.takeover}</button>}{snapshot.returnRequested&&snapshot.state.control===snapshot.you&&<button type="button" onClick={()=>void networkCommand({type:'restore-control',accept:true})}>{c.acceptReturn}</button>}{snapshot.state.control!=='shared'&&snapshot.state.control!==snapshot.you&&<button type="button" onClick={()=>void networkCommand({type:'request-return'})}>{c.returnControl}</button>}</div>}
 </main>}
 {error&&<div className="toast" role="alert"><span>{error}</span>{client.current?.hasPendingCommand()&&<button type="button" onClick={()=>{setBusy(true);void client.current!.retryPending().then(r=>{adopt(r.snapshot);setError('');}).catch(e=>setError(errorText(e,lang))).finally(()=>setBusy(false));}}>{c.retrySend}</button>}<button type="button" onClick={()=>setError('')} aria-label={c.close}>×</button></div>}
 {!setup&&game.mustDiscard&&<Modal title={c.discard} dismissible={false} onClose={()=>{}}><p>{actor===leader?c.discardPrompt:c.partnerTurn+' · '+c.commander+' '+leader}</p>{networkRecovery}<div className="card-collection">{game.hand.map(id=><Card key={id} card={CARDS[id]} lang={lang} unavailable={actor!==leader||paused} onClick={actor===leader&&!paused?()=>void dispatch({type:'discard',cardId:id}):undefined}/>)}</div></Modal>}
 {!setup&&(game.phase==='promotion'||choice.length>0)&&<Modal title={c.promote} dismissible={game.phase!=='promotion'} onClose={()=>setChoice([])}><p>{actor===active?c.promotionHp:c.partnerTurn+' · '+c.commander+' '+active}</p>{networkRecovery}<div className="promotion-choices">{(choice.length?choice:allActions.filter(a=>a.type==='promote')).map((action,i)=>{const kind=action.type==='move'||action.type==='promote'?action.promotion:action.type==='card'?Object.values(action.promotions??{})[0]:undefined;return <button type="button" key={i} onClick={()=>{setChoice([]);void dispatch(action);}}>{kind&&<PieceIcon kind={kind}/>}<span>{kind?UNIT_NAMES[kind][lang]:c.apply}</span></button>})}</div></Modal>}
 {!setup&&game.phase==='camp'&&<Modal title={c.camp} dismissible={false} onClose={()=>{}}><p>{actor===active?c.campText:c.partnerTurn+' · '+c.commander+' '+active}</p>{networkRecovery}<div className="camp-army">{game.units.map(u=><span key={u.id} className={u.hp<=0?'fallen':''}><PieceIcon kind={u.type}/>{u.hp}/{u.maxHp}</span>)}</div><div className="camp-choices">{allActions.filter((a):a is Extract<Action,{type:'camp'}>=>a.type==='camp').map((a,i)=><button type="button" key={i} className="secondary-button" onClick={()=>void dispatch(a)}>{a.reviveId?c.revive+' · '+UNIT_NAMES[game.units.find(u=>u.id===a.reviveId)!.type][lang]:a.healId?c.heal+' · '+UNIT_NAMES[game.units.find(u=>u.id===a.healId)!.type][lang]:c.leaveCamp}</button>)}</div></Modal>}
 {panel&&<Modal title={panel==='boss-cards'?c.catalog:panel==='online'?c.invitation:panel==='editor'?c.editor:c[panel==='rules'?'help':panel]} onClose={()=>setPanel(null)} className={panel==='boss-cards'?'boss-catalog-modal':''}>
 {panel==='rules'&&<><p className="rules-prose">{c.rulesText}</p><p>{c.bossCardRule}</p><p>{c.cardHint}</p><button type="button" className="primary-button" onClick={()=>beginLesson()}>{c.learnAgain}</button></>}
 {panel==='boss-cards'&&<><p>{c.bossCardRule}</p><div className="boss-card-catalog">{BOSS_CARD_LIST.filter(card=>card.boss===game.boss.id).map(card=><Card key={card.id} card={card} lang={lang} selected={game.intent.bossCard===card.id} status={game.intent.bossCard===card.id?c.intent:game.bossDiscard.includes(card.id)?c.usedCard:game.bossHand.includes(card.id)?c.waitingCard:c.future}/>)}</div></>}
 {panel==='settings'&&<div className="settings-list"><label className="check-row"><input type="checkbox" checked={prefs.sound} onChange={e=>{setSoundEnabled(e.target.checked);unlockSounds();setPrefs(old=>({...old,sound:e.target.checked}));}}/>{c.sound}</label><label className="check-row"><input type="checkbox" checked={prefs.reduced} onChange={e=>setPrefs(old=>({...old,reduced:e.target.checked}))}/>{c.reduced}</label><div className="segmented"><button type="button" className={prefs.view==='3d'?'active':''} onClick={()=>setPrefs(old=>({...old,view:'3d'}))}>3D</button><button type="button" className={prefs.view==='2d'?'active':''} onClick={()=>setPrefs(old=>({...old,view:'2d'}))}>2D</button></div><label className="field-label">{c.themeAll}<select value={prefs.theme} onChange={e=>setPrefs(old=>({...old,theme:e.target.value as Preferences['theme']}))}><option value="ivory">{c.ivory}</option><option value="jade" disabled={wins.length<1}>{c.jade} · 1 {lang==='ru'?'победа':'victory'}</option><option value="bronze" disabled={!wins.some(r=>r.mode==='campaign')&&new Set(wins.map(r=>r.boss)).size<3}>{c.bronze} · 3 {lang==='ru'?'босса':'bosses'}</option></select></label><button type="button" className="secondary-button" onClick={()=>setPanel('records')}>{c.records}</button>{snapshot&&<button type="button" className="secondary-button" onClick={()=>setPanel('online')}>{c.room}</button>}</div>}
 {panel==='records'&&<div className="records-list"><h3>{c.bestHunts}</h3><p>{c.rankingRule}</p>{bestHunts.length?bestHunts.map(recordCard):<p>{c.noRecords}</p>}{assistedHunts.length>0&&<><h3>{c.assistedHunts}</h3>{assistedHunts.map(recordCard)}</>}<details className="record-history" open={!bestHunts.length&&!assistedHunts.length}><summary>{c.history} · {records.length}</summary><div>{records.map(recordCard)}</div></details></div>}
 {panel==='editor'&&<PracticeEditor state={game} lang={lang} error={error} onApply={patch=>{try{const edited=editPractice(game,patch);stopSounds();setGame(edited);setHistory([]);clearSelection();setPanel(null);setError('');}catch(e){setError(errorText(e,lang));}}}/>}
 {panel==='online'&&<div className="online-controls">{snapshot&&<p>{c.room} · {snapshot.id.slice(0,8)} · {c.commander} {snapshot.you}</p>}<p>{snapshot?.players.A?.name} & {snapshot?.players.B?.name??c.waitingPartner}</p><input readOnly value={inviteLink} aria-label={c.invitation}/><button type="button" className="primary-button" onClick={()=>{void(async()=>{try{let link=inviteLink;if(!link&&client.current&&snapshot){const token=await client.current.invite();const u=new URL(location.href);u.search='';u.searchParams.set('room',snapshot.id);u.searchParams.set('invite',token);link=u.toString();setInviteLink(link);}await navigator.clipboard.writeText(link);setCopied(true);}catch(e){setError(errorText(e,lang));}})();}}>{copied?c.copied:c.copyLink}</button><button type="button" className="secondary-button" onClick={menu}>{c.retire}</button></div>}
 </Modal>}
 </div>
}
