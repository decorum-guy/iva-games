import { HUNT_BOSSES } from '../core';
import type { BossId,GameState,HuntBossId } from '../core';

export interface ResultRecord {
 id:string;boss:BossId;difficulty:GameState['difficulty'];mode:GameState['mode'];
 coop:boolean;cards:boolean;round:number;lost:number;kingHp:number;armyHp:number;
 winner:string;assisted:boolean;
 /** Missing on records written before metadata was introduced. */
 rulesVersion?:string|null;
 /** Public online state intentionally has no seed. */
 seed?:number|null;
 /** Bosses actually defeated by this campaign; absent only on legacy records. */
 campaignBosses?:HuntBossId[];
}

// Historical records predate roster snapshots and always describe this original march.
const LEGACY_CAMPAIGN_BOSSES:readonly HuntBossId[]=['regent','spire','archivist'];
export function earnedBossIds(record:ResultRecord):HuntBossId[]{
 if(record.winner!=='army'||record.assisted||(record.mode!=='hunt'&&record.mode!=='campaign'))return [];
 const candidates:unknown=record.mode==='campaign'
  ?record.campaignBosses===undefined?LEGACY_CAMPAIGN_BOSSES:record.campaignBosses
  :[record.boss];
 if(!Array.isArray(candidates))return [];
 return [...new Set(candidates.filter((id):id is HuntBossId=>typeof id==='string'&&HUNT_BOSSES.includes(id as HuntBossId)))];
}
export function bossWinDifficulties(records:readonly ResultRecord[],boss:HuntBossId):Set<GameState['difficulty']>{
 return new Set(records.filter(record=>earnedBossIds(record).includes(boss)).map(record=>record.difficulty));
}

export function compareHuntResults(a:ResultRecord,b:ResultRecord):number{
 return a.round-b.round||a.lost-b.lost||b.kingHp-a.kingHp||b.armyHp-a.armyHp;
}
export function resultCategory(record:ResultRecord):string{
 return [record.boss,record.difficulty,record.coop?'coop':'solo',record.cards?'cards':'ordinary',record.assisted?'assisted':'unassisted'].join(':');
}
/** Only completed hunts compete; campaign, practice and losses stay in history. */
export function bestHuntResults(records:ResultRecord[],assisted:boolean):ResultRecord[]{
 const best=new Map<string,ResultRecord>();
 for(const record of records){
  if(record.mode!=='hunt'||record.winner!=='army'||record.assisted!==assisted)continue;
  const category=resultCategory(record),previous=best.get(category);
  if(!previous||compareHuntResults(record,previous)<0)best.set(category,record);
 }
 return [...best.values()].sort((a,b)=>resultCategory(a).localeCompare(resultCategory(b)));
}


/** Keep category leaders and earned medals when trimming recent-attempt history. */
export function retainResultRecords(records:ResultRecord[],recentLimit=100):ResultRecord[]{
 const keep=new Set(records.slice(0,recentLimit).map(r=>r.id));
 for(const record of [...bestHuntResults(records,false),...bestHuntResults(records,true)])keep.add(record.id);
 const medals=new Set<string>();
 for(const record of records){
  const keys=earnedBossIds(record).map(boss=>boss+':'+record.difficulty);
  if(record.mode==='campaign'&&record.winner==='army'&&!record.assisted)keys.push('campaign:'+record.difficulty);
  for(const key of keys){
   if(!medals.has(key)){medals.add(key);keep.add(record.id);}
  }
 }
 return records.filter(record=>keep.has(record.id));
}
