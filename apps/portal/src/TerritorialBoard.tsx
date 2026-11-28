import { useId, useMemo, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import type { TerritoryBlockade, TerritoryMap, TerritoryView } from '@iva-games/district/territorial';
import { distanceToRoad, houseOutline, roadHitLine, coastPath as traceCoast, territoryCoastLoops } from './territorialBoardGeometry';
import { TerritorialCoast } from './TerritorialCoast';
import './territorial-board.css';

export type BoardSelection = { kind: 'tile' | 'node' | 'edge'; id: string };
export type TerritorialSelection = BoardSelection;
type Point = { x: number; y: number };
type Terrain = 'wood' | 'brick' | 'grain' | 'wool' | 'ore' | 'bare';
interface BoardProps {
  map: TerritoryMap;
  lang: 'ru' | 'en';
  buildings: Record<string, { ownerId: string; level: 1 | 2 }>;
  routes: Record<string, string>;
  players: { participantId: string; seatIndex: number; displayName: string }[];
  blockedTileId: string | null;
  selection: BoardSelection | null;
  onSelect: (target: BoardSelection) => void;
  candidates?: readonly string[];
  newsArea?: { sectorId: string; kind: 'risk' | 'applied' } | null;
  rolledTileIds?: readonly string[];
  highlightedRoadIds?: readonly string[];
  blockade?: TerritoryBlockade | null;
  blockMode?: boolean;
  activeEffects?: TerritoryView['activeEffects'];
}

const terrainNames = {
  wood: ['Лес', 'Forest'], brick: ['Глиняный карьер', 'Clay pit'], grain: ['Пашня', 'Cropland'],
  wool: ['Пастбище', 'Pasture'], ore: ['Рудник', 'Mine'], bare: ['Пустошь', 'Heath']
} as const;
const terrainPaint = {
  wood: ['#97bb70', '#55855e'], brick: ['#e6a576', '#c37b55'], grain: ['#eed57e', '#c6ad58'],
  wool: ['#b5ce87', '#83a76e'], ore: ['#b9b9ac', '#8d9c98'], bare: ['#f4d5b0', '#dbad90']
} as const;
const coastalTerrainPaint = {
  wood: ['#83ae78', '#438466'], brick: ['#efb27e', '#cc805e'], grain: ['#f5d565', '#d4aa49'],
  wool: ['#bdd78c', '#89b16c'], ore: ['#b9c4c0', '#829ba0'], bare: ['#f6dec2', '#d9a98f'],
} as const;
const ownerColors = ['#ca4e37', '#2867a8', '#79498f', '#2c7954'];
const asPoints = (points: Point[]) => points.map(({ x, y }) => x + ',' + y).join(' ');
const limit = (n: number, low: number, high: number) => Math.max(low, Math.min(n, high));
const keyOf = (s: BoardSelection) => s.kind + ':' + s.id;

function TerrainArt({ kind, heathForm }: { kind: Terrain; heathForm: number }) {
  switch (kind) {
    case 'wood': return <g>{[[-17,-3,0.77],[-4,-6,0.96],[7,0,0.77],[-10,5,0.83]].map(([x,y,s], i) =>
      <g key={i} transform={`translate(${x} ${y}) scale(${s})`}><ellipse cx="3" cy="4" rx="7" ry="2.7" fill="#355945" opacity=".25"/><path d="M0 5v-7" stroke="#725c3e" strokeWidth="2.9"/><path d="M-7 1 -4 -5 -6 -4 0 -16 5 -6 3 -7 7 1 1 3z" fill="#326a51"/><path d="M0 -16 0 2 -7 1 -4 -5 -6 -4z" fill="#568659"/></g>)}</g>;
    case 'brick': return <g strokeLinejoin="round"><path d="m-22 4 10-11 16-3 12 6-4 7-22 6z" fill="#ab6847"/><path d="m-22 2 11-11 15-3 12 6-7 1-4-2-12 4-6 6z" fill="#f1bd87"/><path d="m-16 5 8-7 11-4m-12 12 9-7 10-2" fill="none" stroke="#d78d62" strokeWidth="2.5"/><path d="m6 5 6-2 4 2-7 3z" fill="#8c654e"/></g>;
    case 'grain': return <g><path d="m-22 -1 20-10 17 7-19 12z" fill="#a7904f"/><path d="m-22 -3 20-10 17 7-19 12z" fill="#d0ae4d"/>{[-10,-6,-2,2,6,10].map(n=><path key={n} d={`M${n-8} ${-4+(n+10)*.41}l17 -9`} stroke="#f6d86e" strokeWidth="2.3"/>)}<path d="m-5 7 18-10" stroke="#8d8450" strokeWidth="1.6"/></g>;
    case 'wool': return <g><path d="M-21 5q13-11 33-5M-17 8q13-8 25-5" fill="none" stroke="#75975f" strokeWidth="1.5"/>{[[-10,-5],[4,-2],[-4,4]].map(([x,y],i)=><g transform={`translate(${x} ${y})`} key={i}><ellipse cx="1" cy="3" rx="5" ry="1.6" fill="#6d865a"/><ellipse cx="0" cy="0" rx="4.1" ry="2.8" fill="#fcf0d5"/><circle cx="3.6" cy=".7" r="1.6" fill="#596151"/></g>)}</g>;
    case 'ore': return <g><path d="m-23 7 10-17 6 5 8-12 15 23-14 5z" fill="#697e7b"/><path d="m-23 7 10-17-1 10-4 5zm17-1 7-23 3 10-3 2 6 9z" fill="#d4d4c3"/><path d="m-14 0 1-10 6 5-1 4zm15-17 15 23-10-2-4-9 3-2z" fill="#879592"/><path d="m-5 8 6-3 8 1 4 3-10 2z" fill="#586e70"/></g>;
    case 'bare':
      if (heathForm === 2) return <g className="tb-heath-art" strokeLinejoin="round">
        <path d="m-26 8 16-8 9 1 13-6 13 9-14 9-20 1Z" fill="#c89777"/>
        <path d="M-18 9-12-9l7-4 11 2 6 4 4 14-7-2-3-11-7-2-4 3-3 12Z" fill="#ae7454"/>
        <path d="m-12-9 7-5 13 2 6 6-8-1-9-3Z" fill="#f8d4a3"/>
        <path d="m-15 1 5-2m-4 5 5-2m17-5 5 1m-5 3 7 2" fill="none" stroke="#dfa775" strokeWidth="1.7"/>
        <path d="m-23 12 11-2 6 2m6 1 8-2 8 1" fill="none" stroke="#f6ddb1" strokeWidth="1.4"/>
      </g>;
      if (heathForm === 3) return <g className="tb-heath-art" strokeLinejoin="round">
        <path d="m-29 8 14-10 12 2 11-6 20 6-14 11-18 3Z" fill="#c79882"/>
        <path d="m-21 6 9-9 11 1 3 6-10 7Zm23 0 8-10 9 1 6 4-12 7Z" fill="#f5e4cb"/>
        <path d="m-20 8 12 4 11-6m1 1 10 3 11-7" fill="none" stroke="#b78269" strokeWidth="1.8"/>
        <path d="m-9 0 4 3-2 4m17-9 2 3 5 1m-25 13 10-2 6 2" fill="none" stroke="#d4b49e" strokeWidth="1.2"/>
      </g>;
      return <g className="tb-heath-art" strokeLinejoin="round">
      <path d="M-31 10q9-11 19-9l13 4 14-9q7-3 14 1-7 2-13 8L2 15q-16-5-33-5Z" fill="#cc9a79"/>
      <path d="M-31 10q12-14 21-12 6 1 13 6L-9 2q-8 0-22 8Z" fill="#fbe5bc"/>
      <path d="M0 12q9-9 19-14 6-3 12-1-9 1-15 7L6 13Z" fill="#f7d4a3"/>
      <g fill="none" strokeLinecap="round">
        <path d="m0 4 1-8-3-7m3 8 6-5 2-6M0-6l-6-2-2-5m13 7 5 1 4-3" stroke="#84583f" strokeWidth="2.8"/>
        <path d="m0 4 1-7m1 0 5-5" stroke="#b5855d" strokeWidth="1.2"/>
        <path d="m-19 14 7-2 6 2 6-1m-6 1 2 4m12-4 7-3 5 1" stroke="#a47b65" strokeWidth="1.1"/>
        <path d="M-21 6q5-4 10-4m25 7 6-3" stroke="#fbe6bf" strokeWidth="1.2"/>
      </g>
    </g>;
  }
}

// Terrain variation uses only the published address. It carries no match entropy.
function TerrainDetail({ kind, variant }: { kind: Terrain; variant: number }) {
  const x = variant % 2 === 0 ? -22 : 21;
  return <g transform={`translate(${x} ${variant % 3 === 0 ? 6 : 1})`} opacity=".85">
    {kind === 'wood' && <g><path d="m-5 1 6-3 4 2-6 3z" fill="#966f45"/><path d="m-6-1 6-3 5 2-6 3z" fill="#b18a52"/><ellipse cx="-4.5" cy=".5" rx="1.9" ry="1.5" fill="#e0bd81"/></g>}
    {kind === 'brick' && <g fill="#a76748" stroke="#deaa77" strokeWidth=".7"><path d="m-4-1 5-2 4 2-4 2z"/><path d="m-7 2 5-2 4 2-4 2z"/><path d="m0 3 5-2 4 2-4 2z"/></g>}
    {kind === 'ore' && <g><path d="m-5 2 4-6 4-1 5 7-7 3z" fill="#7e8c83"/><path d="m-5 2 4-6 4-1-2 4-1 2z" fill="#c2c6b6"/></g>}
    {kind === 'grain' && <g fill="none" stroke="#967b38" strokeLinecap="round"><path d="m-3 4 2-8m2 7 3-7m-2 4 2-.5m-4-.5-2-2m2 1 2-2" strokeWidth="1.2"/></g>}
    {kind === 'wool' && <g fill="none" stroke="#6e8f60" strokeWidth="1.4" strokeLinecap="round"><path d="m-4 2 3-2m-1 2 4-1m2-2 2-1"/></g>}
  </g>;
}

/** Landscape silhouettes sit above the token line and never receive pointer input. */
function CoastalTerrain({ kind, variant }: { kind: Terrain; variant: number }) {
  switch (kind) {
    case 'wood': return <g>
      <path d="M-31-5q11-15 25-11 15-7 30 6L10 0-13 4Z" fill="#528966"/>
      <path d="m-28-7 6-12 6 12-4-1 4 5-11 1 3-5zm34-6 5-10 6 10-3-1 4 5-12 1 3-6Z" fill="#39705c"/>
      <path d="m-22-19-4 9 4-2zm33-4-3 8 4-2Z" fill="#76aa82"/>
      <path d="m16 2 7-3 5 1-6 3Z" fill="#819c65"/>
    </g>;
    case 'grain': return <g>
      <path d="m-31-4 17-10 11 4-17 12Z" fill="#c58f39"/>
      <path d="m-26-4 15-8m-11 10 15-8m-10 9 13-8" fill="none" stroke="#f8e390" strokeWidth="1.5"/>
      <path d="m12-16 7-1 2 4-6 2-4-2Z" fill="#a77939"/>
      <path d="m11-16 7-3 5 3-8 2Z" fill="#ffe49d"/>
      <path d="M15-17v4m4-5v4" stroke="#c79040"/>
    </g>;
    case 'brick': return <g>
      <path d="m-30-8 13-9 13 1 12-4 15 5-11 6-15 1-15 7Z" fill="#b87957"/>
      <path d="m-29-9 13-9 13 1 10-4 15 5-15-2-8 4-14-1Z" fill="#f5c99e"/>
      <path d="m16 1 4-2 5 2-4 3Zm-2 3 4-2 4 2-4 3Z" fill="#a8664a" stroke="#d89b70" strokeWidth=".8"/>
    </g>;
    case 'wool': return <g>
      <path d="M-31-3q10-17 26-10 15-13 32-1-13-3-24 5-17-6-34 6Z" fill="#77a469"/>
      <path d="M-27-4q10-10 20-8m10 0q10-8 20-3" fill="none" stroke="#d2dc95" strokeWidth="1.6"/>
      <g transform={`translate(${variant % 2 ? 19 : -21} 1)`} fill="#ffe7a0">
        <circle cx="-3" cy="1" r="1.25"/><circle cx="0" cy="-1" r="1.4"/><circle cx="3" cy="1" r="1"/>
      </g>
    </g>;
    case 'ore': return <g>
      <path d="m-29 0 10-16 7 5 9-13 12 8 5-4 12 16-20-4-20 6Z" fill="#739092"/>
      <path d="m-27-2 8-14 4 3-4-1-3 8Zm17-9 7-13 8 5-7-1-4 7Z" fill="#d7ddd0"/>
      <path d="m10 5 7-3 9 2-8 4Z" fill="#697f80"/>
      <path d="m17 3 3 2 3-1" fill="none" stroke="#c5b68a" strokeWidth="1.2"/>
    </g>;
    default: return null;
  }
}

function House({ level, color, seat }: { level: number; color: string; seat: number }) {
  return <g className="tb-house" pointerEvents="none">
    <ellipse cx="2" cy="3.7" rx={level===2?13:10} ry="4.7" fill="#273f39" opacity=".35"/>
    <path className="tb-house-outline" d={houseOutline(level)} />
    {level === 2 && <g transform="translate(-6 -2)"><path d="m-5-10 7-3 6 3v9L1 2-5-1z" fill="#dbc399" stroke="#495650" strokeWidth="1"/><path d="m-6-10 3-6 7-3 5 8-7 3z" fill={color} stroke="#495650" strokeWidth="1"/><path d="M-1-8v3m4-5v3" stroke="#556266" strokeWidth="1.8"/></g>}
    <path d="M-8-8 0-11 9-7V1L1 5-8 1z" fill="#f4dfae" stroke="#435654" strokeWidth="1"/>
    <path d="M1-4 9-7V1L1 5z" fill="#c0aa84"/>
    <path d="m-10-8 5-9 8-3 8 11-10 5z" fill={color} stroke="#3b4b4f" strokeWidth="1.3"/>
    <path d="m-10-8 5-9 6 13z" fill="#fff0c8" opacity=".5"/>
    <path d="M-5-5v3m3-2v3" stroke="#615e50" strokeWidth="1.8"/>
    <text x="4.9" y=".8" transform="rotate(-12 5 0)" textAnchor="middle" fontSize="5.8" fontWeight="900" fill="#263f42">{seat+1}</text>
  </g>;
}

type PortResource = TerritoryMap['ports'][number]['resource'];
const harborCargoPaint = { wood: '#9bc592', brick: '#edab80', grain: '#f2cc65', wool: '#d0dfa3', ore: '#b0c1c5' };
function HarborCargo({ resource }: { resource: PortResource }) {
  switch (resource) {
    case 'wood': return <path d="m0-5-4 6h2l-2 2h3v2h2V3h3L2 1h2Z" fill="#37674d"/>;
    case 'brick': return <g fill="#a2553e" stroke="#f4c2a1" strokeWidth=".65"><path d="m-5 0 5-3 5 2-5 3Zm0 1 5 2 5-3v3L0 6l-5-2Z"/></g>;
    case 'grain': return <g stroke="#886528" strokeWidth="1.1" fill="#b78b31"><path d="m-3 5 6-10" fill="none"/>
      <path d="m-2 3-2-4 3 1Zm2-4V-5l2 2ZM0 2l4-3-1 3Z"/></g>;
    case 'wool': return <g fill="#fff9de" stroke="#7e805f" strokeWidth=".85"><path d="M-4 2q-3-3 0-5 2-3 4-1 3-3 5 1 2 2-1 4-3 3-8 1Z"/>
      <circle cx="4" cy="0" r="1.6" fill="#62694e"/></g>;
    case 'ore': return <g><path d="m-5 3 3-6 3-2 4 6-3 3Z" fill="#566b74"/><path d="m-2-3 3-2 1 3-3 3Z" fill="#e0e5db"/></g>;
    default: return <g stroke="#dff1df" strokeWidth="1.4" fill="none"><path d="M0-3v7m-4-4q0 3 4 4 4-1 4-4m-7-2h6"/>
      <circle cy="-4" r="1.2"/></g>;
  }
}
function Port({ resource, angle }: { resource: PortResource; angle?: number }) {
  if (angle !== undefined) {
    const x = Math.cos(angle) * 21, y = Math.sin(angle) * 21;
    return <g className="tb-harbor" strokeLinecap="round">
      <g transform={`rotate(${angle * 180 / Math.PI})`}>
        <path d="M3-2.5H20M3 2.5H20" stroke="#71503b" strokeWidth="2.8"/>
        <path d="M7-3v6m5-6v6m5-6v6" stroke="#e5ba80" strokeWidth="2.3"/>
      </g>
      <g transform={`translate(${x} ${y})`}>
        <rect x="-13" y="-7" width="26" height="14" rx="4.2" fill={resource ? '#fff5da' : '#26596c'} stroke="#28576a" strokeWidth="2"/>
        <rect x="-12.5" y="-6.5" width="25" height="13" rx="4" fill="none" stroke="#fff0ce" strokeWidth="1"/>
        <g transform="translate(-7 0)">
          {resource && <circle r="5.1" fill={harborCargoPaint[resource]}/>}
          <HarborCargo resource={resource}/>
        </g>
        <text x="4.5" y="3" textAnchor="middle" fontSize="8.1" fontWeight="800" fill={resource ? '#303e3d' : '#fff1cd'}>{resource ? '2:1' : '3:1'}</text>
      </g>
    </g>;
  }
  return <g pointerEvents="none" strokeLinecap="round"><path d="M-1 1 10 6M1-2l11 6" stroke="#765e48" strokeWidth="3"/><path d="m3 0-1 4m4-2-1 4m4-2-1 4" stroke="#d5a873" strokeWidth="2"/><circle cx="12" cy="8" r="5.5" fill={resource?'#265e6b':'#326e80'} stroke="#f3e2b8" strokeWidth="1"/><path d="M12 5v6m-3-3q3 5 6 0m-5-2h4" fill="none" stroke="#fff1cc" strokeWidth="1.15"/></g>;
}

export function TerritorialBoard({ map, lang, buildings, routes, players, blockedTileId, selection, onSelect, candidates, newsArea, rolledTileIds, highlightedRoadIds, blockade, blockMode, activeEffects = [] }: BoardProps) {
  const ru = lang === 'ru';
  const uid = useId().replace(/:/g, '');
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<{ pointerId: number; x: number; y: number; cx: number; cy: number; dragged: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [camera, setCamera] = useState({ zoom: 1, cx: .5, cy: .5 });
  const [focusKey, setFocusKey] = useState<string>('');
  const [hoverLabel, setHoverLabel] = useState('');
  const nodeMap = useMemo(() => new Map(map.nodes.map(node => [node.id,node])), [map.nodes]);
  const ports = useMemo(() => new Map(map.ports.map(port => [port.nodeId,port])), [map.ports]);
  const portAngles = useMemo(() => {
    const bearings = new Map<string, number>();
    if (map.projection !== 'regular-hex') return bearings;
    const terrain = new Map(map.tiles.map(tile => [tile.id, tile]));
    for (const port of map.ports) {
      const node = nodeMap.get(port.nodeId)!;
      const land = node.tileIds.map(id => terrain.get(id)!);
      const dx = land.reduce((sum, tile) => sum + node.x - tile.x, 0);
      const dy = land.reduce((sum, tile) => sum + node.y - tile.y, 0);
      bearings.set(node.id, Math.atan2(dy, dx));
    }
    return bearings;
  }, [map, nodeMap]);
  const available = new Set(candidates);
  const rolled = new Set(rolledTileIds);
  const couponRoads = new Set(highlightedRoadIds);
  const coastLoops = useMemo(() => territoryCoastLoops(map), [map]);
  const coastPath = useMemo(() => coastLoops.map(traceCoast).join(' '), [coastLoops]);
  const tiles = useMemo(() => map.tiles.map(tile => ({...tile, points:asPoints(tile.nodeIds.map(id=>nodeMap.get(id)!))})), [map.tiles,nodeMap]);
  const [first, second] = tiles[0].nodeIds.map(id=>nodeMap.get(id)!);
  const unit = Math.hypot(first.x-second.x, first.y-second.y) / 42;
  const edges = useMemo(() => map.edges.map(edge => ({...edge,start:nodeMap.get(edge.a)!,end:nodeMap.get(edge.b)!})), [map.edges,nodeMap]);
  const roadHits = useMemo(() => new Map(edges.map(edge => [edge.id,
    roadHitLine(edge.start, edge.end, unit, buildings[edge.a]?.level, buildings[edge.b]?.level)])), [edges, unit, buildings]);
  const targets = useMemo(() => [
    ...map.nodes.map(node=>({kind:'node' as const,id:node.id,x:node.x,y:node.y})),
    ...edges.map(edge=>({kind:'edge' as const,id:edge.id,x:(edge.start.x+edge.end.x)/2,y:(edge.start.y+edge.end.y)/2})),
    ...tiles.map(tile=>({kind:'tile' as const,id:tile.id,x:tile.x,y:tile.y}))
  ],[map.nodes,edges,tiles]);
  const seats = new Map(players.map(p=>[p.participantId,p]));
  const sectors = new Map(map.sectors.map(s=>[s.id,s.name[lang]]));
  const colorFor = (ownerId:string) => ownerColors[(seats.get(ownerId)?.seatIndex ?? 0)%ownerColors.length];
  const availability = (id: string, occupied = false) => candidates === undefined ? '' : available.has(id)
    ? (ru ? ' · Доступно сейчас' : ' · Available now')
    : occupied ? (ru ? ' · Занято' : ' · Occupied') : (ru ? ' · Недоступно сейчас' : ' · Not available now');
  const blockadeLabel = blockade?.actorId ?
    `${seats.get(blockade.actorId)?.displayName ?? (ru ? 'Игрок' : 'Player')} · ${blockade.reason === 'seven'
      ? (ru ? 'после семёрки' : 'after a seven') : blockade.reason === 'patrol' ? (ru ? 'патруль' : 'patrol') : (ru ? 'блокада' : 'blockade')}` :
    ru ? 'Производство заблокировано' : 'Production blocked';
  const highlighted = newsArea?.sectorId==='all' ? undefined : map.sectors.find(s=>s.id===newsArea?.sectorId);
  const areaLabel = newsArea && (highlighted || newsArea.sectorId==='all') ? (newsArea.kind==='risk' ? (ru?'Зона риска':'Risk area') : (ru?'Событие произошло':'Event took effect'))+' · '+(highlighted?.name[lang] ?? (ru?'Весь район':'Whole district')) : '';
  const vw=map.width/camera.zoom, vh=map.height/camera.zoom;
  const viewBox=[camera.cx*map.width-vw/2,camera.cy*map.height-vh/2,vw,vh].join(' ');
  const center=(pos:number,zoom:number)=>limit(pos,.5/zoom,1-.5/zoom);
  const zoomBy=(factor:number)=>setCamera(current=>{
    const zoom=limit(current.zoom*factor,1,3.6);
    return {zoom,cx:center(current.cx,zoom),cy:center(current.cy,zoom)};
  });
  const revealTarget = (item: BoardSelection) => {
    const target = targets.find(target => keyOf(target) === keyOf(item));
    if (!target) return;
    setCamera(current => {
      if (current.zoom === 1) return current;
      const x = target.x / map.width, y = target.y / map.height;
      const cx = Math.abs(x - current.cx) > .38 / current.zoom ? center(x, current.zoom) : current.cx;
      const cy = Math.abs(y - current.cy) > .38 / current.zoom ? center(y, current.zoom) : current.cy;
      return cx === current.cx && cy === current.cy ? current : { ...current, cx, cy };
    });
  };
  const handleDown=(e:PointerEvent<SVGSVGElement>)=>{
    if(e.button!==0||!e.isPrimary) return;
    suppressClick.current=false;
    gesture.current={pointerId:e.pointerId,x:e.clientX,y:e.clientY,cx:camera.cx,cy:camera.cy,dragged:false};
  };
  const handleMove=(e:PointerEvent<SVGSVGElement>)=>{
    const drag=gesture.current;
    if(!drag||drag.pointerId!==e.pointerId) return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(!drag.dragged&&Math.hypot(dx,dy)<6) return;
    drag.dragged=true;
    suppressClick.current=true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const scale=e.currentTarget.getScreenCTM()?.a;
    if(!scale) return;
    setCamera(current=>({...current,cx:center(drag.cx-dx/scale/map.width,current.zoom),cy:center(drag.cy-dy/scale/map.height,current.zoom)}));
  };
  const finishDrag=(e:PointerEvent<SVGSVGElement>)=>{
    if(gesture.current?.pointerId!==e.pointerId) return;
    if(e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    gesture.current=null;
  };
  const keys=(event:KeyboardEvent<SVGGElement>, item:BoardSelection)=>{
    if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelect(item);return;}
    const direction=({ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]} as Record<string,number[]>)[event.key];
    if(!direction) return;
    event.preventDefault();
    const origin=targets.find(t=>keyOf(t)===keyOf(item))!;
    let nearest:typeof origin|undefined, best=Infinity;
    for(const target of targets){
      const dx=target.x-origin.x,dy=target.y-origin.y,along=dx*direction[0]+dy*direction[1];
      const side=Math.abs(dx*direction[1]-dy*direction[0]);
      if(along<=.01||side>along||blockMode&&(target.kind!=='tile'||!available.has(target.id))) continue;
      const cost=along+side*2;
      if(cost<best){best=cost;nearest=target;}
    }
    if(nearest){
      const nextKey=keyOf(nearest);
      setFocusKey(nextKey);
      svg.current?.querySelector<SVGGElement>('[data-board-target="'+CSS.escape(nextKey)+'"]')?.focus();
    }
  };
  const propsFor=(item:BoardSelection,label:string)=>{
    const key=keyOf(item);
    return {role:'button', 'aria-label':label, 'aria-pressed':selection!==null&&keyOf(selection)===key,
      tabIndex:blockMode ? item.kind === 'tile' && available.has(item.id) ? 0 : -1 : (focusKey||keyOf(selection??targets[0]))===key?0:-1,
      className:'tb-target'+(available.has(item.id)?' is-available':'')+(selection&&keyOf(selection)===key?' is-selected':'')+
        (item.kind === 'node' && buildings[item.id] ? ' has-building' : '')+
        (item.kind === 'tile' && rolled.has(item.id) ? ' is-rolled' : '')+
        (item.kind === 'edge' && couponRoads.has(item.id) ? ' is-coupon-road' : ''),
      'data-board-target':key,onClick:(event:MouseEvent<SVGGElement>)=>{
        if(suppressClick.current || blockMode && item.kind !== 'tile') return;
        let target = item;
        const transform = svg.current?.getScreenCTM();
        if (item.kind === 'edge' && transform) {
          // Wide touch strokes can overlap. Choose the nearest visible road, not SVG paint order.
          const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
          let nearest = Infinity;
          for (const [id, hit] of roadHits) {
            const distance = distanceToRoad(point, hit);
            if (distance < nearest) { nearest = distance; target = { kind: 'edge', id }; }
          }
        }
        setFocusKey(keyOf(target));onSelect(target);
      },
      onKeyDown:(e:KeyboardEvent<SVGGElement>)=>keys(e,item),onFocus:(event:FocusEvent<SVGGElement>)=>{
        setFocusKey(key);setHoverLabel(label);
        // Panning during pointer focus would move this target before its click is delivered.
        if (event.currentTarget.matches(':focus-visible')) revealTarget(item);
      },
      onBlur:()=>setHoverLabel(''),onMouseEnter:()=>setHoverLabel(label),onMouseLeave:()=>setHoverLabel('')};
  };
  const paint = map.projection === 'regular-hex' ? coastalTerrainPaint : terrainPaint;
  const paintId = (id:string) => uid+'-'+id;
  return <div className={'territorial-board' + (blockMode ? ' tb-block-mode' : '')} data-territory-map={map.id} data-large-board={map.projection === 'regular-hex' || undefined}>
    <svg ref={svg} className="tb-surface" viewBox={viewBox} aria-label={map.name[lang]} role="group" onPointerDown={handleDown} onPointerMove={handleMove} onPointerUp={finishDrag} onPointerCancel={finishDrag} onPointerLeave={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId)) finishDrag(e);}}
      onKeyDown={event => {
        if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1.35); }
        if (event.key === '-') { event.preventDefault(); zoomBy(1 / 1.35); }
        if (event.key === 'Home') { event.preventDefault(); setCamera({ zoom: 1, cx: .5, cy: .5 }); }
      }}>
      <defs>
        {(Object.keys(terrainPaint) as Terrain[]).map(kind=><linearGradient key={kind} id={paintId(kind)} x2=".45" y2="1"><stop stopColor={paint[kind][0]}/><stop offset="1" stopColor={paint[kind][1]}/></linearGradient>)}
        <pattern id={paintId('swell')} width={unit*84} height={unit*52} patternUnits="userSpaceOnUse"><g transform={'scale('+unit+')'} fill="none" stroke="#b9e8dc" strokeLinecap="round" strokeWidth="1.1" opacity=".31"><path d="M4 13q5-2 12 0m4 0h4M51 39q5-2 11-.4"/></g></pattern>
      </defs>
      {map.projection === 'regular-hex' ? <TerritorialCoast loops={coastLoops} unit={unit} id={paintId('coast')}/> : <>
      <rect width={map.width} height={map.height} fill={'url(#'+paintId('swell')+')'}/>
      {[['#367e87',22,4],['#5da7a6',15,1],['#a8cbb1',9,1],['#806d58',6,4],['#e2cca0',4,0]].map(([color,width,dy])=>
        <path key={color} d={coastPath} fillRule="evenodd" pointerEvents="none" transform={'translate(0 '+Number(dy)*unit+')'} stroke={String(color)} fill={String(color)} strokeWidth={Number(width)*unit} strokeLinejoin="round"/>)}</>}
      {tiles.map((tile,index)=>{
        const kind:Terrain=tile.resource??'bare';
        const blocked=tile.id===blockedTileId;
        const label=terrainNames[kind][ru?0:1]+(tile.number?' · '+tile.number:(ru?' · Не производит ресурсы':' · No resource production'))+
          (rolled.has(tile.id)?(ru?' · Совпало с последним броском':' · Matches the latest roll'):'')+(blocked?' · '+blockadeLabel:'');
        return <g key={tile.id} {...propsFor({kind:'tile',id:tile.id},label)}>
          <title>{label}</title><polygon data-tile-origin={tile.id} points={tile.points} fill={'url(#'+paintId(kind)+')'} stroke="#696b51" strokeOpacity=".32" strokeWidth={unit}/>
          <g transform={`translate(${tile.x} ${tile.y}) scale(${unit})`} pointerEvents="none">
            {map.projection === 'regular-hex' && <g transform="translate(0 -4)"><CoastalTerrain kind={kind} variant={index}/></g>}
            <TerrainDetail kind={kind} variant={index}/><g transform={`translate(${index%2===0?1:-1} -6) scale(${index%3===0?.91:1})`}><TerrainArt kind={kind} heathForm={map.landmasses}/></g>
            {tile.number!==null?<g transform="translate(0 12)" className="tb-number-token"><circle cy="1.8" r="10" fill="#726f58"/>
              <circle className="tb-roll-halo" r="12.4" fill="none" strokeWidth="2"/>
              <circle r="10" fill={blocked?'#33484a':'#fbefd2'} stroke="#7d8067" strokeWidth="1.1"/>
              <text className="tb-number" y="4.1" fill={blocked?'#fff3da':tile.number===6||tile.number===8?'#a34432':'#263b3d'}>{tile.number}</text>
              {blocked&&<path d="M-7-7 7 7" stroke="#f6bb76" strokeWidth="2.4"/>}</g>:null}
          </g><polygon className="tb-tile-select" points={tile.points} strokeWidth={2.6*unit}/>
        </g>;
      })}
      <g data-board-layer="atmosphere" pointerEvents="none" aria-hidden="true">
        {tiles.map(tile => {
          const contains = (polygon: Point[]) => polygon.reduce((inside, a, i) => {
            const b = polygon[(i+1)%polygon.length];
            return (a.y > tile.y) !== (b.y > tile.y) && tile.x < (b.x-a.x)*(tile.y-a.y)/(b.y-a.y)+a.x ? !inside : inside;
          }, false);
          const effects = activeEffects.filter(effect => effect.zone === null || effect.zone === 'all' || map.sectors.some(s => s.id === effect.zone && contains(s.polygon)));
          const kinds = { illness: effects.some(e=>e.templateId==='E01'||e.templateId==='B02'),
            weather: effects.some(e=>['B04','B05','B07','B08'].includes(e.templateId)),
            setback: effects.some(e=>['B01','B03','B06'].includes(e.templateId)),
            boon: effects.some(e=>/^[GP]/.test(e.templateId)) };
          return <g key={tile.id}>{Object.entries(kinds).map(([kind,active])=><g key={kind} className={'tb-atmosphere tb-atmosphere-'+kind+(active?' is-live':'')} data-effect-tile={tile.id} data-effect-kind={kind}>
            <polygon points={tile.points}/>
            <g transform={`translate(${tile.x} ${tile.y}) scale(${unit})`}>{[-12,0,12].map((x,i)=><circle key={i} className="tb-mote" cx={x} cy={i===1?-10:4} r={kind==='weather'?1.5:2.3} style={{animationDelay:`${-i*1.1}s`}}/>)}</g>
          </g>)}</g>;
        })}
      </g>
      {areaLabel&&<g className={'tb-news-frame '+newsArea!.kind} data-board-layer="news" pointerEvents="none" aria-label={areaLabel}>
        {highlighted?<polygon points={asPoints(highlighted.polygon)}/>:<path d={coastPath} fillRule="evenodd"/>}
      </g>}
      {edges.map((edge,index)=>{
        const a=edge.start,b=edge.end,owner=routes[edge.id],seat=seats.get(owner),sea=edge.kind==='sea';
        const label=(sea?(ru?'Морской путь':'Sea lane'):(ru?'Дорога':'Road'))+' '+(index+1)+(seat?' · '+seat.displayName:'')+' · '+sectors.get(edge.eventSectorId)+
          availability(edge.id, Boolean(owner))+(couponRoads.has(edge.id)?(ru?' · Подходит для купона':' · Coupon applies'):'');
        const line={x1:a.x,y1:a.y,x2:b.x,y2:b.y};
        return <g key={edge.id} data-board-layer="route" {...propsFor({kind:'edge',id:edge.id},label)}><title>{label}</title>
          <line {...roadHits.get(edge.id)!} className="tb-edge-hit" strokeWidth="22" vectorEffect="non-scaling-stroke"/>
          {(owner||sea)&&<g pointerEvents="none" strokeLinecap="round"><line {...line} stroke={owner?'#33494a':'#e2e5bb'} strokeWidth={(owner?5.2:1.9)*unit} strokeDasharray={sea&&!owner?`${4*unit} ${5*unit}`:undefined}/>
          {owner&&<><line {...line} stroke={colorFor(owner)} strokeWidth={3.8*unit}/><line {...line} stroke="#fff1d5" strokeWidth={unit} strokeDasharray={`${(2+(seat?.seatIndex??0))*unit} ${6*unit}`}/></>}</g>}
          <line {...line} className="tb-edge-select" strokeWidth={4*unit}/>
          {couponRoads.has(edge.id)&&!owner&&<g transform={`translate(${(a.x+b.x)/2} ${(a.y+b.y)/2}) scale(${unit})`} pointerEvents="none"><circle r="5" fill="#fff4c5" stroke="#4b6e5c" strokeWidth="1.1"/><path d="m-2 0 1.5 1.5 3-3" fill="none" stroke="#2b6557" strokeWidth="1.3"/></g>}
        </g>;
      })}
      {map.nodes.map((node,index)=>{
        const b=buildings[node.id],seat=b&&seats.get(b.ownerId),port=ports.get(node.id);
        const portText=port ? ' · '+(ru?'Порт':'Port')+(map.projection === 'regular-hex' ? port.resource ? ' 2:1' : ' 3:1' : '')+(port.resource?' · '+({wood:['древесина','wood'],brick:['кирпич','brick'],grain:['зерно','grain'],wool:['шерсть','wool'],ore:['руда','ore']}[port.resource][ru?0:1]):'') : '';
        const label=(b?(ru?'Дом':'Building')+' '+b.level+' · '+(seat?.displayName??''):(ru?'Участок':'Building site'))+' · '+(index+1)+portText+' · '+sectors.get(node.eventSectorId)+availability(node.id,Boolean(b));
        return <g key={node.id} data-board-layer="building" transform={`translate(${node.x} ${node.y}) scale(${unit})`} {...propsFor({kind:'node',id:node.id},label)}>
          <title>{label}</title><circle r="7" className="tb-node-hit"/>
          {b&&<path d={houseOutline(b.level)} className="tb-house-hit"/>}{port&&<Port resource={port.resource} angle={portAngles.get(node.id)}/>}
          {b?<House level={b.level} color={colorFor(b.ownerId)} seat={seat?.seatIndex??0}/>:<circle r="1.8" fill="#f2e5c1" stroke="#627166" strokeWidth=".8"/>}
          {!b&&<circle className="tb-node-select" r="5.5" strokeWidth="2.3"/>}
        </g>;
      })}
    </svg>
    {areaLabel&&<span className={'tb-area-caption '+newsArea!.kind}>{areaLabel}</span>}
    {hoverLabel&&<span className="tb-tip" aria-hidden="true">{hoverLabel}</span>}
    <div className="tb-navigation" role="group" aria-label={ru?'Масштаб карты':'Map zoom'}>
      <button type="button" aria-label={ru?'Уменьшить':'Zoom out'} disabled={camera.zoom===1} onClick={()=>zoomBy(1/1.35)}>−</button>
      <button type="button" aria-label={ru?'Показать всю карту':'Fit whole map'} onClick={()=>setCamera({zoom:1,cx:.5,cy:.5})}><svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"><path d="M3 8V3h5m4 0h5v5m0 4v5h-5m-4 0H3v-5" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg></button>
      <button type="button" aria-label={ru?'Увеличить':'Zoom in'} disabled={camera.zoom===3.6} onClick={()=>zoomBy(1.35)}>+</button>
    </div>
  </div>;
}
