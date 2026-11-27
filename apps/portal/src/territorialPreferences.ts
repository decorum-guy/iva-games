import { useEffect, useState } from 'react';

export interface TerritorialPreferences {
  sound: { enabled: boolean; master: number; effects: number; news: number };
  textSize: 100 | 115 | 130;
  reduceMotion: boolean;
  compactPanels: boolean;
  highContrast: boolean;
  shortcuts: boolean;
  turnNotices: boolean;
  tradeNotices: boolean;
  newsNotices: boolean;
}
const key = 'iva.district.table.preferences.v1';
const volume = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value)
  ? Math.min(1, Math.max(0, value)) : fallback;
const bool = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;

export function readTerritorialPreferences(): TerritorialPreferences {
  const defaults: TerritorialPreferences = {
    sound: { enabled: false, master: .6, effects: .8, news: .55 }, textSize: 100,
    reduceMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    compactPanels: false, highContrast: false, shortcuts: true,
    turnNotices: true, tradeNotices: true, newsNotices: true,
  };
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<TerritorialPreferences> | null;
    if (!value || typeof value !== 'object') {
      defaults.sound.enabled = localStorage.getItem('iva.district.territorial.news.sound') === 'on';
      return defaults;
    }
    return { ...defaults,
      sound: { enabled: bool(value.sound?.enabled, false), master: volume(value.sound?.master, .6),
        effects: volume(value.sound?.effects, .8), news: volume(value.sound?.news, .55) },
      textSize: value.textSize === 115 || value.textSize === 130 ? value.textSize : 100,
      reduceMotion: bool(value.reduceMotion, defaults.reduceMotion), compactPanels: bool(value.compactPanels, false),
      highContrast: bool(value.highContrast, false), shortcuts: bool(value.shortcuts, true),
      turnNotices: bool(value.turnNotices, true), tradeNotices: bool(value.tradeNotices, true), newsNotices: bool(value.newsNotices, true),
    };
  } catch { return defaults; }
}

export function useTerritorialPreferences() {
  const [preferences, setPreferences] = useState(readTerritorialPreferences);
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(preferences)); } catch { /* The current session remains usable. */ }
  }, [preferences]);
  return [preferences, setPreferences] as const;
}
