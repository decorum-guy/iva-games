import { useCallback,useEffect,useRef,useState } from 'react';
import { CARDS,UNIT_NAMES,publicView,squareName } from '../core';
import type { Action,GameState,Language } from '../core';
import { copy } from './i18n';

/** Only visible state crosses into this worker; a revision change invalidates its answer. */
export function useHint(state:GameState,enabled:boolean,onAssisted:()=>void){
 const worker=useRef<Worker|null>(null);
 const latest=useRef(state);latest.current=state;
 const requestId=useRef<string|null>(null);
 const [action,setAction]=useState<Action|null>(null);
 const [thinking,setThinking]=useState(false);
 const [failed,setFailed]=useState(false);
 const cancel=useCallback(()=>{
  worker.current?.terminate();worker.current=null;requestId.current=null;
  setThinking(false);setAction(null);setFailed(false);
 },[]);
 useEffect(()=>{cancel();return()=>worker.current?.terminate();},[state.revision,enabled,cancel]);
 useEffect(()=>{
  const hide=()=>{if(document.hidden)cancel();};
  document.addEventListener('visibilitychange',hide);
  return()=>{document.removeEventListener('visibilitychange',hide);worker.current?.terminate();};
 },[cancel]);
 const request=()=>{
  if(!enabled)return;
  cancel();onAssisted();setThinking(true);
  const id=crypto.randomUUID(),revision=latest.current.revision;
  requestId.current=id;
  try{
   const current=new Worker(new URL('../engine/search.worker.ts',import.meta.url),{type:'module'});
   worker.current=current;
   current.onmessage=(event:MessageEvent<{requestId:string;revision:number;error?:string;result?:{action:Action|null}}>)=>{
    const result=event.data;
    if(result.requestId!==requestId.current||result.revision!==latest.current.revision)return;
    setAction(result.result?.action??null);setFailed(!!result.error||!result.result?.action);setThinking(false);
    current.terminate();worker.current=null;
   };
   current.onerror=()=>{if(requestId.current===id){setFailed(true);setThinking(false);}current.terminate();worker.current=null;};
   current.postMessage({requestId:id,revision,state:publicView(latest.current)});
  }catch{setFailed(true);setThinking(false);}
 };
 return{action,thinking,failed,request,cancel};
}

export function describeAction(action:Action,state:GameState,lang:Language):string{
 const c=copy[lang];
 const unitName=(id:string)=>{const unit=state.units.find(u=>u.id===id);return unit?UNIT_NAMES[unit.type][lang]+(unit.square===null?'':' '+squareName(unit.square)):'';};
 switch(action.type){
  case 'move':return c.move+': '+unitName(action.unitId)+' → '+squareName(action.to)+(action.promotion?' · '+UNIT_NAMES[action.promotion][lang]:'');
  case 'attack':return c.attack+': '+unitName(action.unitId)+' → '+squareName(action.target)+(action.retreat!==undefined?' · '+(lang==='ru'?'отход':'retreat')+' '+squareName(action.retreat):'');
  case 'guard':return c.guard+': '+unitName(action.unitId);
  case 'card':return CARDS[action.cardId].name[lang]+(action.targets?.length?' · '+action.targets.map(unitName).join(', '):'')+(action.to!==undefined?' → '+squareName(action.to):'')+(action.step!==undefined?' · '+state.intent.steps[action.step]?.label[lang]:'');
  case 'discard':return c.discard+': '+CARDS[action.cardId].name[lang];
  case 'promote':return c.promote+': '+unitName(action.unitId)+' → '+UNIT_NAMES[action.promotion][lang];
  case 'camp':return action.reviveId?c.revive+': '+unitName(action.reviveId):action.healId?c.heal+': '+unitName(action.healId):c.leaveCamp;
  case 'end':return c.end;
  case 'transfer':return c.transfer;
  case 'surrender':return c.surrender;
 }
}

