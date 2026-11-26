import { DISTRICT_MAPS } from "@iva-games/district";
import type { DistrictMap } from "@iva-games/district";
import { useLanguage } from "./ui";
import "./district.css";

export function DistrictGlyph({ kind }: { kind: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className="district-glyph">
      {kind === "house" || kind === "neutral-house" ? <>
        <path d="M7 24 24 9l17 15" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 22v18h24V22" fill="currentColor" fillOpacity=".14" stroke="currentColor" strokeWidth="2.5" />
        <path d="M21 40V29h7v11M16 25h4" stroke="currentColor" strokeWidth="2.5" />
      </> : kind === "cafe" ? <>
        <path d="M9 20h30l-4-10H13z" fill="currentColor" fillOpacity=".18" stroke="currentColor" strokeWidth="2.5" />
        <path d="M12 22v18h24V22M10 40h28M19 40V29h9v11M20 10l-2 10M28 10l2 10" stroke="currentColor" strokeWidth="2.5" />
        <path d="M9 20v3a4 4 0 0 0 8 0 4 4 0 0 0 8 0 4 4 0 0 0 8 0 3 3 0 0 0 6 0v-3" stroke="currentColor" strokeWidth="2.5" />
      </> : kind === "workshop" ? <>
        <path d="M8 40V23l11-7v8l12-8v10h8v14z" fill="currentColor" fillOpacity=".16" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M33 25V9h5v17M14 31h4m5 0h4m6 0h2M14 36h4m5 0h4" stroke="currentColor" strokeWidth="2.5" />
      </> : kind === "park" ? <>
        <path d="M25 38V25" stroke="currentColor" strokeWidth="3" />
        <path d="M14 27a7 7 0 0 1 1-13 10 10 0 0 1 20 1 7 7 0 0 1-1 13H14Z" fill="currentColor" fillOpacity=".2" stroke="currentColor" strokeWidth="2.5" />
        <path d="M10 39h29" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </> : kind === "square" ? <>
        <path d="M10 34h28l-4 6H14z" fill="currentColor" fillOpacity=".2" stroke="currentColor" strokeWidth="2.5" />
        <path d="M24 34V15m-8 8c0-5 8-9 8-9s8 4 8 9M20 10h8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </> : <>
        <path d="M10 15h28v24H10z" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
        <path d="M20 27h8m-4-4v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>}
    </svg>
  );
}

export function DistrictMapMini({ map }: { map: DistrictMap }) {
  return <div className="district-map-mini" style={{ gridTemplateColumns: `repeat(${map.width}, 1fr)` }} aria-hidden="true">
    {map.rows.flatMap((row, y) => [...row].map((kind, x) => <span key={`${x}:${y}`} className={`mini-${kind === "." ? "lot" : kind}`} />))}
  </div>;
}

export function DistrictMapSelect({ value, version, onChange }: { value: string; version?: string; onChange: (map: DistrictMap) => void }) {
  const { t, lang } = useLanguage();
  const selected = DISTRICT_MAPS.find(map => map.id === value && (version === undefined || map.version === version)) ?? DISTRICT_MAPS[0];
  const maps = DISTRICT_MAPS.filter((map, index) => DISTRICT_MAPS.findIndex(item => item.id === map.id) === index);
  const pinned = !maps.some(map => map.id === selected.id && map.version === selected.version);
  const mapKey = (map: DistrictMap) => `${map.id}@${map.version}`;
  return <div className="district-map-picker">
    <label>{t("Карта района", "District map")}
      <select aria-label={t("Карта района", "District map")} value={mapKey(selected)} onChange={event => {
        const map = DISTRICT_MAPS.find(item => mapKey(item) === event.target.value);
        if (map) onChange(map);
      }}>
        {pinned && <option value={mapKey(selected)}>{selected.name[lang]} · {t("в этой комнате", "in this room")}</option>}
        {maps.map(map => <option value={mapKey(map)} key={mapKey(map)}>{map.name[lang]}</option>)}
      </select>
    </label>
    <div className="district-map-preview"><DistrictMapMini map={selected} /><p>{selected.description[lang]}</p></div>
  </div>;
}

export function DistrictLobbyMap({ mapId, mapVersion }: { mapId?: unknown; mapVersion?: unknown }) {
  const { lang, t } = useLanguage();
  const map = DISTRICT_MAPS.find(item => item.id === mapId && (mapVersion === undefined || item.version === mapVersion)) ?? DISTRICT_MAPS[0];
  return <div className="district-lobby-map"><DistrictMapMini map={map} /><div><small>{t("Карта", "Map")}</small><strong>{map.name[lang]}</strong><p>{map.description[lang]}</p></div></div>;
}
