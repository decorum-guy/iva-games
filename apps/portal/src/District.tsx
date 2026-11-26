import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { BUILD_COSTS, UPGRADE_COST } from "@iva-games/district";
import type { Bundle, BuildingKind, DistrictAction, DistrictCell, DistrictOffer, DistrictView, GoalId, ParkOffer, ResourceKind, Resources, TradeOffer } from "@iva-games/district";
import { PlatformError, request } from "./api";
import type { Perform } from "./Auth";
import type { Language, Room } from "./types";
import { Modal, useLanguage } from "./ui";
import { DistrictGlyph } from "./DistrictMap";
import { buildActionCopy, buildingCopy, districtBotName, eventCopy, goalCopy, localized, phaseCopy, resourceCopy } from "./districtCopy";
import "./district.css";

const resourceKinds: ResourceKind[] = ["coins", "materials", "crews"];
const blankBundle = (): Bundle => ({ coins: 0, materials: 0, crews: 0, lots: [] });
const blankResources = (): Resources => ({ coins: 0, materials: 0, crews: 0 });
const COLORS = ["#247f78", "#bd572f", "#7560a5", "#5779a8"];
const buildCosts = BUILD_COSTS;
const upgradeCost = UPGRADE_COST;
const canPay = (resources: Resources, cost: Resources) => resourceKinds.every(key => resources[key] >= cost[key]);
const displayName = (player: DistrictView["players"][number], lang: Language) =>
  player.isBot ? districtBotName(player.seatIndex, lang) : player.displayName;
const playerName = (view: DistrictView, lang: Language, id: string) => {
  const player = view.players.find(item => item.participantId === id);
  return player ? displayName(player, lang) : "—";
};
const playerColor = (view: DistrictView, id: string | null) => COLORS[(view.players.find(player => player.participantId === id)?.seatIndex ?? 0) % COLORS.length];
type Act = (action: DistrictAction) => Promise<boolean>;
type Pending = { actionId: string; expectedRevision: number; payload: DistrictAction & { phaseId: string } };

function ResourcesLine({ value, compact = false }: { value: Resources; compact?: boolean }) {
  const { lang } = useLanguage();
  return <span className={`district-resources ${compact ? "compact" : ""}`}>
    {resourceKinds.map(key => <span key={key} className={`resource-${key}`} title={localized(resourceCopy[key], lang)}>
      <span aria-hidden="true">{key === "coins" ? "●" : key === "materials" ? "▰" : "⚑"}</span>
      <b>{value[key]}</b>{compact ? <span className="sr-only">{localized(resourceCopy[key], lang)}</span> : <small>{localized(resourceCopy[key], lang)}</small>}
    </span>)}
  </span>;
}

function BundleLine({ bundle }: { bundle: Bundle }) {
  const { t } = useLanguage();
  return <span className="district-bundle-line"><ResourcesLine value={bundle} compact />{bundle.lots.length > 0 && <span>{t("Участки", "Lots")}: {bundle.lots.join(", ")}</span>}</span>;
}

function GoalCard({ goal, selected, onClick, disabled }: { goal: GoalId; selected?: boolean; onClick?: () => void; disabled?: boolean }) {
  const { lang, t } = useLanguage();
  const content = <><span className="district-goal-symbol" aria-hidden="true">✦</span><span className="district-goal-text"><strong>{localized(goalCopy[goal].title, lang)}</strong><small>{localized(goalCopy[goal].description, lang)}</small></span><b>+5</b></>;
  return onClick ? <button className="district-goal" aria-pressed={selected} disabled={disabled} onClick={onClick}>{content}</button>
    : <div className="district-goal"><span className="sr-only">{t("Личная цель", "Personal goal")}: </span>{content}</div>;
}

export function DistrictPanel({ room, busy, perform, refresh }: { room: Room; busy: boolean; perform: Perform; refresh: () => Promise<void> }) {
  const { lang, t } = useLanguage();
  const [view, setView] = useState<DistrictView | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const [sending, setSending] = useState(false);
  const [help, setHelp] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const decisions = useRef<HTMLDivElement>(null);
  const offset = useRef(0);
  const finished = useRef(false);
  const alive = useRef(true);
  const latest = useRef<{ revision: number; serverNow: number } | null>(null);
  const acceptView = useCallback((next: DistrictView) => {
    if (!alive.current) return;
    const prior = latest.current;
    if (prior && (next.revision < prior.revision || (next.revision === prior.revision && next.serverNow < prior.serverNow))) return;
    latest.current = { revision: next.revision, serverNow: next.serverNow };
    offset.current = next.serverNow - Date.now();
    setClock(next.serverNow);
    finished.current = next.phase === "finished";
    setView(next);
    setLoadError(false);
  }, []);
  const load = useCallback(async () => {
    try {
      const data = await request<{ view: DistrictView }>(`/rooms/${room.roomId}/match`);
      acceptView(data.view);
    } catch { if (alive.current) setLoadError(true); }
  }, [room.roomId, acceptView]);
  useEffect(() => {
    alive.current = true; finished.current = false;
    void load();
    const poll = () => { if (!finished.current && document.visibilityState === "visible") void load(); };
    const timer = setInterval(poll, 1500);
    const tick = setInterval(() => { if (document.visibilityState === "visible") setClock(Date.now() + offset.current); }, 500);
    document.addEventListener("visibilitychange", poll);
    return () => { alive.current = false; clearInterval(timer); clearInterval(tick); document.removeEventListener("visibilitychange", poll); };
  }, [load]);
  const execute = async (command: Pending): Promise<boolean> => {
    if (sending) return false;
    setSending(true);
    try { return await perform(async () => {
      try {
        const data = await request<{ view: DistrictView }>(`/rooms/${room.roomId}/actions`, command);
        acceptView(data.view);
        pendingRef.current = null; setPending(null);
        await load();
        if (data.view.phase === "finished") await refresh();
      } catch (error) {
        if (error instanceof PlatformError && error.status > 0 && error.status < 500) {
          pendingRef.current = null; setPending(null); await load();
        }
        throw error;
      }
    }); } finally { setSending(false); }
  };
  const act: Act = async action => {
    if (!view || pendingRef.current || sending) return false;
    const command: Pending = { actionId: crypto.randomUUID(), expectedRevision: view.revision, payload: { ...action, phaseId: view.phaseId } };
    pendingRef.current = command; setPending(command);
    return execute(command);
  };
  if (!view) return <section className="district-panel"><h3>{t("Район", "District")}</h3>{loadError ? <button className="button secondary" onClick={() => void load()}>{t("Загрузить игру", "Load game")}</button> : <span className="spinner" />}</section>;
  const locked = busy || sending || pending !== null;
  const currentCell = view.cells.find(cell => cell.id === selected) ?? null;
  const self = view.players.find(player => player.participantId === view.you.participantId)!;
  const seconds = Math.max(0, Math.ceil(((view.deadlineAt ?? clock) - clock) / 1000));
  const countdown = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const news = view.event ? eventCopy(view.event, lang) : null;
  return <section className="district-panel" aria-label={t("Игра Район", "District game")}>
    <header className="district-heading">
      <div><span className="district-eyebrow">{view.map.name[lang]}</span><h3>{t("Район", "District")}</h3></div>
      <div className="district-heading-actions"><span className="district-round">{view.round === 0 ? t("Новый район", "A new district") : <>{t("Раунд", "Round")} <b>{view.round}/{view.totalRounds}</b></>}</span><button className="button small secondary" onClick={() => setHelp(true)}>{t("Как играть", "How to play")}</button></div>
    </header>
    {loadError && <div className="inline-error" role="status">{t("Нет связи. Пробуем снова…", "No connection. Trying again…")}</div>}
    {pending && !sending && <div className="district-retry" role="status"><span>{t("Проверим последнее действие?", "Check your last action?")}</span><button className="button small secondary" onClick={() => void execute(pending)}>{t("Повторить", "Retry")}</button></div>}
    <div className="district-players">
      {view.players.map(player => <article className={`district-player ${player.participantId === view.activeParticipantId ? "active" : ""}`} style={{ "--player-color": playerColor(view, player.participantId) } as CSSProperties} key={player.participantId}>
        <div><span className="district-player-mark">{player.seatIndex + 1}</span><strong>{displayName(player, lang)}</strong>{player.participantId === view.you.participantId && <small>{t("Вы", "You")}</small>}</div>
        <ResourcesLine value={player.resources} compact />
        <small className="district-player-state">{player.left ? t("Вышел", "Away") : view.phase === "negotiation" ? (player.ready ? t("Готов", "Ready") : t("Договаривается", "Negotiating")) : view.phase === "goals" || view.phase === "auction" ? (player.submitted ? t("Готов", "Ready") : t("Выбирает", "Choosing")) : player.participantId === view.activeParticipantId ? t("Сейчас ходит", "Taking a turn") : ""}</small>
      </article>)}
    </div>
    <div className="district-mobile-turn"><span>{localized(phaseCopy[view.phase], lang)}{view.deadlineAt !== null && <time aria-label={t("Осталось времени", "Time left")} className={seconds <= 10 ? "urgent" : ""}>{countdown}</time>}</span><button className="text-button" onClick={() => { decisions.current?.scrollIntoView({ block: "start" }); decisions.current?.focus({ preventScroll: true }); }}>{view.phase === "finished" ? t("К итогам ↓", "See results ↓") : t("К действиям ↓", "Your actions ↓")}</button></div>
    <div className="district-layout">
      <div className="district-map-column">
        <div className="district-map-surface">
          <div className="district-board" role="group" aria-label={t("Карта района", "District map")} style={{ gridTemplateColumns: `repeat(${view.map.width}, minmax(0, 1fr))` }}>
            {view.cells.map(cell => {
              const kind = cell.building?.kind ?? cell.kind;
              const name = cell.building ? localized(buildingCopy[cell.building.kind], lang) : cell.kind === "park" ? t(cell.completed ? "Парк" : "Место для парка", cell.completed ? "Park" : "Park site") : cell.kind === "neutral-house" ? t("Нейтральный дом", "Neutral house") : cell.kind === "square" ? t("Площадь", "Square") : t("Участок", "Lot");
              const owner = cell.ownerId ? playerName(view, lang, cell.ownerId) : cell.kind === "lot" ? t("Банк", "Bank") : "";
              const affordableBid = view.legal.bid && cell.kind === "lot" && !cell.ownerId;
              const developable = view.legal.develop && cell.ownerId === view.you.participantId && (!cell.building || cell.building.level === 1);
              return <button key={cell.id} className={`district-cell cell-${kind} ${cell.ownerId ? "owned" : ""} ${cell.completed ? "completed" : ""} ${selected === cell.id ? "selected" : ""} ${affordableBid || developable ? "actionable" : ""}`} style={cell.ownerId ? { "--owner-color": playerColor(view, cell.ownerId) } as CSSProperties : undefined} onClick={() => setSelected(cell.id)} aria-pressed={selected === cell.id} aria-label={`${cell.id} — ${name}${cell.building ? ` ${cell.building.level}` : ""}${owner ? ` — ${owner}` : ""}`}>
                <span className="district-coordinate">{cell.id}</span><DistrictGlyph kind={kind} />
                <span className="district-cell-caption">{cell.building ? localized(buildingCopy[cell.building.kind], lang) : cell.kind === "lot" ? (cell.ownerId ? owner : t("Земля", "Land")) : cell.kind === "park" ? (cell.completed ? t("Парк", "Park") : t("Будущий парк", "Park site")) : cell.kind === "square" ? t("Площадь", "Square") : t("Дом", "House")}</span>
                {cell.ownerId && <span className="district-owner-dot" aria-hidden="true">{(view.players.find(player => player.participantId === cell.ownerId)?.seatIndex ?? 0) + 1}</span>}
                {cell.building?.level === 2 && <span className="district-level" aria-label={t("Уровень 2", "Level 2")}>II</span>}
              </button>;
            })}
          </div>
          <p className="district-map-hint">{t("Нажмите на участок, чтобы посмотреть его подробнее.", "Select a lot to take a closer look.")}</p>
        </div>
        {currentCell && <CellDetail cell={currentCell} view={view} />}
        {news && <aside className="district-news"><span aria-hidden="true">☀</span><div><small>{t("Сегодня в районе", "In the district today")}</small><strong>{news.title}</strong><p>{news.description}</p></div></aside>}
        {view.you.goal && <div className="district-your-goal"><span className="district-eyebrow">{t("Ваш личный план", "Your personal plan")}</span><GoalCard goal={view.you.goal} /><small>{view.phase === "finished" ? (view.you.goalCompleted ? t("Цель выполнена", "Goal completed") : t("Цель не выполнена", "Goal not completed")) : t("Остальные узнают о нём в конце партии.", "The others will see it at the end of the game.")}</small></div>}
      </div>
      <div className="district-decisions" ref={decisions} tabIndex={-1}>
        <div className="district-phase-title"><h4>{localized(phaseCopy[view.phase], lang)}</h4>{view.deadlineAt !== null && <time aria-label={t("Осталось времени", "Time left")} className={seconds <= 10 ? "urgent" : ""}>{countdown}</time>}</div>
        {view.you.left && view.phase !== "finished" ? <div className="district-away"><p>{t("Вы вышли из партии. Можно вернуться к следующим решениям.", "You left the game. You can return for the next decisions.")}</p><button className="button primary" disabled={locked || !view.legal.return} onClick={() => void act({ type: "return" })}>{t("Вернуться в игру", "Return to game")}</button></div> : view.phase === "goals" ? <div className="district-goal-choices"><p>{t("Выберите цель. В конце она принесёт ещё 5 очков.", "Choose a goal. It can earn 5 extra points at the end.")}</p>{view.you.goalOptions.map(goal => <GoalCard key={goal} goal={goal} selected={view.you.goal === goal} onClick={() => void act({ type: "choose-goal", goal })} disabled={locked || !view.legal.chooseGoal} />)}{view.you.goal && <p role="status">{t("План выбран. Ждём остальных.", "Plan chosen. Waiting for the others.")}</p>}</div> : view.phase === "negotiation" ? <Negotiation key={`${view.round}:negotiation`} view={view} selected={selected} locked={locked} act={act} /> : view.phase === "auction" ? <Auction key={`${view.round}:auction`} view={view} selected={selected} locked={locked} act={act} /> : view.phase === "development" ? <Development key={`${view.round}:${view.activeParticipantId}`} view={view} selected={selected} locked={locked} act={act} /> : <Results view={view} />}
        {view.phase !== "finished" && <div className="district-wallet"><small>{t("Можно потратить", "Available to spend")}</small><ResourcesLine value={view.you.available} />{resourceKinds.some(key => view.you.reserved[key] > 0) && <p>{t("В предложениях", "Held for offers")}: <ResourcesLine value={view.you.reserved} compact /></p>}</div>}
        {view.legal.leave && <button className="text-button district-leave" disabled={locked} onClick={() => setLeaving(true)}>{t("Выйти из партии", "Leave game")}</button>}
      </div>
    </div>
    <History view={view} />
    {help && <RulesHelp close={() => setHelp(false)} />}
    {leaving && <Modal title={t("Выйти из партии?", "Leave the game?")} onClose={() => setLeaving(false)}><p>{view.players.filter(player => !player.isBot && !player.left).length === 1 ? t("Вы последний человек за столом. Партия завершится без победителя.", "You are the last person at the table. The game will end without a winner.") : t("Ваше место останется. До возвращения вы будете пропускать торги и работать за монеты.", "Your seat stays. Until you return, you will pass auctions and work for coins.")}</p><div className="district-button-row"><button className="button secondary" onClick={() => setLeaving(false)}>{t("Остаться", "Stay")}</button><button className="button primary" disabled={locked} onClick={() => { setLeaving(false); void act({ type: "leave" }); }}>{t("Выйти", "Leave")}</button></div></Modal>}
    <span className="sr-only">{self.displayName}</span>
  </section>;
}

function CellDetail({ cell, view }: { cell: DistrictCell; view: DistrictView }) {
  const { lang, t } = useLanguage();
  const line = view.incomePreview.find(item => item.lotId === cell.id);
  return <div className="district-cell-detail"><div><strong>{cell.id} · {cell.building ? localized(buildingCopy[cell.building.kind], lang) : cell.kind === "park" ? t("Парк", "Park") : cell.kind === "neutral-house" ? t("Нейтральный дом", "Neutral house") : cell.kind === "square" ? t("Площадь", "Square") : t("Участок", "Lot")}</strong><p>{cell.ownerId ? playerName(view, lang, cell.ownerId) : cell.kind === "lot" ? t("Продаётся на торгах", "Available at auction") : cell.kind === "neutral-house" ? t("Даёт спрос соседним кафе", "Creates demand for nearby cafes") : cell.kind === "park" ? (cell.completed ? t("Помогает соседним домам и кафе", "Helps nearby houses and cafes") : t("4 монеты + 1 материал + 1 бригада", "4 coins + 1 material + 1 crew")) : t("Общее место для прогулок", "A shared public square")}</p></div>{line && <div><small>{t("Доход в этом раунде", "Income this round")}</small><ResourcesLine value={line} compact /><p className="district-income-formula">{t("Соседи", "Neighbours")}: {t("дома", "houses")} {line.neighbors.houses}, {t("парки", "parks")} {line.neighbors.parks}, {t("мастерские", "workshops")} {line.neighbors.workshops}. {t("Событие", "Event")}: {line.eventCoins > 0 ? "+" : ""}{line.eventCoins}.</p></div>}</div>;
}

function Negotiation({ view, selected, locked, act }: { view: DistrictView; selected: string | null; locked: boolean; act: Act }) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<"bank" | "trade" | "park">("bank");
  const [tradeEdit, setTradeEdit] = useState<TradeOffer | null>(null);
  const [parkEdit, setParkEdit] = useState<ParkOffer | null>(null);
  const self = view.players.find(player => player.participantId === view.you.participantId)!;
  const offers = view.you.offers.filter(offer => offer.status === "open");
  const complete = () => { setTradeEdit(null); setParkEdit(null); };
  const editing = tab === "trade" ? tradeEdit !== null : tab === "park" && parkEdit !== null;
  const editor = tab === "bank" ? <Bank view={view} act={act} locked={locked} /> : tab === "trade" ? <TradeForm key={tradeEdit?.id ?? "new"} view={view} offer={tradeEdit} act={act} locked={locked} done={complete} /> : <ParkForm key={parkEdit?.id ?? "new"} view={view} offer={parkEdit} selected={selected} act={act} locked={locked} done={complete} />;
  return <div className="district-negotiation">
    <p>{t("Обменивайтесь, покупайте ресурсы и договаривайтесь о парках. Закончили — нажмите «Готов».", "Trade, buy resources and plan parks together. Press Ready when you're done.")}</p>
    <button className={`button ${self.ready ? "secondary" : "primary"} wide`} disabled={locked || !view.legal.negotiate} onClick={() => void act({ type: "ready", ready: !self.ready })}>{self.ready ? t("Я ещё подумаю", "I need another moment") : t("Готов", "Ready")}</button>
    {self.ready && <p className="district-positive" role="status">{t("Ждём остальных. Новая сделка может потребовать вашего ответа.", "Waiting for the others. A new offer may need your attention.")}</p>}
    <div className="district-tabs" role="group" aria-label={t("Действия в переговорах", "Negotiation actions")}>
      {(["bank", "trade", "park"] as const).map(value => <button key={value} className={tab === value ? "active" : ""} aria-pressed={tab === value} onClick={() => setTab(value)}>{value === "bank" ? t("Банк", "Bank") : value === "trade" ? t("Сделки", "Deals") : t("Парки", "Parks")}</button>)}
    </div>
    {editing && editor}
    {offers.length > 0 && <div className="district-offers"><h4>{t("Предложения за столом", "Offers at the table")}</h4>{offers.map(offer => <OfferCard key={offer.id} view={view} offer={offer} act={act} locked={locked} edit={() => {
      if (offer.kind === "trade") { setTradeEdit(offer); setParkEdit(null); setTab("trade"); }
      else { setParkEdit(offer); setTradeEdit(null); setTab("park"); }
    }} />)}</div>}
    {!editing && editor}
  </div>;
}

function Bank({ view, act, locked }: { view: DistrictView; act: Act; locked: boolean }) {
  const { t, lang } = useLanguage();
  const [quantity, setQuantity] = useState(1);
  return <div className="district-bank"><p>{t("Купить — 3 монеты за штуку. Продать — 1 монета.", "Buy for 3 coins each. Sell for 1 coin each.")}</p><label>{t("Количество", "Quantity")}<input type="number" value={quantity} min={1} max={999} step={1} onChange={event => setQuantity(Math.max(1, Math.min(999, Math.floor(Number(event.target.value) || 1))))} /></label>{(["materials", "crews"] as const).map(resource => <div className="district-bank-row" key={resource}><strong>{localized(resourceCopy[resource], lang)}</strong><div><button className="button small secondary" disabled={locked || view.you.available.coins < quantity * 3} onClick={() => void act({ type: "bank", direction: "buy", resource, quantity })}>{t("Купить", "Buy")} · {quantity * 3} ●</button><button className="button small secondary" disabled={locked || view.you.available[resource] < quantity} onClick={() => void act({ type: "bank", direction: "sell", resource, quantity })}>{t("Продать", "Sell")} · +{quantity} ●</button></div></div>)}</div>;
}

function ResourceInputs({ value, onChange, prefix }: { value: Resources; onChange: (value: Resources) => void; prefix: string }) {
  const { lang } = useLanguage();
  return <div className="district-resource-inputs">{resourceKinds.map(key => <label key={key}>{localized(resourceCopy[key], lang)}<input aria-label={`${prefix}: ${localized(resourceCopy[key], lang)}`} type="number" value={value[key]} min={0} max={999999} step={1} onChange={event => onChange({ ...value, [key]: Math.max(0, Math.min(999999, Math.floor(Number(event.target.value) || 0))) })} /></label>)}</div>;
}

function BundleInputs({ value, onChange, title, cells, lang }: { value: Bundle; onChange: (value: Bundle) => void; title: string; cells: DistrictCell[]; lang: "ru" | "en" }) {
  const { t } = useLanguage();
  return <fieldset className="district-bundle-inputs"><legend>{title}</legend><ResourceInputs prefix={title} value={value} onChange={resources => onChange({ ...resources, lots: value.lots })} />{cells.length > 0 && <details><summary>{t("Добавить недвижимость", "Include property")}{value.lots.length > 0 ? ` · ${value.lots.length}` : ""}</summary><div className="district-lot-checks">{cells.map(cell => <label key={cell.id}><input type="checkbox" checked={value.lots.includes(cell.id)} onChange={event => onChange({ ...value, lots: event.target.checked ? [...value.lots, cell.id] : value.lots.filter(id => id !== cell.id) })} /><span>{cell.id} · {cell.building ? `${localized(buildingCopy[cell.building.kind], lang)} ${cell.building.level}` : t("Пустой участок", "Empty lot")}</span></label>)}</div></details>}</fieldset>;
}

export function reduceTradeBundles(give: Bundle, receive: Bundle): { give: Bundle; receive: Bundle } {
  const reducedGive = { ...give, lots: [...give.lots] };
  const reducedReceive = { ...receive, lots: [...receive.lots] };
  for (const key of resourceKinds) {
    const same = Math.min(give[key], receive[key]);
    reducedGive[key] -= same; reducedReceive[key] -= same;
  }
  return { give: reducedGive, receive: reducedReceive };
}

function TradeForm({ view, offer, act, locked, done }: { view: DistrictView; offer: TradeOffer | null; act: Act; locked: boolean; done: () => void }) {
  const { t, lang } = useLanguage();
  const selfId = view.you.participantId;
  const isCounter = !!offer && offer.authorId !== selfId;
  const others = view.players.filter(player => player.participantId !== selfId && !player.left);
  const [targetId, setTargetId] = useState(offer ? (isCounter ? offer.authorId : offer.targetId) : others[0]?.participantId ?? "");
  const [give, setGive] = useState<Bundle>(offer ? structuredClone(isCounter ? offer.receive : offer.give) : blankBundle());
  const [receive, setReceive] = useState<Bundle>(offer ? structuredClone(isCounter ? offer.give : offer.receive) : blankBundle());
  const normalized = reduceTradeBundles(give, receive);
  const nonempty = (bundle: Bundle) => bundle.lots.length > 0 || resourceKinds.some(key => bundle[key] > 0);
  const preview = { coins: view.you.resources.coins - normalized.give.coins + normalized.receive.coins, materials: view.you.resources.materials - normalized.give.materials + normalized.receive.materials, crews: view.you.resources.crews - normalized.give.crews + normalized.receive.crews };
  return <form className="district-trade-form" onSubmit={event => {
    event.preventDefault();
    const action: DistrictAction = offer ? isCounter ? { type: "counter-trade", offerId: offer.id, version: offer.version, ...normalized } : { type: "replace-trade", offerId: offer.id, version: offer.version, targetId, ...normalized } : { type: "offer-trade", targetId, ...normalized };
    void act(action).then(ok => { if (ok) { setGive(blankBundle()); setReceive(blankBundle()); done(); } });
  }}>
    <label>{t("С кем договоримся", "Who shall we trade with?")}<select aria-label={t("С кем договоримся", "Who shall we trade with?")} value={targetId} disabled={isCounter} onChange={event => { setTargetId(event.target.value); setReceive(blankBundle()); }}>{others.map(player => <option value={player.participantId} key={player.participantId}>{displayName(player, lang)}</option>)}</select></label>
    <BundleInputs title={t("Отдаю", "I give")} value={give} onChange={setGive} cells={view.cells.filter(cell => cell.ownerId === selfId)} lang={lang} />
    <BundleInputs title={t("Получаю", "I receive")} value={receive} onChange={setReceive} cells={view.cells.filter(cell => cell.ownerId === targetId)} lang={lang} />
    <div className="district-trade-summary"><strong>{t("Условия обмена", "Deal terms")}</strong><small>{t("Отдаёте", "You give")}</small><BundleLine bundle={normalized.give} /><small>{t("Получаете", "You receive")}</small><BundleLine bundle={normalized.receive} /><small>{t("Ваш запас после обмена", "Your resources after the deal")}</small><ResourcesLine value={preview} compact /></div>
    <button className="button primary wide" disabled={locked || !targetId || !nonempty(normalized.give) || !nonempty(normalized.receive)}>{offer ? t("Отправить новые условия", "Send new terms") : t("Предложить обмен", "Propose trade")}</button>
    {offer && <button type="button" className="text-button" onClick={done}>{t("Не менять условия", "Keep the current terms")}</button>}
  </form>;
}

function ParkForm({ view, offer, selected, act, locked, done }: { view: DistrictView; offer: ParkOffer | null; selected: string | null; act: Act; locked: boolean; done: () => void }) {
  const { t, lang } = useLanguage();
  const parks = view.cells.filter(cell => cell.kind === "park" && !cell.completed);
  const [parkId, setParkId] = useState(offer?.parkId ?? (parks.some(cell => cell.id === selected) ? selected! : parks[0]?.id ?? ""));
  const [contributions, setContributions] = useState(offer?.contributions.map(item => structuredClone(item)) ?? [{ participantId: view.you.participantId, resources: { coins: 4, materials: 1, crews: 1 } }]);
  const totals = contributions.reduce((total, item) => ({ coins: total.coins + item.resources.coins, materials: total.materials + item.resources.materials, crews: total.crews + item.resources.crews }), blankResources());
  const valid = totals.coins === 4 && totals.materials === 1 && totals.crews === 1 && contributions.every(item => resourceKinds.some(key => item.resources[key] > 0));
  if (!parks.length) return <p>{t("Все парки уже построены.", "All parks are already built.")}</p>;
  return <form className="district-park-form" onSubmit={event => { event.preventDefault(); void act(offer ? { type: "replace-park", offerId: offer.id, version: offer.version, parkId, contributions } : { type: "offer-park", parkId, contributions }).then(ok => { if (ok) done(); }); }}>
    <p>{t("Парк помогает всем соседним домам и кафе. Можно оплатить одному или поделить цену.", "A park helps every nearby house and cafe. Pay alone or share the cost.")}</p>
    <label>{t("Где строим парк", "Where shall we build?")}<select aria-label={t("Где строим парк", "Where shall we build?")} value={parkId} onChange={event => setParkId(event.target.value)}>{parks.map(cell => <option value={cell.id} key={cell.id}>{cell.id}</option>)}</select></label>
    {view.players.filter(player => !player.left).map(player => {
      const contribution = contributions.find(item => item.participantId === player.participantId);
      const own = player.participantId === view.you.participantId;
      return <fieldset className="district-park-contributor" key={player.participantId}><legend>{displayName(player, lang)}</legend><label className="district-check"><input type="checkbox" checked={!!contribution} disabled={own} onChange={event => setContributions(current => event.target.checked ? [...current, { participantId: player.participantId, resources: blankResources() }] : current.filter(item => item.participantId !== player.participantId))} /><span>{own ? t("Ваш вклад", "Your contribution") : t("Позвать в складчину", "Invite to contribute")}</span></label>{contribution && <ResourceInputs prefix={displayName(player, lang)} value={contribution.resources} onChange={resources => setContributions(current => current.map(item => item.participantId === player.participantId ? { ...item, resources } : item))} />}</fieldset>;
    })}
    <div className={`district-park-total ${valid ? "valid" : ""}`}><strong>{t("Нужно ровно 4 / 1 / 1", "Total needed: 4 / 1 / 1")}</strong><ResourcesLine value={totals} /></div>
    <button className="button primary wide" disabled={locked || !parkId || !valid}>{contributions.length === 1 ? t("Построить парк", "Build park") : t("Предложить парк", "Propose park")}</button>{offer && <button type="button" className="text-button" onClick={done}>{t("Не менять условия", "Keep the current terms")}</button>}
  </form>;
}

function OfferCard({ view, offer, act, locked, edit }: { view: DistrictView; offer: DistrictOffer; act: Act; locked: boolean; edit: () => void }) {
  const { t, lang } = useLanguage();
  const own = offer.authorId === view.you.participantId;
  const ref = { offerId: offer.id, version: offer.version };
  return <article className="district-offer"><div className="district-offer-heading"><strong>{offer.kind === "trade" ? `${playerName(view, lang, offer.authorId)} ↔ ${playerName(view, lang, offer.targetId)}` : `${t("Парк", "Park")} ${offer.parkId}`}</strong><small>{own ? t("Ваше предложение", "Your offer") : playerName(view, lang, offer.authorId)}</small></div>
    {offer.kind === "trade" ? <div className="district-trade-summary"><small>{t("Отдаёте", "You give")}</small><BundleLine bundle={own ? offer.give : offer.receive} /><small>{t("Получаете", "You receive")}</small><BundleLine bundle={own ? offer.receive : offer.give} /></div> : <div className="district-contribution-list">{offer.contributions.map(item => <div key={item.participantId}><span>{playerName(view, lang, item.participantId)} <small>{offer.signedBy.includes(item.participantId) ? t("✓ Подписал", "✓ Signed") : t("Ждём", "Waiting")}</small></span><ResourcesLine value={item.resources} compact /></div>)}</div>}
    <div className="district-button-row">{offer.kind === "trade" && !own && <button className="button small primary" disabled={locked} onClick={() => void act({ type: "accept-trade", ...ref })}>{t("Принять", "Accept")}</button>}{offer.kind === "park" && !offer.signedBy.includes(view.you.participantId) && <button className="button small primary" disabled={locked} onClick={() => void act({ type: "sign-park", ...ref })}>{t("Подписать", "Sign")}</button>}{(offer.kind === "trade" || own) && <button className="button small secondary" disabled={locked} onClick={edit}>{t("Другие условия", "Change terms")}</button>}<button className="text-button" disabled={locked} onClick={() => void act({ type: own ? "cancel-offer" : "decline-offer", ...ref })}>{own ? t("Отменить", "Cancel") : t("Отказаться", "Decline")}</button></div>
  </article>;
}

function Auction({ view, selected, act, locked }: { view: DistrictView; selected: string | null; act: Act; locked: boolean }) {
  const { t, lang } = useLanguage();
  const lots = view.cells.filter(cell => cell.kind === "lot" && !cell.ownerId);
  const [lotId, setLotId] = useState(view.you.bid?.lotId ?? "");
  const [amount, setAmount] = useState(view.you.bid?.amount ?? 1);
  const previouslySelected = useRef(selected);
  const unsaved = view.legal.bid && (lotId !== (view.you.bid?.lotId ?? "") || (lotId !== "" && amount !== view.you.bid?.amount));
  useEffect(() => {
    if (previouslySelected.current !== selected && view.legal.bid && lots.some(cell => cell.id === selected)) setLotId(selected!);
    previouslySelected.current = selected;
  }, [selected, view.legal.bid, lots]);
  return <div className="district-auction"><p>{t("Выберите участок и цену. Ставку увидят, когда ответят все. При равенстве выигрывает первый в очереди.", "Choose a lot and a price. Bids are revealed together. Ties go to the earlier player in the order.")}</p>
    <div className="district-priority"><small>{t("Очередь этого раунда", "This round's order")}</small><ol>{view.priority.map(id => <li key={id} className={id === view.you.participantId ? "you" : ""}>{playerName(view, lang, id)}</li>)}</ol></div>
    {view.you.bidConfirmed ? <div className="district-confirmed" role="status"><strong>{t("Решение принято", "Decision confirmed")}</strong><p>{view.you.bid ? `${view.you.bid.lotId} · ${view.you.bid.amount} ${t("монет", "coins")}` : t("Вы пропускаете торги.", "You are passing this auction.")}</p><small>{t("Ждём остальных.", "Waiting for the others.")}</small></div> : <>
      {view.legal.bid && <form onSubmit={event => { event.preventDefault(); void act({ type: "bid", bid: lotId ? { lotId, amount } : null }); }}><label>{t("Участок", "Lot")}<select aria-label={t("Участок", "Lot")} value={lotId} onChange={event => setLotId(event.target.value)}><option value="">{t("Пропуск", "Pass")}</option>{lots.map(cell => <option value={cell.id} key={cell.id}>{cell.id}</option>)}</select></label>{lotId && <label>{t("Ваша ставка", "Your bid")}<input type="number" min={1} max={view.you.resources.coins} step={1} value={amount} onChange={event => setAmount(Math.max(1, Math.floor(Number(event.target.value) || 1)))} /></label>}<button className="button secondary wide" disabled={locked || (!!lotId && amount > view.you.resources.coins)}>{t("Сохранить выбор", "Save choice")}</button></form>}
      <div className="district-saved-bid"><small>{t("Сохранённый выбор", "Saved choice")}</small><strong>{view.you.bid ? `${view.you.bid.lotId} · ${view.you.bid.amount} ${t("монет", "coins")}` : t("Пропуск", "Pass")}</strong><button className="button primary wide" disabled={locked || unsaved || !view.legal.confirmBid} onClick={() => void act({ type: "confirm-bid" })}>{view.you.bid ? t("Подтвердить ставку", "Confirm bid") : t("Подтвердить пропуск", "Confirm pass")}</button>{unsaved && <p>{t("Сохраните изменения перед подтверждением.", "Save your changes before confirming.")}</p>}</div>
    </>}
  </div>;
}

function Development({ view, selected, act, locked }: { view: DistrictView; selected: string | null; act: Act; locked: boolean }) {
  const { t, lang } = useLanguage();
  const owned = view.cells.filter(cell => cell.ownerId === view.you.participantId && (!cell.building || cell.building.level === 1));
  const [choice, setChoice] = useState(owned.some(cell => cell.id === selected) ? selected! : owned[0]?.id ?? "");
  const previouslySelected = useRef(selected);
  useEffect(() => {
    if (previouslySelected.current !== selected && owned.some(cell => cell.id === selected)) setChoice(selected!);
    previouslySelected.current = selected;
  }, [selected, owned]);
  const cell = owned.find(item => item.id === choice);
  if (!view.legal.develop) return <div className="district-waiting"><DistrictGlyph kind="house" /><strong>{playerName(view, lang, view.activeParticipantId ?? "")}</strong><p>{t("Сейчас строит. Ваш ход ещё впереди или уже завершён.", "Is taking a building turn. Your turn is coming or has already finished.")}</p></div>;
  return <div className="district-development"><p>{t("Одно действие: стройте, улучшайте или работайте за 2 монеты.", "Take one action: build, upgrade or work for 2 coins.")}</p>{owned.length > 0 && <label>{t("Ваша недвижимость", "Your property")}<select aria-label={t("Ваша недвижимость", "Your property")} value={choice} onChange={event => setChoice(event.target.value)}>{owned.map(item => <option value={item.id} key={item.id}>{item.id} · {item.building ? localized(buildingCopy[item.building.kind], lang) : t("Пустой участок", "Empty lot")}</option>)}</select></label>}{cell && !cell.building ? <div className="district-build-choices">{(["house", "cafe", "workshop"] as const).map(kind => <button className="district-build-choice" key={kind} disabled={locked || !canPay(view.you.available, buildCosts[kind])} onClick={() => void act({ type: "build", lotId: cell.id, building: kind })}><DistrictGlyph kind={kind} /><span><strong>{localized(buildActionCopy[kind], lang)}</strong><small>{kind === "house" ? t("Даёт монеты и бригаду", "Produces coins and a crew") : kind === "cafe" ? t("Больше дохода рядом с домами", "Earns more beside houses") : t("Даёт материалы, мешает соседям", "Produces materials, affects neighbours")}</small><ResourcesLine value={buildCosts[kind]} compact /></span></button>)}</div> : cell?.building && <button className="district-build-choice" disabled={locked || !canPay(view.you.available, upgradeCost)} onClick={() => void act({ type: "upgrade", lotId: cell.id })}><DistrictGlyph kind={cell.building.kind} /><span><strong>{t("Улучшить до уровня 2", "Upgrade to level 2")}</strong><small>{t("Ещё 1 монета дохода каждый раунд", "Earn 1 extra coin each round")}</small><ResourcesLine value={upgradeCost} compact /></span></button>}
    <button className="button secondary wide" disabled={locked} onClick={() => void act({ type: "work" })}>{t("Поработать · +2 монеты", "Work · +2 coins")}</button>
  </div>;
}

function Results({ view }: { view: DistrictView }) {
  const { t, lang } = useLanguage();
  if (view.outcome?.reason === "abandoned") return <div className="district-result"><span aria-hidden="true">☾</span><h4>{t("Район опустел", "The district is quiet")}</h4><p>{t("Все игроки вышли. Эта партия без победителя.", "All human players left. This game has no winner.")}</p></div>;
  return <div className="district-results"><div className="district-result"><span aria-hidden="true">✦</span><small>{view.outcome?.winnerParticipantIds.length === 1 ? t("Победитель", "Winner") : t("Разделили первое место", "Shared first place")}</small><h4>{view.outcome?.winnerParticipantIds.map(id => playerName(view, lang, id)).join(", ")}</h4></div>{view.outcome?.results.map(result => <article key={result.participantId} className="district-result-row"><div><span>{result.rank}</span><strong>{playerName(view, lang, result.participantId)}</strong><b>{result.capital}</b></div><ResourcesLine value={result} compact /><p>{t("Здания", "Buildings")}: {result.buildings} · {t("Цель", "Goal")}: +{result.goalBonus} · {t("Последний доход", "Last income")}: {result.lastIncome}</p><small>{localized(goalCopy[result.goal].title, lang)} — {result.goalCompleted ? t("выполнена", "complete") : t("не выполнена", "not complete")}</small></article>)}<p>{t("Для новой партии создайте комнату в меню.", "Create a room from the menu for another game.")}</p></div>;
}

function History({ view }: { view: DistrictView }) {
  const { t, lang } = useLanguage();
  const labels: Record<string, string> = {
    event: t("Городская новость", "City news"), bank: t("Обмен с банком", "Bank trade"), trade: t("Сделка заключена", "Deal completed"), park: t("Парк построен", "Park completed"), auction: t("Итоги торгов", "Auction results"), build: t("Новое здание", "New building"), upgrade: t("Здание улучшено", "Building upgraded"), work: t("Работа · +2 монеты", "Work · +2 coins"), income: t("Доход района", "District income"), leave: t("Вышел из партии", "Left the game"), return: t("Вернулся в игру", "Returned to game"), finished: t("Партия завершена", "Game finished"), abandoned: t("Все игроки вышли", "All players left"),
  };
  return <details className="district-history"><summary>{t("История района", "District history")} <span>{view.history.length}</span></summary><ol>{[...view.history].reverse().map(entry => <li key={entry.id}><span>{t("Раунд", "Round")} {entry.round}</span><div><strong>{labels[entry.type]}</strong>{entry.actorId && <small>{playerName(view, lang, entry.actorId)}</small>}<HistoryDetail view={view} type={entry.type} data={entry.data} /></div></li>)}</ol></details>;
}

function HistoryDetail({ view, type, data }: { view: DistrictView; type: string; data: Record<string, unknown> }) {
  const { t, lang } = useLanguage();
  if (type === "event" && data.event) { const copy = eventCopy(data.event as NonNullable<DistrictView["event"]>, lang); return <p>{copy.title} · {copy.description}</p>; }
  if (type === "bank") return <p>{data.direction === "buy" ? t("Покупка", "Bought") : t("Продажа", "Sold")} · {String(data.quantity ?? "")} {typeof data.resource === "string" && data.resource in resourceCopy ? localized(resourceCopy[data.resource as ResourceKind], lang).toLocaleLowerCase(lang) : ""}</p>;
  if (type === "build" || type === "upgrade") { const building = data.building as { kind?: BuildingKind; level?: number } | undefined; return <p>{typeof data.lotId === "string" ? data.lotId : ""}{building?.kind && building.kind in buildingCopy ? ` · ${localized(buildingCopy[building.kind], lang)} ${building.level}` : ""}</p>; }
  if (type === "park") return <div><strong>{typeof data.parkId === "string" ? data.parkId : ""}</strong>{Array.isArray(data.contributions) && (data.contributions as Array<{ participantId: string; resources: Resources }>).map(item => <p key={item.participantId}>{playerName(view, lang, item.participantId)}: <ResourcesLine value={item.resources} compact /></p>)}</div>;
  if (type === "trade" && data.give && data.receive) return <div className="district-trade-summary"><small>{typeof data.authorId === "string" ? playerName(view, lang, data.authorId) : t("Отдано", "Given")}</small><BundleLine bundle={data.give as Bundle} /><small>{typeof data.targetId === "string" ? playerName(view, lang, data.targetId) : t("Получено", "Received")}</small><BundleLine bundle={data.receive as Bundle} /></div>;
  if (type === "auction" && Array.isArray(data.bids)) {
    const winners = (data.winners ?? []) as Array<{ participantId: string; lotId: string; amount: number }>;
    return <div className="district-history-bids">{(data.bids as Array<{ participantId: string; bid: { lotId: string; amount: number } | null }>).map(item => <p key={item.participantId}><strong>{playerName(view, lang, item.participantId)}</strong> · {item.bid ? `${item.bid.lotId}: ${item.bid.amount} ${t("монет", "coins")}` : t("пропуск", "pass")}{winners.some(winner => winner.participantId === item.participantId) ? ` · ${t("участок куплен", "lot won")}` : ""}</p>)}</div>;
  }
  if (type === "income" && data.totals && typeof data.totals === "object") return <div className="district-history-income">{Object.entries(data.totals as Record<string, Resources>).map(([id, resources]) => <p key={id}>{playerName(view, lang, id)}: <ResourcesLine value={resources} compact /></p>)}</div>;
  return null;
}

function RulesHelp({ close }: { close: () => void }) {
  const { t } = useLanguage();
  return <Modal title={t("Район за минуту", "District in a minute")} onClose={close}><div className="district-rules"><p>{t("Покупайте землю, развивайте район и договаривайтесь с соседями. Побеждает самый богатый после последнего дохода.", "Buy land, develop the district and make deals with your neighbours. The richest player after the final income wins.")}</p><ol><li><strong>{t("Выберите личную цель", "Choose a personal goal")}</strong><p>{t("Она скрыта до финала и даёт 5 очков, если выполнена.", "It stays secret until the end and awards 5 points when completed.")}</p></li><li><strong>{t("Обменивайтесь", "Make deals")}</strong><p>{t("После новости торгуйте ресурсами и недвижимостью, оплачивайте общие парки. Банк продаёт ресурс за 3 монеты и покупает за 1.", "After the news, trade resources and property or fund shared parks. The bank sells a resource for 3 coins and buys for 1.")}</p></li><li><strong>{t("Покупайте землю", "Bid for land")}</strong><p>{t("Одна тайная ставка на участок. Больше ставка — ваша земля. Ничья решается очередью раунда. Больше одного пустого участка иметь нельзя.", "Place one secret bid on a lot. Highest bid wins; ties follow the round order. You can own only one empty lot.")}</p></li><li><strong>{t("Стройте или работайте", "Build or work")}</strong><p>{t("Каждому одно действие: стройка, улучшение до уровня 2 или работа за 2 монеты. При таймауте вы работаете.", "Everyone gets one action: build, upgrade to level 2 or work for 2 coins. When time runs out, you work.")}</p></li><li><strong>{t("Получайте доход", "Collect income")}</strong><p>{t("Дом даёт бригаду, мастерская — материал. Кафе любят соседние дома. Парки помогают домам и кафе. Мастерские снижают денежный доход соседей.", "Houses produce crews and workshops produce materials. Cafes like nearby houses. Parks help houses and cafes. Workshops reduce their neighbours' coin income.")}</p></li></ol><div className="district-rules-finish"><strong>{t("Финальный капитал", "Final capital")}</strong><p>{t("Монеты + материалы + бригады + стоимость зданий + 5 за цель. Дом стоит 4/7, кафе 5/8, мастерская 6/9 для уровней 1/2. Пустая земля очков не даёт. При равенстве сравнивается последний денежный доход.", "Coins + materials + crews + building values + 5 for your goal. Houses are worth 4/7, cafes 5/8 and workshops 6/9 at levels 1/2. Empty land scores nothing. Ties are decided by the last coin income.")}</p></div><p>{t("Для 2–3 мест — 6 раундов. Для 4 — 8. Нет долгов, банкротства и выбывания: даже без денег можно работать и договариваться.", "Play 6 rounds with 2–3 seats, or 8 rounds with 4. No debt, bankruptcy or elimination: you can always work and make deals.")}</p></div></Modal>;
}
