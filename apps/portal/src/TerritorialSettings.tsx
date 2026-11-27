import { useState } from 'react';
import { newsProfiles } from '@iva-games/district/territorial';
import type { TerritoryView } from '@iva-games/district/territorial';
import type { Language } from './types';
import type { TerritorialPreferences } from './territorialPreferences';
import { Modal } from './ui';

export function TerritorialSettings({ view, lang, setLanguage, preferences, onChange, onPreview, onClose }: {
  view: TerritoryView; lang: Language; setLanguage?: (lang: Language) => void;
  preferences: TerritorialPreferences; onChange: (value: TerritorialPreferences) => void;
  onPreview: () => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<'personal' | 'room'>('personal');
  const t = (ru: string, en: string) => lang === 'ru' ? ru : en;
  const set = <K extends keyof TerritorialPreferences>(key: K, value: TerritorialPreferences[K]) => onChange({ ...preferences, [key]: value });
  const rules = view.rules;
  const toggles: { key: 'reduceMotion' | 'compactPanels' | 'highContrast' | 'shortcuts' | 'turnNotices' | 'tradeNotices' | 'newsNotices'; label: string }[] = [
    { key: 'reduceMotion', label: t('Меньше движения', 'Reduce motion') },
    { key: 'compactPanels', label: t('Компактные панели', 'Compact panels') },
    { key: 'highContrast', label: t('Повышенный контраст', 'Higher contrast') },
    { key: 'shortcuts', label: t('Клавиши управления', 'Keyboard shortcuts') },
    { key: 'turnNotices', label: t('Оповещение о вашем ходе', 'Your turn notice') },
    { key: 'tradeNotices', label: t('Оповещение о сделке', 'Trade notice') },
    { key: 'newsNotices', label: t('Открывать свежие новости', 'Open fresh news') },
  ];
  return <Modal title={t('Настройки стола', 'Table settings')} onClose={onClose}>
    <div className="territory-settings">
      <div className="territory-tabs" role="group" aria-label={t('Раздел настроек', 'Settings section')}>
        <button type="button" aria-pressed={tab === 'personal'} onClick={() => setTab('personal')}>{t('Для меня', 'For me')}</button>
        <button type="button" aria-pressed={tab === 'room'} onClick={() => setTab('room')}>{t('Партия · для всех', 'Match · everyone')}</button>
      </div>
      {tab === 'personal' ? <>
        <label>{t('Язык', 'Language')}<select aria-label={t('Язык', 'Language')} value={lang} onChange={event => setLanguage?.(event.target.value as Language)}>
          <option value="ru">Русский</option><option value="en">English</option>
        </select></label>
        <label className="territory-toggle"><span>{t('Звук игры', 'Game sound')}</span><input type="checkbox" checked={preferences.sound.enabled}
          onChange={event => set('sound', { ...preferences.sound, enabled: event.target.checked })}/>
          <b>{preferences.sound.enabled ? t('Включён', 'On') : t('Выключен', 'Off')}</b></label>
        {(['master', 'effects', 'news'] as const).map(channel => <label className="territory-slider" key={channel}>
          <span>{channel === 'master' ? t('Общая громкость', 'Master volume') : channel === 'effects' ? t('Действия', 'Actions') : t('Новости', 'News')}
            <output>{Math.round(preferences.sound[channel] * 100)}%</output></span>
          <input type="range" min="0" max="100" value={Math.round(preferences.sound[channel] * 100)}
            onChange={event => set('sound', { ...preferences.sound, [channel]: Number(event.target.value) / 100 })}/>
        </label>)}
        <button className="button secondary" type="button" onClick={onPreview}>{t('Проверить звук', 'Test sound')}</button>
        <label>{t('Размер текста', 'Text size')}<select aria-label={t('Размер текста', 'Text size')} value={preferences.textSize}
          onChange={event => set('textSize', Number(event.target.value) as TerritorialPreferences['textSize'])}>
          <option value="100">100%</option><option value="115">115%</option><option value="130">130%</option>
        </select></label>
        {toggles.map(item => <label className="territory-toggle" key={item.key}><span>{item.label}</span>
          <input type="checkbox" checked={preferences[item.key]} onChange={event => set(item.key, event.target.checked)}/>
          <b>{preferences[item.key] ? t('Да', 'On') : t('Нет', 'Off')}</b></label>)}
        <p className="territory-key-help">{t('На карте: стрелки выбирают соседнее место, Enter или пробел — открыть. H — история, G — действия, Esc — снять выбор. В полях ввода эти клавиши не меняют стол.',
          'On the map: arrows move focus, Enter or Space opens a place. H opens history, G opens actions, Esc clears selection. Typing in a field never changes the table.')}</p>
      </> : <>
        <p>{t('Эти правила общие для всей комнаты и сохраняются до конца партии.', 'These rules apply to everyone and stay fixed for this match.')}</p>
        <dl className="territory-rules-grid">
          <div><dt>{t('Карта', 'Map')}</dt><dd>{view.map.name[lang]}</dd></div>
          <div><dt>{t('Места', 'Seats')}</dt><dd>{view.players.length}</dd></div>
          <div><dt>{t('Боты', 'Bots')}</dt><dd>{view.players.filter(player => player.isBot || player.left).length}</dd></div>
          <div><dt>{t('Цель', 'Target')}</dt><dd>{view.goal} {t('очков', 'points')}</dd></div>
          <div><dt>{t('Новости', 'News')}</dt><dd>{newsProfiles[view.preset].name[lang]}</dd></div>
          {rules && <>
            <div><dt>{t('Время на действие', 'Action timer')}</dt><dd>{rules.limits.turnMs / 1000} {t('сек.', 'sec')}</dd></div>
            <div><dt>{t('Сброс при семёрке', 'Discard on seven')}</dt><dd>{t('Рука больше ', 'More than ')}{rules.limits.handLimit}{t(' карт: половина вниз', ' cards: half, rounded down')}</dd></div>
            <div><dt>{t('Обмен с банком', 'Bank exchange')}</dt><dd>{rules.bankRate}:1</dd></div>
            <div><dt>{t('Порт / особый порт', 'Port / special port')}</dt><dd>{rules.portRate}:1 / {rules.specialisedPortRate}:1</dd></div>
            <div><dt>{t('Длиннейший путь', 'Longest route')}</dt><dd>{t('От ', 'At least ')}{rules.routeAward} {t('рёбер · 2 очка', 'edges · 2 points')}</dd></div>
            <div><dt>{t('Большой патруль', 'Largest patrol')}</dt><dd>{t('От ', 'At least ')}{rules.patrolAward} {t('патрулей · 2 очка', 'patrols · 2 points')}</dd></div>
          </>}
          <div><dt>{t('Кубики', 'Dice')}</dt><dd>{t('Два шестигранных', 'Two six-sided dice')}</dd></div>
        </dl>
        <p>{newsProfiles[view.preset].summary[lang]}</p>
      </>}
    </div>
  </Modal>;
}
