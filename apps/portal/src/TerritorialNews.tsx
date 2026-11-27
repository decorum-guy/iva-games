import { useLayoutEffect, useRef, useState } from 'react';
import type { AppliedChange, PublicNews, TerritoryView } from '@iva-games/district/territorial';
import './territorial-news.css';

type Language = 'ru' | 'en';
interface NewsProps {
  view: TerritoryView;
  lang: Language;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  autoOpen?: boolean;
  onShowCouponRoutes?: (couponId: string) => void;
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

function NewsArticle({ item, view, lang, selectedId, onSelect, onShowCouponRoutes }: NewsProps & { item: PublicNews }) {
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
    {'description' in item && item.description && item.description[lang].split(/\n\n+/).map((paragraph,index) => <p key={index}>{paragraph}</p>)}
    {byOwner.size > 0 && <dl className="tn-changes">{[...byOwner].map(([owner, rows]) =>
      <div key={owner}><dt>{view.players.find(p => p.participantId === owner)?.displayName ?? (ru ? 'Игрок' : 'Player')}</dt>
        <dd>{rows.join(' · ')}</dd></div>)}</dl>}
    {item.stage === 'applied' && item.templateId.startsWith('H') && !changes.some(change => change.kind === 'level' && change.after < change.before) &&
      <p className="tn-no-damage">{ru ? 'Ущерба нет.' : 'No damage.'}</p>}
    {!forecast && view.you.coupons.filter(coupon => coupon.eventInstanceId === item.eventInstanceId && coupon.kind === 'free-road').map(coupon => <div className="tn-coupon" key={coupon.id}>
      <strong>{ru ? 'Ваш дорожный купон' : 'Your road coupon'}</strong>
      <p>{coupon.zone === null ? (ru ? 'Весь район' : 'Whole district') : view.map.sectors.find(sector => sector.id === coupon.zone)?.name[lang]} · {ru ? 'до конца круга ' : 'through round '}{coupon.endsAfterRound}</p>
      <p>{ru ? 'Одна наземная дорога в указанной зоне. Доплата по другой новости сохраняется.' : 'One land road in this area. Other news surcharges still apply.'}</p>
      <button type="button" className="tn-area" onClick={() => onShowCouponRoutes?.(coupon.id)}>{ru ? 'Показать подходящие дороги' : 'Show eligible roads'}</button>
    </div>)}
    {area && <button type="button" className="tn-area" aria-pressed={selected} onClick={() => onSelect(selected ? null : item.messageId)}>
      {selected ? (ru ? 'Скрыть рамку' : 'Hide outline') : (ru ? 'Показать на карте' : 'Show on map')}
    </button>}
  </article>;
}

function urgency(item: PublicNews | undefined) {
  if (!item || (!item.templateId.startsWith('H') && item.templateId !== 'E01') || item.stage === 'cancelled') return 'ordinary';
  return item.stage === 'forecast' || item.stage === 'update' ? 'warning' : 'urgent';
}

export function TerritorialNews(props: NewsProps) {
  const { view, lang, onSelect, autoOpen = true, onShowCouponRoutes } = props;
  const ru = lang === 'ru';
  const [dismissed, setDismissed] = useState('');
  const [mode, setMode] = useState<'latest' | 'journal' | null>(null);
  const [articleId, setArticleId] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (mode) panel.current?.querySelector<HTMLElement>('button')?.focus();
  }, [mode, articleId]);
  const all = new Map(view.news.map(item => [item.messageId, item]));
  for (const threat of view.threats) all.set(threat.messageId, threat);
  const selected = mode === 'latest' && articleId ? all.get(articleId) : undefined;
  const latest = view.news.at(-1);
  const issueKey = latest ? view.matchId + ':' + latest.messageId : '';
  const cards = selected ? [selected] : latest ? view.news.filter(item => item.round === latest.round) : [];
  const activeIds = new Set(view.threats.map(item => item.messageId));
  const ordered = [...cards].sort((a, b) => Number(activeIds.has(b.messageId)) - Number(activeIds.has(a.messageId)));
  const issues = new Map<number, PublicNews[]>();
  for (const item of view.news) {
    const group = issues.get(item.round) ?? [];
    group.push(item); issues.set(item.round, group);
  }
  const visible = mode === 'journal' || (cards.length > 0 && (mode === 'latest' || autoOpen && dismissed !== issueKey));
  const severities = ordered.map(urgency);
  const level = selected ? urgency(selected) : severities.includes('urgent') ? 'urgent' : severities.includes('warning') ? 'warning' : 'ordinary';
  function close() {
    const restoreFocus = panel.current?.contains(document.activeElement);
    setMode(null); setDismissed(issueKey);
    if (restoreFocus) opener.current?.focus();
  }
  function open(next: 'latest' | 'journal') {
    panel.current?.querySelector<HTMLElement>('button')?.focus();
    setMode(next);
    setArticleId(null);
  }
  function read(id: string) { setArticleId(id); setMode('latest'); }
  return <section className="territorial-news" aria-label={ru ? 'Новости района' : 'District news'}>
    <header className="tn-header">
      <button ref={opener} type="button" className="tn-open" onClick={() => open('latest')} aria-expanded={visible && mode !== 'journal'}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M5 4h15v16H5a2 2 0 0 1-2-2V8h2m0-4v14m3-10h9m-9 4h3m3 0h3m-9 4h9"/></svg>
        <strong>{ru ? 'Новости' : 'News'}</strong>{view.threats.length > 0 && <span className="tn-count">{view.threats.length}</span>}
      </button>
      <button type="button" className="tn-journal-open" onClick={() => open('journal')}>{ru ? 'Журнал' : 'Journal'} <small>{view.news.length}</small></button>
    </header>
    {visible && <div ref={panel} className={'tn-issue tn-urgency-' + (mode === 'journal' ? 'ordinary' : level)} role="region"
      aria-label={mode === 'journal' ? (ru ? 'Журнал новостей' : 'News journal') : (ru ? 'Выпуск новостей' : 'News issue')}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
      <div className="tn-issue-label"><div><strong>{mode === 'journal' ? (ru ? 'Журнал новостей' : 'News journal') :
        level === 'urgent' ? (ru ? 'Срочно' : 'Urgent') : level === 'warning' ? (ru ? 'Внимание' : 'Attention') : (ru ? 'Новости района' : 'District news')}</strong>
        {mode !== 'journal' && ordered[0] && <span>{ru ? 'Круг ' : 'Round '}{ordered[0].round}</span>}</div>
        <button type="button" onClick={close} aria-label={ru ? 'Свернуть новости' : 'Dismiss news'} className="tn-close-only"><span aria-hidden="true">×</span></button>
      </div>
      <div className="tn-issue-cards" tabIndex={0} aria-label={ru ? 'Текст новостей, можно прокрутить' : 'Scrollable news text'}
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          const element = event.currentTarget;
          const top = event.key === 'Home' ? 0 : event.key === 'End' ? element.scrollHeight :
            event.key === 'PageDown' ? element.scrollTop + element.clientHeight * .85 :
              event.key === 'PageUp' ? element.scrollTop - element.clientHeight * .85 : null;
          if (top !== null) { event.preventDefault(); element.scrollTo({ top }); }
        }}>
        {mode === 'journal' ? <>
          {view.threats.length > 0 && <section className="tn-journal-group"><h4>{ru ? 'Активные угрозы' : 'Active threats'}</h4>
            {view.threats.map(item => <button type="button" key={item.messageId} onClick={() => read(item.messageId)}><span>{stageLabel(item, lang)}</span><strong>{item.headline[lang]}</strong></button>)}</section>}
          {[...issues].reverse().map(([round, entries]) => <section className="tn-journal-group" key={round}><h4>{ru ? 'Круг ' : 'Round '}{round}</h4>
            {entries.map(item => <button type="button" key={item.messageId} onClick={() => read(item.messageId)}><span>{stageLabel(item,lang)}</span><strong>{item.headline[lang]}</strong></button>)}</section>)}
        </> : ordered.map(item => <NewsArticle key={item.messageId} {...props} item={item} onSelect={id => { onSelect(id); if (id) close(); }} onShowCouponRoutes={id => { close(); onShowCouponRoutes?.(id); }}/>) }
        {(!latest || mode === 'journal' && !issues.size) && <p className="tn-empty">{ru ? 'Пока новостей нет.' : 'No news yet.'}</p>}
      </div>
      <footer className="tn-footer"><span>{mode === 'journal' ? (ru ? 'Выберите выпуск, чтобы прочитать его снова.' : 'Choose an issue to read it again.') : (ru ? 'Прокрутите выпуск, чтобы увидеть все последствия.' : 'Scroll the issue to see all the effects.')}</span>
        {mode !== 'journal' && <button type="button" onClick={() => open('journal')}>{ru ? 'Журнал новостей' : 'News journal'}</button>}
      </footer>
    </div>}
  </section>;
}
