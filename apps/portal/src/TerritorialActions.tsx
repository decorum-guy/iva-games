import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { RESOURCES, emptyStock } from '@iva-games/district/territorial';
import type { CardKind, CouponKind, Resource, Stock, TerritoryAction, TerritoryOffer, TerritoryOfferStatus, TerritoryPricing, TerritoryView } from '@iva-games/district/territorial';
import type { BoardSelection } from './TerritorialBoard';
import { ResourceIcon, ResourceStock, resourceName } from './TerritorialResources';
import { counterDraft, emptyTradeDraft, inspectTradeDraft, missingStock, parseTradeDraft, stockTotal, tradeDraftKey } from './territorialTradeDraft';
import type { TradeDraft } from './territorialTradeDraft';
import './territorial-actions.css';

export { ResourceIcon, ResourceStock, resourceName } from './TerritorialResources';

type Lang = 'ru' | 'en';
type Props = {
  view: TerritoryView; lang: Lang; selection: BoardSelection | null; busy: boolean;
  onAction: (action: TerritoryAction) => Promise<boolean> | void;
  onShowCouponRoutes?: (couponId: string) => void;
  selectedCouponId?: string | null;
  handPick?: { resource: Resource; serial: number } | null;
};
const word = (lang: Lang, ru: string, en: string) => lang === 'ru' ? ru : en;
const nameOf = (view: TerritoryView, id: string) => view.players.find(player => player.participantId === id)?.displayName ?? '…';
const cardNames: Record<CardKind, [string, string]> = {
  patrol: ['Патруль', 'Patrol'], survey: ['Подряд', 'Survey'], supply: ['Снабжение', 'Supply'], charter: ['Грамота', 'Charter'],
};
const cardHelp: Record<CardKind, [string, string]> = {
  patrol: ['Перенесите блокаду. Если у новой клетки есть соперник с ресурсами, возьмите у него одну случайную карту.', 'Move the blockade. If a rival beside the new tile has resources, take one random card from them.'],
  survey: ['Обычная цена двух следующих дорог или морских путей в этот ход — 0. Доплата по новости сохраняется.', 'The regular cost of your next two roads or sea lanes this turn is 0. Any news surcharge still applies.'],
  supply: ['Возьмите две выбранные единицы ресурсов из банка. Можно выбрать один ресурс дважды.', 'Take two resources of your choice from the bank. You may choose the same resource twice.'],
  charter: ['Даёт одно скрытое очко. Оно уже включено в ваш счёт; играть карту не нужно.', 'Gives one hidden point. It is already in your score; this card does not need to be played.'],
};
const couponNames: Record<CouponKind, [string, string]> = {
  'free-road': ['Бесплатная дорога', 'Free road'], 'upgrade-discount': ['Скидка на улучшение', 'Upgrade discount'],
  'card-discount': ['Скидка на карту', 'Card discount'], 'bank-exchange': ['Обмен 2 к 1', 'Two-for-one exchange'],
  restore: ['Восстановление дома', 'Building repair'],
};
const offerStatusNames: Record<TerritoryOfferStatus, [string, string]> = {
  accepted: ['Принято · обмен выполнен', 'Accepted · trade completed'], declined: ['Отклонено', 'Declined'],
  withdrawn: ['Отозвано автором', 'Withdrawn by the sender'], expired: ['Закрыто: ход завершён', 'Closed: the turn ended'],
  replaced: ['Заменено другими условиями', 'Replaced by new terms'], 'player-left': ['Закрыто: игрок вышел', 'Closed: a player left'],
  'match-finished': ['Закрыто: партия завершена', 'Closed: the match ended'],
};
const couponReasons: Record<TerritoryPricing['couponDecisions'][number]['reason'], [string, string]> = {
  eligible: ['Купон применяется.', 'This coupon applies.'], sector: ['Другой сектор.', 'This is a different sector.'],
  sea: ['Этот купон действует только на сухопутную дорогу.', 'This coupon covers land roads only.'],
  purchase: ['Купон предназначен для другого действия.', 'This coupon covers a different action.'],
  expired: ['Срок купона истёк.', 'This coupon has expired.'],
  'tactic-first': ['Сначала используется бесплатный путь по «Подряду». Купон остаётся.', 'A free route from Survey is used first. The coupon is kept.'],
  'other-coupon': ['Сначала используется другой подходящий купон.', 'Another eligible coupon is used first.'],
};

function Cost({ cost, hand, lang, pricing }: { cost: Partial<Stock>; hand: Stock; lang: Lang; pricing?: TerritoryPricing | null }) {
  const shortage = missingStock(hand, cost);
  const available = Object.fromEntries(RESOURCES.filter(resource => (pricing?.base[resource] ?? cost[resource] ?? 0) > 0 || (cost[resource] ?? 0) > 0)
    .map(resource => [resource, hand[resource]]));
  return <div className="ta-cost">
    {pricing && pricing.reason !== 'setup' && <div className="ta-cost-line"><span>{word(lang, 'Обычная цена', 'Regular cost')}</span><ResourceStock stock={pricing.base} lang={lang}/></div>}
    {pricing && stockTotal(pricing.discount) > 0 && <div className="ta-cost-line ta-discount"><span>{word(lang, pricing.reason === 'tactic' ? 'Подряд покрывает' : 'Купон покрывает', pricing.reason === 'tactic' ? 'Covered by Survey' : 'Covered by coupon')}</span><ResourceStock stock={pricing.discount} lang={lang}/></div>}
    {pricing && stockTotal(pricing.surcharge) > 0 && <div className="ta-cost-line ta-surcharge"><span>{word(lang, 'Доплата по новости', 'News surcharge')}</span><ResourceStock stock={pricing.surcharge} lang={lang}/></div>}
    <div className="ta-cost-line ta-cost-total"><strong>{word(lang, 'Итого', 'Total')}</strong><ResourceStock stock={cost} lang={lang}/></div>
    {Object.keys(available).length > 0 && <div className="ta-cost-line ta-available"><span>{word(lang, 'В руке', 'In hand')}</span><ResourceStock stock={available} lang={lang} resources={Object.keys(available) as Resource[]} showZero/></div>}
    {stockTotal(shortage) > 0 && <div className="ta-short"><strong>{word(lang, 'Не хватает', 'Missing')}</strong><ResourceStock stock={shortage} lang={lang}/></div>}
  </div>;
}

function Amounts({ value, onChange, lang, max, label, disabled = false }: {
  value: Stock; onChange: (next: Stock) => void; lang: Lang; max: Stock; label: string; disabled?: boolean;
}) {
  return <fieldset className="ta-amounts" disabled={disabled}><legend>{label}</legend>
    {RESOURCES.map(resource => <div key={resource} className="ta-pick-cell" data-resource={resource}>
      <ResourceIcon resource={resource}/><span>{resourceName(resource, lang)}</span>
      <input type="number" min={0} max={100} inputMode="numeric" aria-label={`${label} · ${resourceName(resource, lang)}`}
        aria-invalid={value[resource] > max[resource]} value={value[resource]} onChange={event => {
          const amount = Math.max(0, Math.min(100, Math.floor(Number(event.target.value) || 0)));
          onChange({ ...value, [resource]: amount });
        }}/>
      <small>{word(lang, 'Есть ', 'Have ')}{max[resource]}</small>
    </div>)}
  </fieldset>;
}

function TradeResources({ value, onChange, lang, max, label, disabled }: {
  value: Stock; onChange: (next: Stock) => void; lang: Lang; max?: Stock; label: string; disabled: boolean;
}) {
  const id = useId();
  return <fieldset className="ta-trade-side" disabled={disabled}>
    <legend>{label}</legend>
    <div className="ta-trade-palette">
      {RESOURCES.map(resource => {
        const name = resourceName(resource, lang);
        const amount = value[resource];
        const canAdd = amount < Math.min(max?.[resource] ?? 100, 100);
        const amountId = `${id}-${resource}`;
        return <div className="ta-trade-stack" key={resource} data-resource={resource} data-selected={amount > 0 || undefined}>
          <button type="button" className="ta-pick-add" title={name} aria-label={`${label} + ${name}`}
            aria-disabled={!canAdd || undefined} aria-describedby={amount > 0 ? amountId : undefined}
            onClick={() => { if (canAdd) onChange({ ...value, [resource]: amount + 1 }); }}>
            <ResourceIcon resource={resource}/>
            {amount > 0 ? <b className="ta-trade-count" id={amountId} aria-live="polite">{amount}</b> : <span aria-hidden="true">+</span>}
          </button>
          {amount > 0 && <button type="button" className="ta-pick-minus" title={word(lang, 'Убрать одну карту', 'Remove one card')}
            aria-label={`${label} − ${name}`} onClick={event => {
              if (amount === 1 && document.activeElement === event.currentTarget) {
                event.currentTarget.parentElement?.querySelector('button')?.focus({ preventScroll: true });
              }
              onChange({ ...value, [resource]: amount - 1 });
            }}>−</button>}
        </div>;
      })}
    </div>
  </fieldset>;
}

function ResourceChoice({ value, set, label, lang, disabled = false }: {
  value: Resource; set: (resource: Resource) => void; label: string; lang: Lang; disabled?: boolean;
}) {
  return <label className="ta-select">{label}<select aria-label={label} value={value} disabled={disabled} onChange={event => set(event.target.value as Resource)}>
    {RESOURCES.map(resource => <option key={resource} value={resource}>{resourceName(resource, lang)}</option>)}
  </select></label>;
}

function SelectedAction({ view, selection, busy, onAction, lang, selectedCouponId }: Props) {
  if (!selection) return null;
  const ru = lang === 'ru', id = selection.id;
  const node = selection.kind === 'node' ? view.map.nodes.find(item => item.id === id) : undefined;
  const edge = selection.kind === 'edge' ? view.map.edges.find(item => item.id === id) : undefined;
  const tile = selection.kind === 'tile' ? view.map.tiles.find(item => item.id === id) : undefined;
  if (!node && !edge && !tile) return null;
  const options = view.legal.options.filter(option => option.id === id && (selection.kind === 'edge' ? option.kind === 'route' : selection.kind === 'node' && option.kind !== 'route'));
  const building = node && view.buildings[id], route = edge && view.routes[id];
  const owner = building?.ownerId || route;
  const sector = view.map.sectors.find(item => item.id === (node ?? edge)?.eventSectorId);
  const port = node && view.map.ports.find(item => item.nodeId === id);
  const number = node ? view.map.nodes.indexOf(node) + 1 : edge ? view.map.edges.indexOf(edge) + 1 : tile ? view.map.tiles.indexOf(tile) + 1 : 0;
  const title = node ? (building ? word(lang, 'Дом', 'Building') : word(lang, 'Участок', 'Building site')) :
    edge ? edge.kind === 'sea' ? word(lang, 'Морской путь', 'Sea lane') : word(lang, 'Дорога', 'Road') :
      tile?.resource ? resourceName(tile.resource, lang) : word(lang, 'Пустошь', 'Heath');
  let note = '';
  if (tile) note = tile.id === view.blockedTileId ? word(lang, 'Производство заблокировано.', 'Production is blocked.') :
    tile.number ? word(lang, 'Даёт ресурсы при броске ', 'Produces resources on a roll of ') + tile.number + '.' : word(lang, 'Эта местность не производит ресурсы.', 'This terrain does not produce resources.');
  else if (!options.length) {
    if (edge && route) note = word(lang, 'Путь уже построен.', 'This route is already built.');
    else if (building && building.ownerId !== view.you.participantId) note = word(lang, 'Дом принадлежит другому игроку.', 'Another player owns this building.');
    else if (building?.level === 2) note = word(lang, 'Дом уже улучшен до уровня 2.', 'This building is already level 2.');
    else if (view.outcome) note = word(lang, 'Партия завершена. Карту можно рассматривать.', 'The match is complete. You can still explore the map.');
    else if (view.activeParticipantId !== view.you.participantId) note = word(lang, 'Строить можно в свой ход.', 'You can build on your turn.');
    else if (view.phase === 'setup-route') note = word(lang, 'Выберите свободную дорогу у только что поставленного дома.', 'Choose a free road beside the home you just placed.');
    else if (view.phase === 'setup-home') note = word(lang, 'Для стартового дома нужен свободный участок без соседнего дома.', 'A starting house needs a free site with no neighbouring house.');
    else if (view.phase === 'roll') note = word(lang, 'Сначала бросьте кубики.', 'Roll the dice first.');
    else if (view.phase === 'block' || view.phase === 'discard') note = word(lang, 'Сначала завершите обязательное действие.', 'Complete the required action first.');
    else if (node && !building) note = word(lang, 'Нужен свободный участок у своего пути, без соседнего дома и со свободной фигурой.', 'Use an available house piece at a free site on your route, with no neighbouring house.');
    else if (edge) note = word(lang, 'Продолжите свой путь или начните у своего дома. Нужен свободный сегмент; море начинается у прибрежного дома.', 'Extend your route or start at your house. A route piece must be available; sea lanes start at a coastal house.');
  }
  const blockade = tile?.id === view.blockedTileId ? view.blockade : null;
  const blockedNews = view.latestRoll?.blocked.filter(item => item.tileId === tile?.id && item.reason === 'news') ?? [];
  const productionNews = [...new Set(blockedNews.map(item => view.news.find(news => news.eventInstanceId === item.eventInstanceId)?.headline[lang]).filter(Boolean))];
  return <section className="ta-selected" aria-label={word(lang, 'Выбранное место', 'Selected location')}>
    <header><h4>{title} {number}</h4>{owner && <span className="ta-owner">{nameOf(view, owner)}</span>}</header>
    {sector && <small>{sector.name[lang]}</small>}
    {building && <small>{word(lang, 'Уровень ', 'Level ')}{building.level}</small>}
    {port && <p>{word(lang, 'Порт: ', 'Port: ')}{port.resource ? resourceName(port.resource, lang) : word(lang, 'любые ресурсы', 'any resource')}</p>}
    {node && node.exposureTags.length > 0 && <small>{node.exposureTags.map(tag => ({ coastal: ['Побережье', 'Coast'], floodplain: ['Пойма', 'Floodplain'], woodland: ['Лесная зона', 'Woodland'] }[tag][ru ? 0 : 1])).join(' · ')}</small>}
    {note && <p>{note}</p>}
    {blockade && <p className="ta-blockade-reason">{blockade.actorId ? nameOf(view, blockade.actorId) + ': ' : ''}{word(lang,
      blockade.reason === 'seven' ? 'перенос после семёрки' : blockade.reason === 'patrol' ? 'перенос картой «Патруль»' : 'причина не сохранилась в этой партии',
      blockade.reason === 'seven' ? 'moved after a seven' : blockade.reason === 'patrol' ? 'moved by Patrol' : 'the cause was not recorded in this match')}
      {blockade.round !== undefined ? ` · ${word(lang, 'круг ', 'round ')}${blockade.round + 1}` : ''}.</p>}
    {productionNews.length > 0 && <p>{word(lang, 'Последняя раздача ограничена новостью: ', 'The last production was limited by: ')}{productionNews.join('; ')}.</p>}
    {options.map(option => {
      const decisions = option.pricing?.couponDecisions.filter(decision => decision.couponId === selectedCouponId ||
        edge && view.you.coupons.find(coupon => coupon.id === decision.couponId)?.kind === 'free-road') ?? [];
      const actionName = option.kind === 'route' ? edge?.kind === 'sea' ? word(lang, 'Проложить морской путь', 'Open sea lane') : word(lang, 'Построить дорогу', 'Build road') :
        option.kind === 'upgrade' ? word(lang, 'Улучшить дом', 'Upgrade house') : word(lang, 'Построить дом', 'Build house');
      return <div className="ta-purchase" key={option.kind}>
        <Cost cost={option.cost} hand={view.you.hand} lang={lang} pricing={option.pricing}/>
        {decisions.map(decision => <p key={decision.couponId} className={decision.applies ? 'ta-discount' : 'ta-coupon-reason'}>{couponReasons[decision.reason][ru ? 0 : 1]}</p>)}
        <button type="button" className="ta-primary" disabled={busy || stockTotal(missingStock(view.you.hand, option.cost)) > 0}
          onClick={() => void onAction(option.kind === 'route' ? { type: 'route', edgeId: option.id } : { type: option.kind, nodeId: option.id })}>{actionName}</button>
      </div>;
    })}
    {view.you.protected.includes(id) && <p className="ta-discount">{word(lang, 'Дом защищён.', 'Building protected.')}</p>}
    {view.legal.protect && building?.ownerId === view.you.participantId && !view.you.protected.includes(id) && <div className="ta-purchase">
      <Cost cost={view.legal.protectionCost} hand={view.you.hand} lang={lang}/>
      <button type="button" disabled={busy || stockTotal(missingStock(view.you.hand, view.legal.protectionCost)) > 0} onClick={() => void onAction({ type: 'protect', nodeId: id })}>{word(lang, 'Защитить этот дом', 'Protect this building')}</button>
    </div>}
  </section>;
}

function Coupons({ view, lang, onShowCouponRoutes, selectedCouponId }: Props) {
  if (!view.you.coupons.length) return null;
  return <details className="ta-section ta-coupons" open><summary>{word(lang, 'Ваши купоны', 'Your coupons')} <span>{view.you.coupons.length}</span></summary>
    <div>{view.you.coupons.map(coupon => {
      const roads = view.legal.couponRoutes?.[coupon.id] ?? [];
      const zone = coupon.zone === null ? word(lang, 'Весь район', 'Whole district') : view.map.sectors.find(sector => sector.id === coupon.zone)?.name[lang];
      return <article className="ta-coupon" key={coupon.id}>
        <h4>{couponNames[coupon.kind][lang === 'ru' ? 0 : 1]}</h4><p>{zone} · {word(lang, 'до конца круга ', 'through round ')}{coupon.endsAfterRound}</p>
        {coupon.kind === 'free-road' && <>
          <small>{word(lang, 'Обычная цена сухопутной дороги — 0. Возможная доплата указана у выбранного пути.', 'The regular cost of a land road is 0. Any surcharge is shown for the selected route.')}</small>
          {onShowCouponRoutes && <button type="button" aria-pressed={selectedCouponId === coupon.id} onClick={() => onShowCouponRoutes(coupon.id)} disabled={!roads.length}>
            {word(lang, 'Показать подходящие дороги', 'Show eligible roads')} ({roads.length})</button>}
          {!roads.length && <small>{word(lang, view.activeParticipantId !== view.you.participantId || view.phase !== 'play' ? 'Подходящие дороги появятся в ваш ход после броска.' : 'Сейчас доступных дорог для этого купона нет.', view.activeParticipantId !== view.you.participantId || view.phase !== 'play' ? 'Eligible roads appear on your turn after rolling.' : 'There are no available roads for this coupon right now.')}</small>}
        </>}
      </article>;
    })}</div>
  </details>;
}

const BANK_RECEIPT_MS = 4_000;
type BankAttempt = { revision: number; turn: number; give: Resource; receive: Resource; rate: number };

function BankTrade({ view, lang, busy, onAction, handPick, active }: Props & { active: boolean }) {
  const [give, setGive] = useState<Resource>('wood'), [receive, setReceive] = useState<Resource>('brick');
  const [sending, setSending] = useState(false);
  const [receipt, setReceipt] = useState<BankAttempt | null>(null);
  const [failed, setFailed] = useState(false);
  const awaitingBank = useRef<BankAttempt | null>(null);
  const bankOpen = useRef(active);
  const picked = useRef(handPick?.serial);
  useLayoutEffect(() => {
    bankOpen.current = active;
    if (!active) setReceipt(null);
  }, [active]);
  useEffect(() => {
    if (!receipt) return;
    const timer = window.setTimeout(() => setReceipt(current => current === receipt ? null : current), BANK_RECEIPT_MS);
    return () => window.clearTimeout(timer);
  }, [receipt]);
  useEffect(() => {
    if (!handPick || picked.current === handPick.serial) return;
    picked.current = handPick.serial;
    if (active && !busy) { setGive(handPick.resource); setReceipt(null); }
  }, [handPick, active, busy]);
  const rate = view.legal.bank[give], cost = { [give]: rate };
  const canTrade = view.activeParticipantId === view.you.participantId && view.phase === 'play';
  const available = view.bank[receive] > 0;
  const same = give === receive;
  const shortage = missingStock(view.you.hand, cost);
  const visibleReceipt = active && receipt?.turn === view.turn ? receipt : null;
  const confirmBank = useCallback((attempt: BankAttempt) => {
    // Polling and the POST response can confirm the same exchange in either order.
    if (awaitingBank.current !== attempt) return;
    awaitingBank.current = null;
    setFailed(false);
    if (bankOpen.current) setReceipt(attempt);
  }, []);
  useEffect(() => {
    const pending = awaitingBank.current;
    if (!pending) return;
    const committed = view.history?.find(entry => entry.kind === 'bank' && entry.actorId === view.you.participantId &&
      entry.turn === pending.turn && entry.revision > pending.revision &&
      entry.paid?.[pending.give] === pending.rate && entry.received?.[pending.receive] === 1);
    if (committed) confirmBank(pending);
  }, [view.history, view.you.participantId, confirmBank]);
  return <section className="ta-section ta-bank" aria-label={word(lang, 'Обмен с банком', 'Bank exchange')}>
    <div className="ta-form">
      <div className="ta-exchange"><div><ResourceChoice lang={lang} value={give} set={resource => { setGive(resource); setReceipt(null); }} label={word(lang, 'Отдаю', 'I give')} disabled={busy || sending}/>
        <ResourceStock stock={cost} lang={lang}/><small>{word(lang, 'В руке: ', 'In hand: ')}{view.you.hand[give]}</small></div>
        <span className="ta-exchange-sign" aria-hidden="true">⇄</span>
        <div><ResourceChoice lang={lang} value={receive} set={resource => { setReceive(resource); setReceipt(null); }} label={word(lang, 'Получаю', 'I receive')} disabled={busy || sending}/>
          <ResourceStock stock={{ [receive]: 1 }} lang={lang}/><small>{word(lang, 'В банке: ', 'In bank: ')}{view.bank[receive] >= 2 ? '2+' : view.bank[receive]}</small></div>
      </div>
      <div className="ta-bank-palette" aria-label={word(lang,'Получаемый ресурс','Requested resource')}>{RESOURCES.map(resource => <button key={resource} type="button"
        disabled={busy || sending || resource === give || view.bank[resource] === 0} aria-pressed={resource === receive} aria-label={word(lang,'Получить ','Receive ') + resourceName(resource,lang)}
        onClick={() => { setReceive(resource); setReceipt(null); }}><ResourceIcon resource={resource}/></button>)}</div>
      <p className="ta-rate">{word(lang, 'Ваш курс: ', 'Your rate: ')}<strong>{rate} : 1</strong></p>
      {!canTrade ? <p>{word(lang, 'Обмен с банком доступен в ваш ход после броска.', 'Bank exchange is available on your turn after rolling.')}</p> : same ? <p>{word(lang, 'Выберите разные ресурсы.', 'Choose different resources.')}</p> :
        !available ? <p>{word(lang, 'Этот ресурс закончился в банке.', 'The bank has run out of this resource.')}</p> : stockTotal(shortage) > 0 ? <p className="ta-short">{word(lang, 'Не хватает', 'Missing')} <ResourceStock stock={shortage} lang={lang}/></p> : null}
      <button type="button" className="ta-primary" disabled={busy || sending || !canTrade || same || !available || stockTotal(shortage) > 0} onClick={async () => {
        setSending(true); setFailed(false); setReceipt(null);
        const attempt = { revision: view.revision, turn: view.turn, give, receive, rate };
        awaitingBank.current = attempt;
        try {
          if (await onAction({ type: 'bank', give, receive }) === true) confirmBank(attempt);
          else if (awaitingBank.current === attempt) setFailed(true);
        } catch { if (awaitingBank.current === attempt) setFailed(true); }
        finally { setSending(false); }
      }}>{sending ? word(lang, 'Обмениваем…', 'Exchanging…') : word(lang, 'Обменять', 'Exchange')} {rate} → 1</button>
      {visibleReceipt && <div className="ta-feedback ta-success" role="status"><strong>{word(lang, 'Обмен выполнен', 'Exchange completed')}</strong>
        <span>− <ResourceStock lang={lang} stock={{ [visibleReceipt.give]: visibleReceipt.rate }}/> · + <ResourceStock lang={lang} stock={{ [visibleReceipt.receive]: 1 }}/></span></div>}
      {failed && <p className="ta-feedback" role="status">{word(lang, 'Обмен не подтверждён. Условия сохранены; проверьте сообщение о связи.', 'The exchange was not confirmed. Your terms are kept; check the connection message.')}</p>}
      <details className="ta-bank-stock"><summary>{word(lang, 'Ресурсы банка', 'Bank resources')}</summary>
        <ResourceStock stock={view.bank} lang={lang} showZero bank/>
        <small>{word(lang, '2+ означает: доступно не меньше двух.', '2+ means at least two are available.')}</small>
      </details>
    </div>
  </section>;
}

function OfferTerms({ give, receive, lang, author }: { give: Stock; receive: Stock; lang: Lang; author: string }) {
  return <div className="ta-offer-terms">
    <div><span>{author} {word(lang,'предлагает','offers')}:</span><ResourceStock stock={give} lang={lang}/></div>
    <div><span>{author} {word(lang,'получает','receives')}:</span><ResourceStock stock={receive} lang={lang}/></div>
  </div>;
}

function OfferCard({ offer, view, lang, busy, onAction, onCounter, onResponse, compact = false }: {
  offer: TerritoryOffer; view: TerritoryView; lang: Lang; busy: boolean;
  onAction: Props['onAction']; onCounter: (offer: TerritoryOffer) => void; onResponse?: () => void; compact?: boolean;
}) {
  const mine = offer.authorId === view.you.participantId;
  const other = mine ? offer.targetId : offer.authorId;
  const give = mine ? offer.give : offer.receive;
  const shortage = missingStock(view.you.hand, give);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const actionable = view.legal.trade && !busy && !sending;
  const agreed = offer.agreedAt !== undefined;
  const canChoose = mine && agreed && !!offer.groupId;
  const canAccept = offer.canAccept ?? (stockTotal(shortage) === 0 && offer.unavailableReason !== 'author-resources');
  async function respond(type: 'accept' | 'decline' | 'cancel') {
    setSending(true); setFailed(false);
    try {
      if (await onAction({ type, offerId: offer.id }) !== true) setFailed(true);
      else onResponse?.();
    } catch { setFailed(true); }
    finally { setSending(false); }
  }
  const name = nameOf(view,other);
  const player = view.players.find(item=>item.participantId===other);
  const identity = <span className="ta-player-dot" style={{background:['#ca4e37','#2867a8','#79498f','#2c7954'][player?.seatIndex ?? 0]}} title={name} aria-label={name}>{(player?.seatIndex ?? 0)+1}</span>;
  return <article className={`ta-offer${mine ? ' is-outgoing' : ''}`} data-offer-id={offer.id} data-offer-status={agreed ? 'agreed' : 'waiting'}>
    {!compact && <OfferTerms give={offer.give} receive={offer.receive} lang={lang} author={nameOf(view,offer.authorId)}/>}
    <div className="ta-response-chip">{identity}
      {mine ? canChoose ? <button type="button" className="ta-primary" disabled={!actionable || !canAccept}
        aria-label={`${word(lang,'Обменяться','Trade with')} ${name}`} title={offer.unavailableReason==='inactive-pair' ? word(lang,'Обмен возможен только с активным игроком','Trade with the active player') : word(lang,'Выбрать игрока','Choose player')}
        onClick={()=>void respond('accept')}>✅</button> : <span role="img" aria-label={word(lang,'Ждём ответа','Awaiting response')}>🤔</span>
        : agreed ? <span role="img" aria-label={word(lang,'Согласие отправлено · ждём выбора','Agreed · awaiting selection')}>✅</span>
        : <button type="button" className="ta-primary" disabled={!actionable || !canAccept} aria-label={word(lang,'Принять','Accept')}
          title={stockTotal(shortage)>0 ? word(lang,'Не хватает ресурсов','Missing resources') : offer.unavailableReason==='author-resources' ? word(lang,'У автора не хватает ресурсов','Sender lacks resources') : word(lang,'Принять','Accept')} onClick={()=>void respond('accept')}>✅</button>}
      {!mine && <><button type="button" disabled={busy || sending} aria-label={word(lang,'Другие условия','Counteroffer')} title={word(lang,'Другие условия','Counteroffer')} onClick={()=>onCounter(offer)}>↔</button>
        <button type="button" disabled={!actionable} aria-label={word(lang,'Отклонить','Decline')} title={word(lang,'Отклонить','Decline')} onClick={()=>void respond('decline')}>❌</button></>}
      {mine && !offer.groupId && <button type="button" disabled={!actionable} aria-label={word(lang,'Отозвать','Withdraw')} onClick={()=>void respond('cancel')}>❌</button>}
    </div>
    {failed && <p className="ta-feedback" role="status">{word(lang,'Ответ не подтверждён. Повторите.','Response not confirmed. Retry.')}</p>}
  </article>;

}

function PlayerTrade({ view, lang, busy, onAction, handPick }: Props) {
  const own = view.you.participantId;
  const storageKey = tradeDraftKey(view.matchId, own);
  const targets = view.players.filter(player => player.participantId !== own && !player.left);
  const initialTarget = '*';
  const [draft, setDraft] = useState<TradeDraft>(() => {
    try { return parseTradeDraft(sessionStorage.getItem(storageKey)) ?? emptyTradeDraft(initialTarget); }
    catch { return emptyTradeDraft(initialTarget); }
  });
  const [sending, setSending] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [offersOpen, setOffersOpen] = useState(true);
  const offerPanelId = useId();
  const tradeWindowId = useId();
  const offerToggle = useRef<HTMLButtonElement>(null);
  const knownOffers = useRef(new Set(view.offers.map(offer => offer.id)));
  useEffect(() => {
    if (view.offers.some(offer => !knownOffers.current.has(offer.id))) setOffersOpen(true);
    knownOffers.current = new Set(view.offers.map(offer => offer.id));
  }, [view.offers]);
  const [sendFailed, setSendFailed] = useState(false);
  const picked = useRef(handPick?.serial);
  useEffect(() => {
    if (!handPick || picked.current === handPick.serial) return;
    picked.current = handPick.serial;
    if (bankOpen || busy || sending) return;
    const resource = handPick.resource;
    const limit = Math.min(view.you.hand[resource], 100);
    setSendFailed(false);
    setDraft(current => ({ ...current, editing: true, targetId: current.targetId || initialTarget,
      give: current.give[resource] < limit ? { ...current.give, [resource]: current.give[resource] + 1 } : current.give }));
  }, [handPick, bankOpen, busy, sending, initialTarget, view.you.hand]);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const editor = useRef<HTMLDivElement>(null), newButton = useRef<HTMLButtonElement>(null);
  const resetButton = useRef<HTMLButtonElement>(null), keepDraftButton = useRef<HTMLButtonElement>(null);
  const tradeHeading = useRef<HTMLHeadingElement>(null);
  const focusEditor = useRef(false);
  const focusAfterClose = useRef(false);
  const awaitingOffer = useRef<{ draft: TradeDraft; knownIds: Set<string> } | null>(null);
  const state = inspectTradeDraft(view, draft);
  const hasContent = draft.parentId !== null || stockTotal(draft.give) > 0 || stockTotal(draft.receive) > 0;
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(draft)); }
    catch { setStorageAvailable(false); }
  }, [storageKey, draft]);
  useEffect(() => {
    if (discardConfirm) keepDraftButton.current?.focus({ preventScroll: true });
  }, [discardConfirm]);
  useEffect(() => {
    if (draft.editing && !bankOpen && focusEditor.current) {
      focusEditor.current = false;
      editor.current?.querySelector<HTMLElement>('select:not(:disabled), button:not(:disabled):not([aria-disabled="true"])')?.focus({ preventScroll: true });
    }
    if (!draft.editing && !bankOpen && focusAfterClose.current) {
      focusAfterClose.current = false;
      (newButton.current?.disabled ? tradeHeading.current : newButton.current)?.focus({ preventScroll: true });
    }
  }, [draft.editing, draft.parentId, bankOpen]);
  useEffect(() => {
    const pending = awaitingOffer.current;
    if (!pending) return;
    const sameTerms = (value: Pick<TradeDraft, 'targetId' | 'give' | 'receive' | 'parentId'>) =>
      (value.targetId === pending.draft.targetId || pending.draft.targetId === '*' && value.targetId !== own) && value.parentId === pending.draft.parentId &&
      RESOURCES.every(resource => value.give[resource] === pending.draft.give[resource] && value.receive[resource] === pending.draft.receive[resource]);
    const confirmed = [...view.offers, ...(view.offerHistory ?? [])].find(offer => offer.authorId === own &&
      !pending.knownIds.has(offer.id) && sameTerms({ ...offer, parentId: offer.parentId ?? null }));
    if (!confirmed) return;
    // A poll/retry can supply the durable offer even when the original HTTP response was lost.
    // Only its explicit terms identify it; a changed hand never counts as a trade confirmation.
    awaitingOffer.current = null;
    setSendFailed(false);
    setDraft(current => {
      if (!sameTerms(current)) return current;
      focusAfterClose.current = true;
      return { ...current, parentId: null, editing: false };
    });
  }, [own, view.offers, view.offerHistory]);
  function update(next: Partial<TradeDraft>) { setDraft(current => ({ ...current, ...next })); setSendFailed(false); }
  function edit(offer?: TerritoryOffer) {
    awaitingOffer.current = null;
    setBankOpen(false); setSendFailed(false); setDiscardConfirm(false); focusEditor.current = true;
    setDraft(current => offer ? counterDraft(offer) : { ...current, editing: true, targetId: current.targetId || initialTarget });
  }
  function closeEditor() {
    focusEditor.current = false;
    focusAfterClose.current = true;
    setBankOpen(false);
    setDiscardConfirm(false);
    update({ editing: false });
  }
  async function send() {
    if (!state.ready || sending || busy) return;
    setSending(true); setSendFailed(false);
    awaitingOffer.current = { draft: { ...draft, give: { ...draft.give }, receive: { ...draft.receive } },
      knownIds: new Set([...view.offers, ...(view.offerHistory ?? [])].map(offer => offer.id)) };
    const targetIds = targets.map(p => p.participantId);
    const action: TerritoryAction = { type: 'offer', targetId: state.parent?.authorId ?? targetIds[0], ...(targetIds.length > 1 ? { targetIds } : {}), give: { ...draft.give }, receive: { ...draft.receive }, ...(state.parent ? { parentId: state.parent.id } : {}) };
    try {
      const confirmed = await onAction(action);
      if (confirmed === true) {
        awaitingOffer.current = null;
        focusAfterClose.current = true;
        setDraft(current => ({ ...current, parentId: null, editing: false }));
      } else if (awaitingOffer.current) setSendFailed(true);
    } catch { if (awaitingOffer.current) setSendFailed(true); }
    finally { setSending(false); }
  }
  const stack = useRef<HTMLDivElement>(null);
  const bundles = new Map<string, TerritoryOffer[]>();
  for (const offer of [...view.offers].reverse()) {
    const key = offer.authorId === own && offer.groupId ? offer.groupId : offer.id;
    const bundle = bundles.get(key);
    if (bundle) bundle.push(offer);
    else bundles.set(key, [offer]);
  }
  const latestClosedGroup = (view.offerHistory ?? []).filter(offer => offer.authorId === own).at(-1)?.groupId;
  for (const offer of view.offerHistory ?? []) {
    if (offer.authorId === own && offer.groupId === latestClosedGroup && offer.groupId && !view.offers.some(active => active.authorId === own) && (offer.status === 'declined' || offer.responseExpired) && offer.closedTurn === view.turn && !(view.offerHistory ?? []).some(closed => closed.groupId === offer.groupId && closed.status !== 'declined' && !closed.responseExpired) && !bundles.has(offer.groupId)) {
      bundles.set(offer.groupId, []);
    }
  }
  const offerCount = view.offers.length + [...bundles.values()].filter(items => !items.length).length;
  return <section className="ta-trades territory-trade-dock" aria-label={word(lang, 'Сделки с игроками', 'Player trades')}>
    <header className="ta-section-heading territory-sr-only"><h4 ref={tradeHeading} tabIndex={-1}>{word(lang, 'Сделки с игроками', 'Player trades')}</h4></header>
    <button type="button" className="ta-offer-toggle" ref={offerToggle} hidden={!offerCount || offersOpen}
      aria-controls={offerPanelId} aria-expanded={offersOpen} aria-label={word(lang, 'Показать сделки', 'Show offers')}
      onClick={() => setOffersOpen(true)}>{word(lang, 'Сделки', 'Offers')} <b>{offerCount}</b></button>
    <section className="ta-offers-panel" id={offerPanelId} hidden={!offerCount || !offersOpen} aria-label={word(lang, 'Предложения обмена', 'Trade offers')}>
      <header className="ta-offer-heading"><strong>{word(lang, 'Сделки', 'Offers')} <span>{offerCount}</span></strong>
        <button type="button" aria-label={word(lang, 'Свернуть сделки', 'Collapse offers')} onClick={() => {
          setOffersOpen(false);
          requestAnimationFrame(() => offerToggle.current?.focus());
        }}>{word(lang, 'Свернуть', 'Collapse')} <span aria-hidden="true">⌄</span></button></header>
    <div className="ta-offer-stack" ref={stack} aria-live="polite">
      {[...bundles].map(([key, items]) => {
        const terms = items[0] ?? (view.offerHistory ?? []).find(offer => offer.groupId === key)!;
        const grouped = terms.authorId === own && !!terms.groupId;
        const render = (offer: TerritoryOffer) => <OfferCard key={offer.id} offer={offer} compact={grouped}
          view={view} lang={lang} busy={busy || sending} onAction={onAction} onCounter={edit} onResponse={() => tradeHeading.current?.focus({ preventScroll: true })}/>;
        if (!grouped) return render(terms);
        return <section key={key} className="ta-offer-group" data-group-id={key}>
          <div className="ta-group-heading"><OfferTerms give={terms.give} receive={terms.receive} lang={lang} author={nameOf(view,terms.authorId)}/>{items.length > 0 && <button type="button" className="ta-group-cancel" disabled={busy || sending} aria-label={word(lang,'Отменить предложение всем','Withdraw offer for everyone')} title={word(lang,'Отменить предложение','Withdraw offer')} onClick={()=>void onAction({type:'cancel',offerId:items[0].id})}>❌</button>}</div>
          <div className="ta-response-list">{[...items, ...(view.offerHistory ?? []).filter(offer=>offer.groupId===key && (offer.status==='declined'||offer.status==='replaced'||offer.responseExpired))].sort((a,b)=>(view.players.find(player=>player.participantId===a.targetId)?.seatIndex??0)-(view.players.find(player=>player.participantId===b.targetId)?.seatIndex??0)).map(offer=>items.some(active=>active.id===offer.id) ? render(offer) : <div key={offer.id} className="ta-closed-response"><span className="ta-player-dot" style={{background:['#ca4e37','#2867a8','#79498f','#2c7954'][view.players.find(player=>player.participantId===offer.targetId)?.seatIndex??0]}} title={nameOf(view,offer.targetId)}>{(view.players.find(player=>player.participantId===offer.targetId)?.seatIndex??0)+1}</span><span role="img" aria-label={`${nameOf(view,offer.targetId)} · ${'responseExpired' in offer && offer.responseExpired ? word(lang,'Нет ответа за 10 секунд','No response in 10 seconds') : word(lang,'Нет согласия','Not agreed')}`}>❌</span></div>)}
          </div>
        </section>;
      })}
    </div>
    </section>
    <button type="button" ref={newButton} className="ta-trade-open" disabled={sending || !!view.outcome} aria-expanded={draft.editing || bankOpen} aria-controls={tradeWindowId}
      aria-label={word(lang, hasContent ? 'Продолжить сохранённые условия' : 'Предложить обмен', hasContent ? 'Continue saved terms' : 'Offer a trade')}
      onClick={() => draft.editing || bankOpen ? closeEditor() : edit()}><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7h17l-4-4m4 4-4 4M21 17H4l4-4m-4 4 4 4"/></svg>{word(lang,'Торговать','Trade')}</button>
    <div className="ta-trade-window" id={tradeWindowId} hidden={!draft.editing && !bankOpen} onKeyDown={event => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      closeEditor();
    }}>
      <div className="ta-trade-tabs"><button type="button" aria-pressed={!bankOpen} onClick={() => {setBankOpen(false); if(!draft.editing) edit();}}>{word(lang,'Игроки','Players')}</button>
        <button type="button" aria-pressed={bankOpen} onClick={() => { setBankOpen(true); setDiscardConfirm(false); }}>{word(lang,'Банк','Bank')}</button>
        {draft.editing && !bankOpen && hasContent && <button type="button" ref={resetButton} className="ta-trade-reset" disabled={sending}
          aria-label={word(lang, 'Удалить черновик', 'Discard draft')} onClick={() => setDiscardConfirm(true)}>{word(lang, 'Сбросить', 'Reset')}</button>}
        <button type="button" className="ta-close" aria-label={word(lang,'Закрыть торговлю','Close trade')} onClick={closeEditor}>×</button></div>
      <div hidden={!bankOpen}><BankTrade view={view} lang={lang} busy={busy} selection={null} onAction={onAction} handPick={handPick} active={bankOpen}/></div>
    {draft.editing && !bankOpen && <div className="ta-form ta-trade-editor" ref={editor} data-trade-draft="open" role="group"
      aria-label={word(lang, draft.parentId ? 'Встречные условия' : 'Ваше предложение', draft.parentId ? 'Counteroffer' : 'Your offer')}>
      {draft.parentId && !state.parent && <div className="ta-feedback ta-reuse-draft" role="status">
        <strong>{state.closedParent?.responseExpired ? word(lang,'Нет ответа за 10 секунд','No response in 10 seconds') : state.closedParent ? offerStatusNames[state.closedParent.status][lang === 'ru' ? 0 : 1] : word(lang, 'Исходное предложение закрыто', 'The original offer has closed')}</strong>
        <button type="button" disabled={sending || busy || !!view.outcome} onClick={() => update({ parentId: null })}>{word(lang, 'Предложить снова', 'Use as a new offer')}</button>
      </div>}
      <TradeResources lang={lang} label={word(lang, 'Отдаю', 'I give')} value={draft.give} onChange={give => update({ give })} max={view.you.hand} disabled={sending || busy}/>
      <TradeResources lang={lang} label={word(lang, 'Получаю', 'I receive')} value={draft.receive} onChange={receive => update({ receive })} disabled={sending || busy}/>
      {!view.legal.trade && <p className="ta-feedback">{word(lang, view.outcome ? 'Партия завершена.' : 'Торгуйте после броска и обязательных действий.', view.outcome ? 'The match is complete.' : 'Trade after the roll and required actions.')}</p>}
      {draft.targetId && !state.targetAllowed && <p className="ta-feedback">{word(lang, 'Выберите игрока, чей сейчас ход, или дождитесь своего.', 'Choose the active player, or wait for your turn.')}</p>}
      {state.overlaps && <p className="ta-short">{word(lang, 'Каждый ресурс должен быть только на одной стороне.', 'Put each resource on only one side of the trade.')}</p>}
      {stockTotal(state.shortage) > 0 && <p className="ta-short">{word(lang, 'Не хватает', 'Missing')} <ResourceStock stock={state.shortage} lang={lang}/></p>}
      <div className="ta-trade-footer">
        <span className="ta-muted">{word(lang, 'Всем игрокам · выберите согласного', 'All players · choose who to trade with')}</span>
        <button type="button" className="ta-primary" disabled={busy || sending || !state.ready} onClick={() => void send()}>{sending ? word(lang, 'Отправляем…', 'Sending…') : word(lang, 'Отправить', 'Send offer')}</button>
      </div>
      {!storageAvailable && hasContent && <small className="ta-muted" role="status">{word(lang, 'До закрытия страницы', 'Until this page closes')}</small>}
      {discardConfirm && <div className="ta-feedback"><p>{word(lang, 'Удалить сохранённые условия?', 'Discard your saved terms?')}</p><div className="ta-buttons">
        <button type="button" onClick={() => { focusAfterClose.current = true; setDraft(emptyTradeDraft(initialTarget)); setDiscardConfirm(false); }}>{word(lang, 'Удалить', 'Discard')}</button>
        <button type="button" ref={keepDraftButton} onClick={() => { setDiscardConfirm(false); resetButton.current?.focus({ preventScroll: true }); }}>{word(lang, 'Оставить', 'Keep')}</button></div></div>}
    </div>}
    {sendFailed && <p className="ta-feedback" role="status">{word(lang,'Отправка не подтверждена. Черновик сохранён.','Sending was not confirmed. Your draft is kept.')}</p>}
    </div>
  </section>;
}

function CardArt({ kind }: { kind: CardKind }) {
  return <svg className="ta-card-art" viewBox="0 0 64 48" fill="none" aria-hidden="true" focusable="false">
    {kind === 'patrol' && <><path d="M32 4 50 11v13q-2 13-18 20C16 37 14 24 14 24V11z" fill="#bdd8d4" stroke="#3d737d" strokeWidth="2"/><path d="m32 14 3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1z" fill="#4b7e87"/><path d="M32 5v38" stroke="#f2faf0" strokeWidth="1.2"/></>}
    {kind === 'survey' && <><path d="m9 11 14-5 18 5 14-5v31l-14 6-18-5-14 5z" fill="#ebdbb4" stroke="#968061" strokeWidth="1.8"/><path d="M23 6v32m18-27v32" stroke="#b69f7c"/><path d="m14 30 13-12 10 9 13-13m-36 22 13-12 10 9 13-13" stroke="#497b7c" strokeWidth="2.4"/><circle cx="14" cy="30" r="3" fill="#ca714f"/><circle cx="50" cy="14" r="3" fill="#ca714f"/></>}
    {kind === 'supply' && <><path d="m8 22 15-8 14 7-15 8z" fill="#dcb97d" stroke="#977147"/><path d="m8 22 14 7v14L8 36zm14 7 15-8v15l-15 7z" fill="#c6995c" stroke="#977147"/><path d="m30 10 14-7 13 6-14 8z" fill="#ebce97" stroke="#977147"/><path d="m30 10 13 7v17l-13-7zm13 7 14-8v17l-14 8z" fill="#d9b27a" stroke="#977147"/><path d="m36 13 14-7m-35 20 14-8" stroke="#fff0c6" strokeWidth="3"/></>}
    {kind === 'charter' && <><path d="M18 5h30v34H18z" fill="#f7edd3" stroke="#b2996e" strokeWidth="1.7"/><path d="M18 5h-6v6h6m0 28h-6v5h30v-5" fill="#ead8ad" stroke="#b2996e" strokeWidth="1.7"/><path d="M25 13h16m-16 5h16m-16 5h10" stroke="#84928a" strokeWidth="2"/><path d="m35 34-3 10 6-3 4 3-2-10" fill="#3b7b83"/><circle cx="37" cy="31" r="6" fill="#c79946" stroke="#9f783e"/><path d="m37 27 1 3 3 1-3 1-1 3-1-3-3-1 3-1z" fill="#f4e1ac"/></>}
  </svg>;
}

type CardFeedback = CardKind | 'bought' | 'unconfirmed';

function cardFeedbackText(view: TerritoryView, kind: CardFeedback, lang: Lang) {
  if (kind === 'bought') return word(lang, 'Карта куплена и добавлена в вашу руку.', 'Card bought and added to your hand.');
  if (kind === 'supply') return word(lang, 'Снабжение получено. Две единицы добавлены в руку.', 'Supplies received. Two units were added to your hand.');
  if (kind === 'patrol') return view.pendingBlockade?.actorId === view.you.participantId && view.pendingBlockade.reason === 'patrol'
    ? word(lang, 'Патруль сыгран. Выберите клетку и цель блокады.', 'Patrol played. Choose the blockade tile and target.')
    : word(lang, 'Патруль завершён. Блокада перенесена.', 'Patrol complete. The blockade has moved.');
  if (kind === 'survey') {
    const history = view.history ?? [];
    const played = [...history].reverse().find(entry => entry.actorId === view.you.participantId && entry.turn === view.turn && entry.kind === 'play-card' && entry.cardKind === 'survey');
    const built = played ? history.filter(entry => entry.actorId === view.you.participantId && entry.turn === view.turn && entry.kind === 'route' && entry.revision > played.revision).length : 0;
    if (built >= 2) return word(lang, 'Подряд завершён. Оба пути построены.', 'Survey complete. Both routes are built.');
    if (!view.legal.options.some(option => option.kind === 'route' && option.pricing?.reason === 'tactic'))
      return word(lang, 'Сейчас нет доступного пути по Подряду.', 'No Survey route is available right now.');
    return built === 1
      ? word(lang, 'Подряд: выберите второй путь на карте.', 'Survey: choose the second route on the map.')
      : word(lang, 'Подряд: выберите первый путь на карте.', 'Survey: choose the first route on the map.');
  }
  return word(lang, 'Действие не подтверждено. Проверьте сообщение о связи.', 'The action was not confirmed. Check the connection message.');
}

function TacticalCards({ view, lang, busy, onAction }: Props) {
  const [first, setFirst] = useState<Resource>('wood'), [second, setSecond] = useState<Resource>('brick');
  const [confirm, setConfirm] = useState<string | null>(null), [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: CardFeedback; turn: number } | null>(null);
  const heading = useRef<HTMLElement>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const cost = view.legal.buyCard, index = lang === 'ru' ? 0 : 1;
  const shownCost = cost ?? view.legal.buyCardPricing?.total;
  const supplyReady = view.bank[first] > 0 && view.bank[second] > 0 && (first !== second || view.bank[first] >= 2);
  const remember = (kind: CardFeedback) => setFeedback({ kind, turn: view.turn });
  const feedbackText = feedback?.turn === view.turn && !view.outcome ? cardFeedbackText(view, feedback.kind, lang) : null;
  async function play(cardId: string, kind: CardKind) {
    setSending(true); setFeedback(null);
    try {
      if (await onAction({ type: 'play-card', cardId, ...(kind === 'supply' ? { resources: [first, second] } : {}) }) === true) {
        setConfirm(null);
        remember(kind);
        if ((kind === 'survey' || kind === 'patrol') && details.current) details.current.open = false;
        heading.current?.focus({ preventScroll: true });
      } else remember('unconfirmed');
    } catch { remember('unconfirmed'); }
    finally { setSending(false); }
  }
  function availability(card: TerritoryView['you']['cards'][number]) {
    if (card.kind === 'charter') return word(lang, 'Уже даёт +1 очко', 'Already gives +1 point');
    if (card.playable) return word(lang, 'Доступна сейчас', 'Available now');
    if (view.outcome) return word(lang, 'Партия завершена', 'Match complete');
    if (card.bought >= view.turn) return word(lang, 'Со следующего вашего хода', 'From your next turn');
    if (view.activeParticipantId !== view.you.participantId) return word(lang, 'В ваш ход после броска', 'On your turn after rolling');
    if (view.phase !== 'play') return word(lang, 'После броска и обязательных действий', 'After rolling and required actions');
    return word(lang, 'В этот ход карта уже сыграна', 'A card was already played this turn');
  }
  return <details ref={details} className="ta-section ta-cards">
    <summary ref={heading} tabIndex={0} title={word(lang,'Карты развития','Development cards')} aria-label={word(lang,'Карты развития','Development cards')}><svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="5" y="5" width="16" height="23" rx="3" transform="rotate(-13 13 16)" fill="#9fb9b2" stroke="#47747b" strokeWidth="1.5"/><rect x="12" y="3" width="16" height="24" rx="3" fill="#f1d698" stroke="#936f3e" strokeWidth="1.5"/><path d="m20 8 2 4 4 1-3 3 .5 4-3.5-2-3.5 2 .5-4-3-3 4-1z" fill="#537f83"/><path d="M16 23h8" stroke="#936f3e" strokeWidth="1.5"/></svg><span>{view.you.cards.length}</span></summary>
    <div className="ta-form ta-card-panel">
      <header className="ta-card-heading"><h4>{word(lang,'Карты развития','Development cards')}</h4>
        <button type="button" className="ta-close" aria-label={word(lang,'Закрыть карты развития','Close development cards')} onClick={() => {
          if (details.current) details.current.open = false;
          heading.current?.focus({ preventScroll: true });
        }}>×</button></header>
      <p className="ta-muted">{word(lang, 'Одна активная карта за ход; купленную можно сыграть со следующего своего хода.', 'Play one active card per turn; a purchased card becomes playable on your next turn.')}</p>
      {shownCost && view.cardsAvailable > 0 && <div className="ta-buy-card"><Cost lang={lang} cost={shownCost} hand={view.you.hand} pricing={view.legal.buyCardPricing}/>
        {!cost && !view.outcome && <small>{word(lang, 'Купить можно в свой ход после броска.', 'Buy on your turn after rolling.')}</small>}
        <button type="button" disabled={busy || sending || !cost || stockTotal(missingStock(view.you.hand, shownCost)) > 0} onClick={async () => {
          setSending(true); setFeedback(null);
          try { remember(await onAction({ type: 'buy-card' }) === true ? 'bought' : 'unconfirmed'); }
          catch { remember('unconfirmed'); }
          finally { setSending(false); }
        }}>{word(lang, 'Купить карту', 'Buy a card')}</button></div>}
      {view.you.cards.map(card => <article className={`ta-tactic ta-tactic-${card.kind}${card.playable ? ' is-playable' : ''}`} key={card.id} data-card-id={card.id}>
        <header><CardArt kind={card.kind}/><div><h4>{cardNames[card.kind][index]}</h4><span className="ta-card-state">{availability(card)}</span></div></header>
        <p>{cardHelp[card.kind][index]}</p>
        {card.kind === 'supply' && card.playable && <><div className="ta-pair"><ResourceChoice lang={lang} value={first} set={setFirst} label={word(lang, 'Первый ресурс', 'First resource')} disabled={busy || sending}/>
          <ResourceChoice lang={lang} value={second} set={setSecond} label={word(lang, 'Второй ресурс', 'Second resource')} disabled={busy || sending}/></div>
          {!supplyReady && <p className="ta-short">{word(lang, 'В банке недостаточно выбранных ресурсов.', 'The bank does not have enough of the selected resources.')}</p>}</>}
        {card.kind !== 'charter' && card.playable && (confirm === card.id ? <div className="ta-card-confirm">
          <strong>{word(lang, 'Сыграть «', 'Play “')}{cardNames[card.kind][index]}{word(lang, '»?', '”?')}</strong>
          {card.kind === 'supply' && <ResourceStock stock={{ ...emptyStock(), [first]: 1 + Number(first === second), ...(first !== second ? { [second]: 1 } : {}) }} lang={lang}/>}<div className="ta-buttons">
            <button type="button" className="ta-primary" disabled={busy || sending || card.kind === 'supply' && !supplyReady} onClick={() => void play(card.id, card.kind)}>{sending ? word(lang, 'Применяем…', 'Playing…') : word(lang, 'Подтвердить', 'Confirm')}</button>
            <button type="button" disabled={sending} onClick={() => setConfirm(null)}>{word(lang, 'Отмена', 'Cancel')}</button></div>
        </div> : <button type="button" disabled={busy || sending || card.kind === 'supply' && !supplyReady} onClick={() => setConfirm(card.id)}>{word(lang, 'Сыграть карту', 'Play card')}</button>)}
      </article>)}
      {!view.you.cards.length && <p>{word(lang, 'В вашей руке пока нет карт развития.', 'There are no development cards in your hand yet.')}</p>}
      {!view.cardsAvailable && <p>{word(lang, 'Колода закончилась.', 'The deck is empty.')}</p>}
      {feedbackText && <p className="ta-feedback" role="status">{feedbackText}</p>}
    </div>
  </details>;
}

function Discard({ view, lang, busy, onAction }: Props) {
  const [stock, setStock] = useState<Stock>(emptyStock);
  return <section className="ta-form ta-mandatory"><h4>{word(lang, 'Семёрка: верните часть руки', 'Seven: return part of your hand')}</h4>
    <Amounts lang={lang} value={stock} onChange={setStock} max={view.you.hand} disabled={busy} label={word(lang, 'Верните ресурсы в банк', 'Return resources to the bank')}/>
    <button type="button" className="ta-primary" disabled={busy || stockTotal(stock) !== view.you.discard || stockTotal(missingStock(view.you.hand, stock)) > 0}
      onClick={() => void onAction({ type: 'discard', resources: stock })}>{word(lang, 'Вернуть', 'Discard')} {stockTotal(stock)} / {view.you.discard}</button>
  </section>;
}

function Block({ view, lang, busy, onAction, selection }: Props) {
  const [target, setTarget] = useState('');
  const tile = selection?.kind === 'tile' && view.legal.block.find(option => option.tileId === selection.id);
  const cause = view.pendingBlockade?.reason === 'patrol' ? word(lang, 'Патруль: перенесите блокаду', 'Patrol: move the blockade') : word(lang, 'Семёрка: перенесите блокаду', 'Seven: move the blockade');
  if (!tile) return <section className="ta-mandatory"><h4>{cause}</h4><p>{word(lang, 'Выберите подсвеченную клетку.', 'Choose a highlighted tile.')}</p></section>;
  const chosen = tile.targets.includes(target) ? target : tile.targets[0];
  return <section className="ta-form ta-mandatory"><h4>{cause}</h4>
    {tile.targets.length > 0 ? <label className="ta-select">{word(lang, 'У кого взять случайный ресурс', 'Take a random resource from')}
      <select value={chosen} disabled={busy} onChange={event => setTarget(event.target.value)}>{tile.targets.map(id => <option key={id} value={id}>{nameOf(view, id)}</option>)}</select>
    </label> : <p>{word(lang, 'Здесь нет соперников с ресурсами. Блокада только остановит производство.', 'There are no rivals with resources here. The blockade will only stop production.')}</p>}
    <button type="button" className="ta-primary" disabled={busy} onClick={() => void onAction({ type: 'block', tileId: tile.tileId, ...(chosen ? { targetId: chosen } : {}) })}>{word(lang, 'Перенести блокаду', 'Move blockade')}</button>
  </section>;
}

export function TerritorialActions(props: Props) {
  const { view, lang, onAction, selection } = props;
  const mine = view.activeParticipantId === view.you.participantId;
  const ownLeft = view.players.find(player => player.participantId === view.you.participantId)?.left;
  const busy = props.busy || !!ownLeft || !!view.outcome;
  const safeProps = { ...props, busy };
  return <div className="territorial-actions">
    {view.legal.roll && !ownLeft && <button type="button" className="ta-primary ta-roll" disabled={busy} onClick={() => void onAction({ type: 'roll' })}>{word(lang, 'Бросить кубики', 'Roll dice')}</button>}
    {mine && view.phase === 'setup-home' && !selection && <p className="ta-action-hint">{word(lang, 'Выберите участок для стартового дома.', 'Choose a site for your starting house.')}</p>}
    {mine && view.phase === 'setup-route' && !selection && <p className="ta-action-hint">{word(lang, 'Выберите дорогу рядом с новым домом.', 'Choose a road beside your new house.')}</p>}
    {view.phase === 'play' && mine && !selection && <p className="ta-action-hint">{word(lang, 'Выберите участок или путь на карте.', 'Select a site or route on the map.')}</p>}
    {!view.legal.block.length && !view.you.discard && <SelectedAction {...safeProps}/>}
    <Coupons {...safeProps}/>
    {view.legal.end && !ownLeft && <button type="button" className="ta-end" disabled={busy} onClick={() => void onAction({ type: 'end' })}>{word(lang, 'Завершить ход', 'End turn')}</button>}
  </div>;
}

export function TerritorialMapActions(props: Props) {
  const { view } = props;
  const busy = props.busy || !!view.outcome || !!view.players.find(player => player.participantId === view.you.participantId)?.left;
  const safeProps = {...props,busy};
  const mandatory = view.legal.block.length > 0 || view.you.discard > 0;
  const tools = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = tools.current;
    const table = element?.closest('.territory-match');
    if (!element || !table) return;
    const phase = table.querySelector('.territory-phase');
    const update = () => {
      // Mobile sheets can rise above the map, but never cover the current player
      // and turn clock. Measure the actual text/viewport instead of a fixed offset.
      const top = Math.max(8, (phase?.getBoundingClientRect().bottom ?? 0) + 6);
      const bottom = Math.min(element.getBoundingClientRect().bottom - 5, window.innerHeight - 8);
      element.style.setProperty('--map-sheet-height', Math.max(0, bottom - top) + 'px');
    };
    const observer = new ResizeObserver(update);
    for (const target of [element, phase, table.querySelector('.territory-top'), table.querySelector('.territory-statusbar')]) if (target) observer.observe(target);
    window.addEventListener('resize', update);
    update();
    return () => { observer.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  return <div ref={tools} className={'territory-map-tools territorial-actions' + (mandatory ? ' is-mandatory' : '')}>
    {view.turn > 0 && !view.outcome && <><PlayerTrade key={`${view.matchId}:${view.you.participantId}`} {...safeProps}/><TacticalCards {...safeProps}/></>}
    {mandatory && <div className="ta-map-required">
      {view.you.discard > 0 ? <Discard key={`${view.matchId}:${view.turn}`} {...safeProps}/> : <Block {...safeProps}/>}
    </div>}
  </div>;
}
