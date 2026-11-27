import { newsProfiles, territoryMaps } from "@iva-games/district/territorial";
import type { NewsPreset, TerritoryMap } from "@iva-games/district/territorial";
import { useLanguage } from "./ui";
import type { Room } from "./types";
import "./territorial-district.css";

export function districtPreset(value: unknown): NewsPreset {
  return typeof value === "string" && Object.hasOwn(newsProfiles, value) ? value as NewsPreset : "medium";
}

export function TerritorialSettingsFields({ map, setMap, preset, setPreset }: {
  map: TerritoryMap; setMap: (map: TerritoryMap) => void; preset: NewsPreset; setPreset: (preset: NewsPreset) => void;
}) {
  const { lang, t } = useLanguage();
  return <>
    <label>{t("Карта района", "District map")}
      <select value={map.id} onChange={event => setMap(territoryMaps.find(item => item.id === event.target.value)!)}>
        {territoryMaps.map(item => <option key={item.id} value={item.id}>{item.name[lang]}</option>)}
      </select>
    </label>
    <label>{t("Новости района", "District news")}
      <select value={preset} onChange={event => setPreset(districtPreset(event.target.value))}>
        {Object.values(newsProfiles).map(item => <option key={item.id} value={item.id}>{item.name[lang]}</option>)}
      </select>
    </label>
    <p className="form-note">{newsProfiles[preset].summary[lang]} {t("Некоторые события случаются внезапно.", "Some events arrive without warning.")}</p>
  </>;
}

export const practiceLink = (roomId?: string) => "/district-training" + (roomId ? "?room=" + encodeURIComponent(roomId) : "");
export function TerritorialLobby({ room }: { room: Room }) {
  const { t, lang } = useLanguage();
  const map = territoryMaps.find(item => item.id === room.settings.mapId) ?? territoryMaps[0];
  const preset = newsProfiles[districtPreset(room.settings.newsPreset)];
  return <div className="territory-lobby">
    <div><small>{t("Карта", "Map")}</small><strong>{map.name[lang]}</strong></div>
    <div><small>{t("Новости района", "District news")}</small><strong>{preset.name[lang]}</strong></div>
    <a className="button secondary small" href={practiceLink(room.roomId)}>{t("Тренировка", "Practice")}</a>
  </div>;
}
