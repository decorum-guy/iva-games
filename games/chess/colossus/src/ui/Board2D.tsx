import { useState } from 'react';
import { bossCells,squareName,UNIT_NAMES,BOSSES } from '../core';
import type { GameState,Language,ResponsePreview } from '../core';
import { PieceIcon,BossIcon } from './PieceIcon';
import { copy } from './i18n';
export interface BoardProps {
 state:GameState;lang:Language;selected:string|null;targets:number[];attackTargets:number[];onSquare:(square:number)=>void;
 preview:ResponsePreview|null;reducedMotion?:boolean;theme?:'ivory'|'jade'|'bronze';disabled?:boolean;
}
export function squareLabel(p:BoardProps,square:number){
 const u=p.state.units.find(x=>x.square===square);const boss=bossCells(p.state.boss).includes(square);
 return squareName(square)+(u?' '+UNIT_NAMES[u.type][p.lang]+' '+u.hp+'/'+u.maxHp+' HP':boss?' '+BOSSES[p.state.boss.id].name[p.lang]:'')+
  (p.targets.includes(square)?' '+copy[p.lang].chooseSquare:'')+(p.preview?.threatenedCells.includes(square)?' '+copy[p.lang].intent:'');
}
export function Board2D(p:BoardProps){
 const [focus,setFocus]=useState(4);const body=bossCells(p.state.boss);const anchor=body[Math.floor((body.length-1)/2)];
 return <div className="board-flat-wrap" role="group" aria-label={copy[p.lang].board}>
 <div className="board-flat" role="grid" aria-label={copy[p.lang].board} data-testid="board-2d">
 {Array.from({length:64},(_,i)=>{const sq=(7-Math.floor(i/8))*8+i%8;const unit=p.state.units.find(u=>u.square===sq);
 const target=p.targets.includes(sq),attack=p.attackTargets.includes(sq),threat=p.preview?.threatenedCells.includes(sq),fire=p.state.fire.includes(sq);
 return <button type="button" role="gridcell" key={sq} data-square={squareName(sq)} aria-label={squareLabel(p,sq)} aria-selected={unit?.id===p.selected} tabIndex={focus===sq?0:-1}
 className={['square',(Math.floor(sq/8)+sq%8)%2?'light':'dark',target?'legal':'',attack?'attack-target':'',threat?'threat':'',fire?'burning':'',unit?.id===p.selected?'unit-selected':'',body.includes(sq)?'boss-square':''].join(' ')}
 onFocus={()=>setFocus(sq)} onClick={()=>!p.disabled&&p.onSquare(sq)}
 onKeyDown={e=>{const offset:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:8,ArrowDown:-8};if(e.key in offset){e.preventDefault();const next=sq+offset[e.key];if(next>=0&&next<64&&(!(e.key==='ArrowRight'||e.key==='ArrowLeft')||Math.floor(next/8)===Math.floor(sq/8))){setFocus(next);e.currentTarget.parentElement?.querySelector<HTMLButtonElement>('[data-square="'+squareName(next)+'"]')?.focus();}}}}>
 {sq%8===0&&<span className="coordinate rank">{Math.floor(sq/8)+1}</span>}{sq<8&&<span className="coordinate file">{String.fromCharCode(97+sq%8)}</span>}
 {threat&&<span className="threat-pattern" aria-hidden="true"/>}
 {unit&&<span className={'flat-unit '+(unit.activated?'activated':'')+' '+(unit.invulnerable?'immune':'')}><PieceIcon kind={unit.type}/><span className="unit-health"><b>{unit.hp}</b>{unit.shield>0&&<em>⬡{unit.shield}</em>}{unit.invulnerable>0&&<em>◇{unit.invulnerable}</em>}</span>{unit.activated&&<span className="activated-dot" aria-label={copy[p.lang].spent}/>}</span>}
 {sq===anchor&&<BossIcon id={p.state.boss.id} className={'flat-boss '+(p.state.intent.rest?'resting':'')}/>}
 {target&&!unit&&<span className="legal-dot" aria-hidden="true"/>}{attack&&<span className="attack-mark" aria-hidden="true">✧</span>}
 </button>})}
 </div></div>
}

