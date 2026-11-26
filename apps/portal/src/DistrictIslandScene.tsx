import { memo, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { DistrictCell, DistrictView, IslandDistrictMap } from "@iva-games/district";
import { DistrictMapArt, DistrictMapTree, type DistrictMapArtKind } from "./DistrictMapArt";
import { useLanguage } from "./ui";
import "./district-islands.css";

interface SceneProps {
  map: IslandDistrictMap;
  view?: DistrictView;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  onInspect?: (id: string | null) => void;
  preview?: { id: string; kind: DistrictMapArtKind } | null;
  mini?: boolean;
}
const seatColors = ["#247f78", "#bd572f", "#7560a5", "#5779a8"];
const ground = ["#bfc48a", "#ced09d", "#b5c38d", "#d8cf9f", "#c8c68f", "#b7c38e"];
const names = {
  lot: ["Участок", "Lot"], neutral: ["Нейтральный дом", "Neutral house"],
  "park-site": ["Площадка парка", "Park site"], park: ["Парк", "Park"], square: ["Площадь", "Square"],
  house1: ["Дом I", "House I"], house2: ["Дом II", "House II"], cafe1: ["Кафе I", "Cafe I"],
  cafe2: ["Кафе II", "Cafe II"], workshop1: ["Мастерская I", "Workshop I"], workshop2: ["Мастерская II", "Workshop II"],
} as const;

function artKind(kind: DistrictCell["kind"], cell?: DistrictCell): DistrictMapArtKind {
  if (cell?.building) return `${cell.building.kind}${cell.building.level}`;
  if (kind === "park") return cell?.completed ? "park" : "park-site";
  return kind === "neutral-house" ? "neutral" : kind;
}

function hash(seed: string) {
  let result = 2166136261;
  for (const char of seed) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

type Point = { x: number; y: number };
function shape(points: Point[]) {
  return points.map(p => `${p.x},${p.y}`).join(" ");
}

/** Soften the painted shoreline around the straight, shared gameplay edges. */
function shoreline(points: Point[]) {
  const towards = (from: Point, to: Point) => `${from.x * .84 + to.x * .16},${from.y * .84 + to.y * .16}`;
  return points.map((corner, i) =>
    `${i === 0 ? "M" : "L"}${towards(corner, points.at(i - 1)!)}Q${corner.x},${corner.y} ${towards(corner, points[(i + 1) % points.length])}`,
  ).join("") + "Z";
}

// A keyed appearance mounts only when the publicly visible property changes.
function Appearance({ animate, children }: { animate: boolean; children: ReactNode }) {
  const [arrival] = useState(animate);
  return <g className={arrival ? "di-arrival" : undefined}>{children}</g>;
}

export const DistrictIslandScene = memo(function DistrictIslandScene(props: SceneProps) {
  return <Island key={props.view?.matchId ?? props.map.id} {...props}/>;
});

function Island({ map, view, selected, preview, mini = false, onSelect, onInspect }: SceneProps) {
  const { lang, t } = useLanguage();
  const uid = useId().replace(/:/g, "");
  const [zoom, setZoom] = useState(1);
  const observed = useRef(false);
  const inspectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function clearInspection() {
    if (inspectTimer.current !== null) clearTimeout(inspectTimer.current);
    inspectTimer.current = null;
    onInspect?.(null);
  }
  useEffect(() => () => {
    if (inspectTimer.current !== null) clearTimeout(inspectTimer.current);
  }, []);
  useEffect(() => { observed.current = true; }, []);
  const { hexes, coastlines, bounds: b } = map.geometry;
  const neighbors = hexes.find(hex => hex.id === selected)?.neighborIds ?? [];
  const entries = hexes.map(hex => {
    const cell = view?.cells.find(c => c.id === hex.id);
    const owner = view?.players.find(p => p.participantId === cell?.ownerId);
    const reserved = view?.you.reservedLots.includes(hex.id) ?? false;
    const variant = hash(`${map.id}/${map.version}/${hex.id}`);
    return { hex, owner, reserved, variant, kind: artKind(hex.kind, cell) };
  }).sort((a, c) => a.hex.y - c.hex.y || a.hex.x - c.hex.x);
  const coast = coastlines.map(shoreline).join(" ");
  const event = view?.event;
  const zone = event?.kind === "roadworks" ? event.zoneId : undefined;
  return <div className={`di-scene ${mini ? "di-mini" : ""}`} onKeyDown={e => {
    if (e.key === "Escape" && selected && onSelect) { e.stopPropagation(); clearInspection(); onSelect(null); }
  }}>
    <div className="di-scroll">
      <svg className="di-map" viewBox={`${b.x} ${b.y} ${b.width} ${b.height}`} style={{ width: `${zoom * 100}%` }}
        role={mini ? undefined : "group"} aria-hidden={mini || undefined} aria-label={mini ? undefined : map.name[lang]}>
        <defs>
          <linearGradient id={uid+"-water"} x2=".7" y2="1"><stop stopColor="#5ca7a4"/><stop offset=".48" stopColor="#347f8b"/><stop offset="1" stopColor="#225770"/></linearGradient>
          <pattern id={uid+"-ripples"} width="109" height="71" patternUnits="userSpaceOnUse" patternTransform="rotate(-7)">
            <path d="M5 15q7 1.4 15 0m3-.6 5-.4M54 44q7 1 15-.8m8-.8 3-.3M18 67l7-.6" fill="none" stroke="#b5ece0" strokeOpacity=".30" strokeLinecap="round" strokeWidth="1.4"/>
          </pattern>
          <pattern id={uid+"-grain"} width="29" height="23" patternUnits="userSpaceOnUse">
            <path d="m3 12 2-1m11-6 2 .6m2 11 2-1" stroke="#778968" strokeWidth="1" opacity=".35"/>
            <circle cx="8" cy="19" r=".8" fill="#f6edc8"/>
          </pattern>
        </defs>
        <rect {...b} fill={`url(#${uid}-water)`}/><rect {...b} fill={`url(#${uid}-ripples)`}/>
        <g strokeLinejoin="round" fillRule="evenodd">
          <path d={coast} fill="#6ca699" stroke="#7bc4b6" strokeWidth="42" opacity=".32"/>
          <path d={coast} fill="#83c3aa" stroke="#91cbb5" strokeWidth="26"/>
          {!mini && <path d={coast} fill="none" stroke="#c5dfc4" strokeWidth="25" opacity=".38"/>}
          <path d={coast} transform="translate(0 6)" fill="#a39573" stroke="#ad9977" strokeWidth="14"/>
          <path d={coast} fill="#c9c79a" stroke="#eddbb1" strokeWidth="13"/>
          <path d={coast} fill="none" stroke="#fff3d2" strokeWidth="15" opacity=".43"/>
        </g>
        {entries.map(({hex, variant}) => <g key={hex.id}>
          <polygon points={shape(hex.polygon)} fill={hex.kind === "square" ? "#d1bea1" : hex.kind === "park" ? "#a4bd88" : ground[variant % ground.length]} stroke="#e4d7ad" strokeOpacity=".82" strokeWidth="2.05" strokeLinejoin="round"/>
          {!mini && <polygon points={shape(hex.polygon)} fill={`url(#${uid}-grain)`}/>}
        </g>)}
        {entries.map(({hex, kind, owner, variant}) => {
          const isPreview = preview?.id === hex.id;
          const seat = owner?.seatIndex;
          const color = seat === undefined ? undefined : seatColors[seat % seatColors.length];
          return <g key={hex.id} transform={`translate(${hex.x} ${hex.y})`} pointerEvents="none">
            {hex.zoneId === zone && <path d="m-32 -13 9-5m-5 10 12-7" stroke="#ab5a33" strokeWidth="3"/>}
            {!mini && variant % 5 !== 0 && <g transform={`translate(${variant % 2 ? -28 : 28} -9)`}>
              {variant % 4 === 1 && <g transform="translate(6 2) scale(.62)"><DistrictMapTree variant={variant + 1}/></g>}
              <g transform={`scale(${variant % 3 === 1 ? .86 : .72})`}><DistrictMapTree variant={variant}/></g>
            </g>}
            <Appearance key={`${kind}/${seat}`} animate={observed.current && !!view}>
              {color && <ellipse cy="6" rx="30" ry="12" fill={color} fillOpacity=".25" stroke={color} strokeWidth="2"/>}
              <g transform="translate(0 4) scale(1.08)" data-art={isPreview ? preview.kind : kind} data-preview={isPreview || undefined} opacity={isPreview ? .49 : 1}><DistrictMapArt kind={isPreview ? preview.kind : kind} variant={variant}/></g>
            </Appearance>
            {!mini && <g transform="translate(0 22)">
              <rect x="-14" y="-7" width={color ? 39 : 28} height="13" rx="6.5" fill="#f6efd7" fillOpacity=".94"/>
              <text className="di-address" y="2.6">{hex.id}</text>
              {seat !== undefined && <g transform="translate(19 -.5)"><circle r="7" fill={color}/><text className="di-owner" y="3.2">{seat + 1}</text></g>}
            </g>}
          </g>;
        })}
        {!mini && entries.map(({hex, kind, owner, reserved}) => <polygon key={hex.id} points={shape(hex.polygon)}
          className={`di-hit ${neighbors.includes(hex.id) ? "di-neighbor" : ""} ${selected === hex.id ? "di-selected" : ""} ${reserved ? "di-reserved" : ""} ${view?.legal.bid && hex.kind === "lot" && !owner ? "di-available" : ""}`}
          role="button" tabIndex={0} data-cell-id={hex.id} aria-pressed={selected === hex.id}
          aria-label={`${hex.id} · ${names[kind][lang === "ru" ? 0 : 1]}${owner ? " · " + t("Игрок", "Player") + " " + (owner.seatIndex + 1) : ""}`}
          onPointerEnter={event => {
            if (event.pointerType !== "mouse" || !onInspect) return;
            if (inspectTimer.current !== null) clearTimeout(inspectTimer.current);
            inspectTimer.current = setTimeout(() => onInspect(hex.id), 420);
          }}
          onPointerLeave={clearInspection}
          onClick={() => { clearInspection(); onSelect?.(hex.id); }} onFocus={e => { if (e.currentTarget.matches(":focus-visible")) onSelect?.(hex.id); }}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect?.(hex.id); } }}/>)}
      </svg>
    </div>
    {!mini && <div className="di-zoom"><button type="button" aria-label={t("Уменьшить карту", "Zoom out")} disabled={zoom <= 1} onClick={() => setZoom(zoom - .5)}>−</button><button type="button" aria-label={t("Увеличить карту", "Zoom in")} disabled={zoom >= 2} onClick={() => setZoom(zoom + .5)}>+</button></div>}
  </div>;
}
