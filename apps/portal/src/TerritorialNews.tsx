import { useEffect, useRef, useState } from 'react';
import type { AppliedChange, PublicNews, TerritoryView } from '@iva-games/district/territorial';
import './territorial-news.css';

type Language = 'ru' | 'en';
interface NewsProps {
  view: TerritoryView;
  lang: Language;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const resourceNames = {
  wood: ['древесина', 'wood'], brick: ['кирпич', 'brick'], grain: ['зерно', 'grain'],
  wool: ['шерсть', 'wool'], ore: ['руда', 'ore'],
};
const coupons = {
  'free-road': ['Бесплатная дорога', 'Free road'],
  'upgrade-discount': ['Скидка на улучшение', 'Upgrade discount'],
  'card-discount': ['Скидка на карту', 'Tactic card discount'],
  'bank-exchange': ['Обмен 2 к 1', 'Two-for-one exchange'],
  restore: ['Бесплатное восстановление', 'Free repair'],
};

function stageLabel(item: PublicNews, lang: Language) {
  const ru = lang === 'ru';
  switch (item.stage) {
    case 'forecast':
    case 'update': return item.templateId === 'E01' ? (ru ? 'Риск распространения' : 'Risk of spread') : (ru ? 'Прогноз' : 'Forecast');
    case 'confirmed': return ru ? 'Подтверждено' : 'Confirmed';
    case 'cancelled': return item.templateId.startsWith('P') ? (ru ? 'Итог' : 'Outcome') : (ru ? 'Опасность миновала' : 'All clear');
    default: return ru ? 'Произошло' : 'Occurred';
  }
}

/** A missing zone is unpublished. The server explicitly uses null for citywide. */
export function territorialNewsArea(item?: PublicNews | null): { sectorId: string; kind: 'risk' | 'applied' } | null {
  if (!item || item.zone === undefined || item.stage === 'cancelled') return null;
  return { sectorId: item.zone ?? 'all', kind: 'dueRound' in item ? 'risk' : 'applied' };
}

function changeText(change: AppliedChange, view: TerritoryView, lang: Language) {
  const ru = lang === 'ru', i = ru ? 0 : 1;
  if (change.kind === 'resources' || change.kind === 'production') {
    return Object.entries(change.resources).map(([id, value]) =>
      (value > 0 ? '+' : '') + value + ' · ' + resourceNames[id as keyof typeof resourceNames][i]).join(', ');
  }
  if (change.kind === 'coupon') return coupons[change.coupon][i];
  const number = view.map.nodes.findIndex(n => n.id === change.nodeId) + 1;
  const place = (ru ? 'Дом ' : 'Building ') + number;
  switch (change.kind) {
    case 'level': return place + ' · ' + change.before + ' → ' + change.after;
    case 'protected': return place + (ru ? ' · защита сработала' : ' · protection held');
    case 'modifier': return place + (ru ? ' · действует правило новости' : ' · event rule applied');
  }
}

function NewsArticle({ item, view, lang, selectedId, onSelect }: NewsProps & { item: PublicNews }) {
  const ru = lang === 'ru';
  const forecast = 'dueRound' in item;
  const scope = item.zone === null ? (ru ? 'Весь район' : 'Whole district') :
    view.map.sectors.find(s => s.id === item.zone)?.name[lang] ?? (ru ? 'Сектор пока неизвестен' : 'Sector not yet known');
  const area = territorialNewsArea(item);
  const changes = 'changes' in item && item.stage !== 'cancelled' ? item.changes : [];
  const byOwner = new Map<string, string[]>();
  for (const change of changes) {
    const list = byOwner.get(change.ownerId) ?? [];
    list.push(changeText(change, view, lang));
    byOwner.set(change.ownerId, list);
  }
  const selected = selectedId === item.messageId;
  return <article className={'tn-card tn-stage-' + item.stage} data-news-stage={item.stage} data-news-id={item.messageId}>
    <div className="tn-stage"><span aria-hidden="true">{forecast ? '◇' : item.stage === 'cancelled' ? '○' : '●'}</span> {stageLabel(item, lang)}</div>
    <h4>{item.headline[lang]}</h4>
    <div className="tn-meta">
      <span>{scope}</span>
      {forecast && <span>{ru ? 'Срок — конец круга ' : 'Due at the end of round '}{item.dueRound}</span>}
      {'endsAfterRound' in item && item.endsAfterRound !== undefined && <span>{ru ? 'До конца круга ' : 'Through round '}{item.endsAfterRound}</span>}
    </div>
    {'description' in item && item.description && <p>{item.description[lang]}</p>}
    {byOwner.size > 0 && <dl className="tn-changes">{[...byOwner].map(([owner, rows]) =>
      <div key={owner}><dt>{view.players.find(p => p.participantId === owner)?.displayName ?? (ru ? 'Игрок' : 'Player')}</dt>
        <dd>{rows.join(' · ')}</dd></div>)}</dl>}
    {item.stage === 'applied' && item.templateId.startsWith('H') && !changes.some(change => change.kind === 'level' && change.after < change.before) &&
      <p className="tn-no-damage">{ru ? 'Ущерба нет.' : 'No damage.'}</p>}
    {area && <button type="button" className="tn-area" aria-pressed={selected} onClick={() => onSelect(selected ? null : item.messageId)}>
      {selected ? (ru ? 'Скрыть рамку' : 'Hide outline') : (ru ? 'Показать на карте' : 'Show on map')}
    </button>}
  </article>;
}

const soundKey = 'iva.district.territorial.news.sound';
function useNewsSound(view: TerritoryView) {
  const [enabled, setEnabled] = useState(() => { try { return localStorage.getItem(soundKey) === 'on'; } catch { return false; } });
  const audio = useRef<AudioContext | null>(null);
  const last = useRef<{ matchId: string; ids: Set<string>; time: number; revision: number } | null>(null);
  useEffect(() => {
    const reset = () => { last.current = null; };
    window.addEventListener('online', reset);
    window.addEventListener('offline', reset);
    document.addEventListener('visibilitychange', reset);
    return () => {
      window.removeEventListener('online', reset);
      window.removeEventListener('offline', reset);
      document.removeEventListener('visibilitychange', reset);
      if (audio.current) void audio.current.close().catch(() => {});
      audio.current = null;
      reset();
    };
  }, []);
  useEffect(() => {
    const previous = last.current;
    const sameMatch = previous?.matchId === view.matchId;
    if (sameMatch && view.revision < previous.revision) return;
    const seen = sameMatch ? previous.ids : new Set<string>();
    const fresh = view.news.filter(n => !seen.has(n.messageId));
    for (const message of fresh) seen.add(message.messageId);
    const now = Date.now();
    last.current = { matchId: view.matchId, revision: view.revision, ids: seen, time: now };
    const context = audio.current;
    if (!enabled || !sameMatch || view.revision !== previous.revision + 1 ||
      now - previous.time > 8000 || document.hidden || !navigator.onLine || context?.state !== 'running') return;
    const kind = view.activity?.revision === view.revision ? view.activity.kind : undefined;
    if (!fresh.length && !kind) return;
    // One cue for a committed action or issue. Reopening a card does not replay it.
    const pitch = { roll: [320, 430], build: [260, 440], deal: [465, 580], tactic: [560, 730], win: [608, 910] };
    const [from, to] = kind === 'win' ? pitch.win : fresh.length ?
      (fresh.some(n => 'dueRound' in n) ? [490, 390] : [660, 770]) : pitch[kind!];
    const tone = context.createOscillator(), envelope = context.createGain();
    tone.type = 'sine';
    tone.frequency.setValueAtTime(from, context.currentTime);
    tone.frequency.exponentialRampToValueAtTime(to, context.currentTime + .11);
    envelope.gain.setValueAtTime(.0001, context.currentTime);
    envelope.gain.exponentialRampToValueAtTime(.05, context.currentTime + .014);
    envelope.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .15);
    tone.connect(envelope).connect(context.destination);
    tone.start(); tone.stop(context.currentTime + .16);
    tone.onended = () => { tone.disconnect(); envelope.disconnect(); };
  }, [enabled, view.matchId, view.revision, view.news, view.activity]);
  function toggle() {
    const next = !enabled;
    if (next && typeof AudioContext !== 'undefined') {
      audio.current ??= new AudioContext();
      void audio.current.resume().catch(() => {});
    }
    try { localStorage.setItem(soundKey, next ? 'on' : 'off'); } catch { /* Local preference lasts this session. */ }
    setEnabled(next);
  }
  // A stored preference may resume only after this page receives a user gesture.
  useEffect(() => {
    if (!enabled || typeof AudioContext === 'undefined') return;
    const unlock = () => {
      audio.current ??= new AudioContext();
      void audio.current.resume().catch(() => {});
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, [enabled]);
  return { enabled, toggle };
}

export function TerritorialNews(props: NewsProps) {
  const { view, lang, selectedId, onSelect } = props;
  const ru = lang === 'ru';
  const [dismissed, setDismissed] = useState('');
  const sound = useNewsSound(view);
  const all = new Map(view.news.map(item => [item.messageId, item]));
  for (const threat of view.threats) all.set(threat.messageId, threat);
  const selected = selectedId ? all.get(selectedId) : undefined;
  const latest = view.news.at(-1);
  const issueKey = latest ? view.matchId + ':' + latest.messageId : '';
  const cards = selected ? [selected] : latest && dismissed !== issueKey ? view.news.filter(n => n.round === latest.round) : [];
  const activeIds = new Set(view.threats.map(item => item.messageId));
  const ordered = [...cards].sort((a, b) => Number(activeIds.has(b.messageId)) - Number(activeIds.has(a.messageId)));
  const issues = new Map<number, PublicNews[]>();
  for (const item of view.news) {
    const group = issues.get(item.round) ?? [];
    group.push(item); issues.set(item.round, group);
  }
  return <section className="territorial-news" aria-label={ru ? 'Новости района' : 'District news'}>
    <header className="tn-header"><h3>{ru ? 'Новости района' : 'District news'}</h3>
      <button type="button" className="tn-sound" onClick={sound.toggle} aria-pressed={sound.enabled}
        aria-label={ru ? 'Звук игры' : 'Game sound'} title={ru ? 'Звук игры' : 'Game sound'}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M3 9h4l5-4v14l-5-4H3z"/>{sound.enabled ? <path d="M15 8q4 4 0 8m3-11q7 7 0 14"/> : <path d="m16 9 6 6m0-6-6 6"/>}
        </svg>
      </button>
    </header>
    {ordered.length > 0 && <div className="tn-issue"><div className="tn-issue-label"><span>{ru ? 'Круг ' : 'Round '}{ordered[0].round}</span>
      <button type="button" onClick={() => { setDismissed(issueKey); onSelect(null); }}>{ru ? 'Свернуть' : 'Dismiss'}</button></div>
      <div className="tn-issue-cards">{ordered.map(item => <NewsArticle key={item.messageId} {...props} item={item}/>)}</div>
    </div>}
    {view.threats.length > 0 && <details className="tn-list"><summary>{ru ? 'Активные угрозы' : 'Active threats'} · {view.threats.length}</summary>
      <div>{view.threats.map(item => <button key={item.messageId} type="button" onClick={() => onSelect(item.messageId)}>{stageLabel(item, lang)} · {item.headline[lang]}</button>)}</div></details>}
    {issues.size > 0 ? <details className="tn-list"><summary>{ru ? 'Журнал новостей' : 'News journal'} · {view.news.length}</summary>
      <div>{[...issues].reverse().map(([round, entries]) => <section key={round}><h4>{ru ? 'Круг ' : 'Round '}{round}</h4>
        {entries.map(item => <button key={item.messageId} type="button" onClick={() => onSelect(item.messageId)}>{stageLabel(item, lang)} · {item.headline[lang]}</button>)}</section>)}</div>
    </details> : <p className="tn-empty">{ru ? 'Пока новостей нет.' : 'No news yet.'}</p>}
  </section>;
}
