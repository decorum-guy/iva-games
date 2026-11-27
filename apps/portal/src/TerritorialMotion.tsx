import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import type { Resource, TerritoryView } from '@iva-games/district/territorial';
import { ResourceIcon } from './TerritorialResources';

type Flight = { id: string; resource: Resource; amount: number; x: number; y: number; dx: number; dy: number; delay: number; tileId: string };
/** Only newly observed authoritative roll allocations fly. Historical grants and
 * reconnect catch-up are deliberately silent; the hand always shows real stock. */
export function TerritorialIncomeMotion({view,root,reduceMotion,disconnected}: {
  view: TerritoryView; root: RefObject<HTMLElement | null>; reduceMotion: boolean; disconnected: boolean;
}) {
  const previous = useRef<{match:string; revision:number; seenAt:number} | null>(null);
  const suspended = useRef(false);
  const [flights,setFlights] = useState<Flight[]>([]);
  useEffect(()=>{
    const suspend = () => { suspended.current=true; setFlights([]); };
    const visibility = () => { if (document.visibilityState !== 'visible') suspend(); };
    document.addEventListener('visibilitychange',visibility);
    window.addEventListener('offline',suspend);
    window.addEventListener('resize',suspend);
    return ()=>{document.removeEventListener('visibilitychange',visibility);window.removeEventListener('offline',suspend);window.removeEventListener('resize',suspend);};
  },[]);
  useEffect(()=>{
    const now=Date.now(), before=previous.current;
    previous.current={match:view.matchId,revision:view.revision,seenAt:now};
    if(disconnected||document.visibilityState!=='visible'||!navigator.onLine) { suspended.current=true;setFlights([]);return; }
    const quiet=suspended.current; suspended.current=false;
    if(reduceMotion||window.matchMedia('(prefers-reduced-motion: reduce)').matches) {setFlights([]);return;}
    if(!before||before.match!==view.matchId||quiet||now-before.seenAt>7000||before.revision>=view.revision||!root.current) return;
    const board=root.current.querySelector('.tb-surface');
    if(!board) return;
    const bounds=board.getBoundingClientRect();
    const entries=(view.history??[]).filter(entry=>entry.kind==='roll'&&entry.revision>before.revision&&entry.sources?.length);
    const next: Flight[]=[];
    for(const entry of entries) {
      for(const source of entry.sources??[]) {
        if(source.ownerId!==view.you.participantId||source.amount<=0)continue;
        const tile=root.current.querySelector('[data-tile-origin="'+CSS.escape(source.tileId)+'"]');
        const hand=root.current.querySelector('.territory-hand [data-resource="'+source.resource+'"] .ta-resource-art');
        if(!tile||!hand)continue;
        const a=tile.getBoundingClientRect(),b=hand.getBoundingClientRect();
        const x=a.left+a.width/2,y=a.top+a.height/2;
        if(!a.width||!b.width||x<bounds.left||x>bounds.right||y<bounds.top||y>bounds.bottom)continue;
        next.push({id:entry.id+':'+next.length,resource:source.resource,amount:source.amount,tileId:source.tileId,x,y,dx:b.left+b.width/2-x,dy:b.top+b.height/2-y,delay:Math.min(next.length*85,400)});
      }
    }
    if(next.length)setFlights(current=>[...current,...next].slice(-24));
  },[view,root,reduceMotion,disconnected]);
  useEffect(()=>{
    if(!flights.length)return;
    const ids=new Set(flights.map(f=>f.id));
    const timer=window.setTimeout(()=>setFlights(current=>current.filter(f=>!ids.has(f.id))),1600);
    return ()=>window.clearTimeout(timer);
  },[flights]);
  return <div className="territory-income-motion" aria-hidden="true">{flights.map(f=><span key={f.id} className="territory-income-flight" data-source-tile={f.tileId} data-resource={f.resource}
    style={{'--x':f.x+'px','--y':f.y+'px','--dx':f.dx+'px','--dy':f.dy+'px','--delay':f.delay+'ms'} as CSSProperties}
    onAnimationEnd={()=>setFlights(current=>current.filter(item=>item.id!==f.id))}><ResourceIcon resource={f.resource}/>{f.amount>1&&<b>+{f.amount}</b>}</span>)}</div>;
}
