import type { BossId, UnitType } from '../core/types';
export const pieceSymbols: Record<UnitType,string>={K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙'};
const shapes:Record<UnitType,string>={
 P:'M23 57h34l-4-8H27ZM29 47h22l-6-17a10 10 0 1 0-10 0Z',
 R:'M20 60h40l-3-8H23ZM25 49h30l-4-25h6V12h-8v7h-6v-7h-7v7h-6v-7h-8v12h7Z',
 B:'M20 60h40l-4-8H24ZM27 49h26L46 33c14-12 1-24-6-30l-4 15 6 4-9 9-2-5c-4 5 2 10 4 10Z',
 N:'M19 60h41l-4-8H23ZM25 49h28l-8-20 13 7 4-10-17-15-3-8-7 8-7-5-9 24 10 9Z',
 Q:'M18 60h44l-4-8H22ZM26 49h28l-4-20 10-16-15 8L40 5l-5 16-15-8 10 16Z',
 K:'M19 60h42l-4-8H23ZM26 49h28l-7-22H33ZM35 26h10V14h10V7H45V0H35v7H25v7h10Z'
};
export function PieceIcon({kind,className=''}:{kind:UnitType;className?:string}){
 return <svg className={'piece-icon '+className} viewBox="0 0 80 66" aria-hidden="true"><path d={shapes[kind]} fill="currentColor" stroke="var(--piece-outline, #66543a)" strokeWidth="1.5" strokeLinejoin="round"/><path d="M27 56h26M31 46h18" stroke="var(--piece-outline, #66543a)" strokeWidth="1.4"/></svg>;
}
export function BossIcon({id,className=''}:{id:BossId;className?:string}){
 return <svg className={'boss-icon '+className} viewBox="0 0 100 100" aria-hidden="true">
 {id==='regent'?<><path d="M20 38 33 18h34l13 20-7 37H27Z" fill="currentColor"/><path d="M12 48h17v34H12ZM71 48h17v34H71ZM29 78h14v14H29ZM57 78h14v14H57Z" fill="currentColor"/><path d="M38 35h24v12H38ZM49 49v23M30 43l13 9M70 43 57 52" stroke="#eac48a" strokeWidth="3"/></>:id==='spire'?<><path d="M48 8 65 36 58 62 78 87H22l20-25-7-26Z" fill="currentColor"/><path d="m50 17-4 31 9 11-7 22M34 64 18 24M64 64l18-40" fill="none" stroke="#eac48a" strokeWidth="3"/></>:<><path d="M49 24 18 13v58l31 17ZM51 24l31-11v58L51 88Z" fill="currentColor"/><path d="m25 28 17 7M25 41l17 7M25 54l17 7M75 28l-17 7M75 41l-17 7M75 54l-17 7M50 20V91" stroke="#eac48a" strokeWidth="3"/></>}
 </svg>;
}

