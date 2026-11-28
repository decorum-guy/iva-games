import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { advanceTutorial, createTutorial, startTutorialThreat, tutorialFrame } from "@iva-games/district/territorial";
import type { Resource, Stock, TerritoryAction, TerritoryView } from "@iva-games/district/territorial";
import { PlatformError, request } from "./api";
import { go } from "./navigation";
import { practiceLink } from "./TerritorialLobby";
import { districtBotName } from "./districtCopy";
import { Icon, Modal, useLanguage } from "./ui";
import type { Language, Room } from "./types";
import { TerritorialBoard } from "./TerritorialBoard";
import type { BoardSelection } from "./TerritorialBoard";
import { TerritorialNews, territorialNewsArea } from "./TerritorialNews";
import { TerritorialActions, TerritorialMapActions, ResourceStock } from "./TerritorialActions";
import { TerritorialHistory, TerritorialResult, TerritorialRoll, TerritorialTurn, blockadeText, historyTitle, playerName } from "./TerritorialFeedback";
import { TerritorialIncomeMotion } from "./TerritorialMotion";
import { TerritorialSettings } from "./TerritorialSettings";
import { useTerritorialPreferences } from "./territorialPreferences";
import { useTerritorialAudio } from "./territorialAudio";
import "./territorial-district.css";
import "./territorial-table-polish.css";

const colors = ["#ca4e37", "#2867a8", "#79498f", "#2c7954"];
type Pending = { actionId: string; expectedRevision: number; payload: TerritoryAction & { phaseId: string } };
type T = ReturnType<typeof useLanguage>["t"];

export function TerritorialMatch({ room, refresh }: { room: Room; refresh: () => Promise<void> }) {
  const { t, lang, setLanguage } = useLanguage();
  const [snapshot, setView] = useState<TerritoryView | null>(null);
  const latest = useRef<TerritoryView | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const loading = useRef(false);
  const [status, setStatus] = useState<"retry" | "changed" | "invalid" | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selection, setSelection] = useState<BoardSelection | null>(null);
  const [newsChoice, setNewsChoice] = useState<{ issue: string; id: string | null } | null>(null);
  const [selectedCouponId, setSelectedCouponId] = useState<string | null>(null);
  const [panel, setPanel] = useState<'actions' | 'history'>('actions');
  const panelScroll = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLElement>(null);
  const [help, setHelp] = useState(false);
  const [settings, setSettings] = useState(false);
  const [leave, setLeave] = useState(false);
  const [handDelta, setHandDelta] = useState<Partial<Stock>>({});
  const [handPick, setHandPick] = useState<{ resource: Resource; serial: number } | null>(null);
  const [preferences, setPreferences] = useTerritorialPreferences();
  const audio = useTerritorialAudio(snapshot, preferences.sound);
  const active = useRef(true);
  const accept = useCallback((next: TerritoryView) => {
    const previous = latest.current;
    if (!active.current || previous && (previous.revision > next.revision ||
      previous.revision === next.revision && previous.serverNow > next.serverNow)) return;
    if (previous && next.revision > previous.revision) {
      const delta = Object.fromEntries(Object.entries(next.you.hand).map(([key, count]) => [key, count - previous.you.hand[key as keyof Stock]]));
      if (Object.values(delta).some(Boolean)) setHandDelta(delta);
    }
    latest.current = next;
    setView(next);
    setLoadError(false);
  }, []);
  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try { accept((await request<{ view: TerritoryView }>(`/rooms/${room.roomId}/match`)).view); }
    catch { if (active.current) setLoadError(true); }
    finally { loading.current = false; }
  }, [room.roomId, accept]);
  useEffect(() => {
    active.current = true;
    const poll = () => { if (!latest.current?.outcome && document.visibilityState === "visible") void load(); };
    poll();
    const timer = setInterval(poll, 1100);
    document.addEventListener("visibilitychange", poll);
    window.addEventListener("online", poll);
    return () => { active.current = false; clearInterval(timer); document.removeEventListener("visibilitychange", poll); window.removeEventListener("online", poll); };
  }, [load]);
  useEffect(() => {
    if (!Object.values(handDelta).some(Boolean)) return;
    const timer = setTimeout(() => setHandDelta({}), 5500);
    return () => clearTimeout(timer);
  }, [handDelta]);
  useEffect(() => {
    if (panel === 'actions' && selection) panelScroll.current?.scrollTo({ top: 0 });
  }, [selection, panel]);
  const finished = Boolean(snapshot?.outcome);
  useEffect(() => {
    if (finished) { setPanel('actions'); panelScroll.current?.scrollTo({top:0}); }
  }, [finished]);
  useEffect(() => {
    if (!preferences.shortcuts) return;
    function keydown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable=true],dialog')) return;
      if (event.key === 'Escape') { setSelection(null); setSelectedCouponId(null); }
      if (event.key.toLowerCase() === 'h' || event.key.toLowerCase() === 'р') { event.preventDefault(); setPanel('history'); }
      if (event.key.toLowerCase() === 'g' || event.key.toLowerCase() === 'п') { event.preventDefault(); setPanel('actions'); }
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [preferences.shortcuts]);

  async function submit(command: Pending): Promise<boolean> {
    if (sending.current) return false;
    sending.current = true; setBusy(true); setStatus(null);
    try {
      const result = await request<{ view: TerritoryView }>(`/rooms/${room.roomId}/actions`, command);
      accept(result.view); setPending(null);
      if (command.payload.type === "leave") { go("rooms"); return true; }
      if (result.view.outcome) void refresh().catch(() => {}); else void load();
      return true;
    } catch (error) {
      if (error instanceof PlatformError && error.status > 0 && error.status < 500) {
        setPending(null); setStatus(error.status === 409 ? "changed" : "invalid"); void load();
      } else { setPending(command); setStatus("retry"); }
      return false;
    } finally { sending.current = false; setBusy(false); }
  }
  async function act(action: TerritoryAction): Promise<boolean> {
    if (!latest.current || sending.current || pending) return false;
    return submit({ actionId: crypto.randomUUID(), expectedRevision: latest.current.revision, payload: { ...action, phaseId: latest.current.phaseId } });
  }
  const choose = (target: BoardSelection) => {
    const block = latest.current?.legal.block;
    if (block?.length && (target.kind !== 'tile' || !block.some(option => option.tileId === target.id))) return;
    setSelection(target); setPanel('actions');
  };
  function showCoupon(id: string) {
    setSelectedCouponId(id); setPanel('actions');
    const first = latest.current?.legal.couponRoutes?.[id]?.[0];
    if (first) setSelection({ kind: 'edge', id: first });
  }

  if (!snapshot) return <section className="territory-match territory-loading">
    <button className="back-link" onClick={() => go("rooms")}>‹ {t("Мои комнаты", "My rooms")}</button>
    {loadError ? <button className="button secondary" onClick={() => void load()}>{t("Загрузить партию", "Load match")}</button> : <span className="spinner" />}
  </section>;
  const view: TerritoryView = { ...snapshot, players: snapshot.players.map(player => player.isBot
    ? { ...player, displayName: districtBotName(player.seatIndex, lang) } : player) };
  const left = view.players.find(player => player.participantId === view.you.participantId)?.left;
  const currentIssue = view.news.at(-1)?.messageId ?? '';
  const hasNewsChoice = newsChoice?.issue === currentIssue;
  const automaticNews = view.threats.at(-1) ?? (view.news.at(-1)?.round === view.round ? view.news.at(-1) : undefined);
  const news = hasNewsChoice ? view.news.find(item => item.messageId === newsChoice.id) ?? view.threats.find(item => item.messageId === newsChoice.id) : automaticNews;
  const selectNews = (id: string | null) => setNewsChoice({ issue: currentIssue, id });
  const candidates = view.legal.block.length ? view.legal.block.map(item => item.tileId) : view.legal.options.map(item => item.id);
  const couponRoads = selectedCouponId ? view.legal.couponRoutes?.[selectedCouponId] ?? [] : [];
  const ownClosed = [...(view.offerHistory ?? [])].reverse()[0];
  const incoming = view.offers.filter(offer => offer.targetId === view.you.participantId);
  const receipt = [...(view.history ?? [])].reverse().find(entry => !['end','distribution'].includes(entry.kind));
  const classes = 'territory-match territory-map-first' + (preferences.reduceMotion ? ' territory-reduce-motion' : '') + (preferences.compactPanels ? ' territory-compact' : '') + (preferences.highContrast ? ' territory-contrast' : '');
  return <section ref={tableRef} className={classes} style={{ '--table-text-scale': preferences.textSize / 100 } as CSSProperties}
    aria-label={t("Территориальная партия Района", "District territorial match")}>
    <header className="territory-top">
      <div className="territory-map-title"><button className="back-link" onClick={() => go("rooms")}>‹ {t("Комнаты", "Rooms")}</button><h2>{view.map.name[lang]}</h2></div>
      <TerritorialPlayers view={view} lang={lang}/><div className="territory-tools">
        <button type="button" className="territory-tool" onClick={() => setHelp(true)}>{t("Правила", "Rules")}</button>
        <button type="button" className="territory-tool" aria-label={t("Настройки", "Settings")} title={t("Настройки", "Settings")} onClick={() => setSettings(true)}><Icon name="settings" size={19}/><span>{t("Настройки", "Settings")}</span></button>
        {!view.outcome && !left && <button type="button" className="territory-concede" onClick={() => setLeave(true)}>{t("Сдаться", "Concede")}</button>}
      </div>
    </header>
    <div className="territory-statusbar"><TerritorialTurn view={view} lang={lang}/><TerritorialRoll view={view} lang={lang} onSelect={choose}/></div>
    <div className="territory-layout">
      <div className="territory-map-column">
        <div className="territory-map-shell"><TerritorialBoard map={view.map} buildings={view.buildings} routes={view.routes} players={view.players} lang={lang}
          blockedTileId={view.blockedTileId} blockade={view.blockade} selection={selection} onSelect={choose} candidates={candidates}
          rolledTileIds={view.latestRoll?.triggeredTileIds} highlightedRoadIds={couponRoads} newsArea={territorialNewsArea(news)} blockMode={view.legal.block.length > 0} activeEffects={view.activeEffects}/>
          <TerritorialMapActions view={view} lang={lang} selection={selection} busy={busy || Boolean(pending) || loadError || Boolean(left)} onAction={act} handPick={handPick}/>
          {selectedCouponId && <div className="territory-map-filter" role="status"><span>{couponRoads.length ? t(`По купону: ${couponRoads.length} дорог`, `Coupon: ${couponRoads.length} roads`) : t('Сейчас подходящих дорог нет', 'No eligible roads right now')}</span>
            <button type="button" onClick={() => setSelectedCouponId(null)} aria-label={t('Убрать фильтр дорог', 'Clear road filter')}>×</button></div>}
        </div>
        <section className="territory-hand" aria-label={t('Ваша рука', 'Your hand')}><div className="territory-hand-heading"><strong>{t('Ваши ресурсы', 'Your resources')}</strong><small>{Object.values(view.you.hand).reduce((a,b) => a+b,0)} {t('в руке', 'in hand')}</small></div>
          <ResourceStock stock={view.you.hand} lang={lang} showZero appearance="cards" delta={handDelta} onPick={view.turn > 0 && !view.outcome && !view.you.discard && !view.legal.block.length && !left ? resource => setHandPick(previous => ({resource,serial:(previous?.serial ?? 0)+1})) : undefined}/></section>
      </div>
      <aside className="territory-inspector">
        <div className="territory-tabs" role="group" aria-label={t('Панель стола', 'Table panel')}>
          <button type="button" aria-pressed={panel === 'actions'} onClick={() => setPanel('actions')}>{t('Действия', 'Actions')}{incoming.length > 0 && <b>{incoming.length}</b>}</button>
          <button type="button" aria-pressed={panel === 'history'} onClick={() => setPanel('history')}>{t('История ходов', 'Turn history')}</button>
        </div>
        <div className="territory-panel-scroll" ref={panelScroll} tabIndex={0} aria-label={t('Панель действий и истории', 'Actions and history panel')}>
          {status && <div className="territory-notice" role="status">{status === 'retry' ? t('Связь прервалась. Ваше действие сохранено для повтора.', 'Connection interrupted. Your action is saved for retry.') : status === 'changed' ? t('Стол обновился. Проверьте условия и попробуйте ещё раз.', 'The table changed. Check the terms and try again.') : t('Проверьте выбранное место и ресурсы.', 'Check the selected place and resources.')}
            {pending && <button type="button" className="button small secondary" disabled={busy} onClick={() => void submit(pending)}>{t('Повторить', 'Retry')}</button>}</div>}
          {loadError && !status && <p className="territory-notice" role="status">{t('Переподключение…', 'Reconnecting…')}</p>}
          <div hidden={panel !== 'actions'}>
            {view.outcome && <TerritorialResult view={view} lang={lang}/>}
            {left && <p className="territory-notice">{t('Ваше место ведёт бот.', 'A bot is playing your seat.')}</p>}
            {selection?.kind === 'tile' && selection.id === view.blockedTileId && <div className="territory-blockade"><strong>{t('Производство заблокировано', 'Production blocked')}</strong><p>{blockadeText(view.blockade,view,lang)}</p></div>}
            <TerritorialActions view={view} lang={lang} selection={selection} busy={busy || Boolean(pending) || loadError || Boolean(left)} onAction={act}
              selectedCouponId={selectedCouponId} onShowCouponRoutes={showCoupon}/>
            {receipt && !['offer','accept','decline','cancel','offer-closed'].includes(receipt.kind) && <div className="territory-action-receipt"><small>{t('Последнее действие', 'Latest action')} · {playerName(view,receipt.actorId)}</small><strong>{historyTitle(receipt,view,lang)}</strong>
              {receipt.paid && Object.values(receipt.paid).some(Boolean) && <span>{t('Списано: ', 'Paid: ')}<ResourceStock stock={receipt.paid} lang={lang}/></span>}
              {receipt.received && Object.values(receipt.received).some(Boolean) && <span>{t('Получено: ', 'Received: ')}<ResourceStock stock={receipt.received} lang={lang}/></span>}
            </div>}
          </div>
          <div hidden={panel !== 'history'}><TerritorialHistory view={view} lang={lang} onSelect={choose}/></div>
        </div>
        <TerritorialNews view={view} lang={lang} selectedId={news?.messageId ?? null} onSelect={selectNews} autoOpen={preferences.newsNotices && !view.outcome && !view.you.discard && !view.legal.block.length} onShowCouponRoutes={showCoupon}/>
      </aside>
    </div>
    <TerritorialIncomeMotion view={view} root={tableRef} reduceMotion={preferences.reduceMotion} disconnected={loadError}/>
    <div className="territory-sr-only" aria-live="polite" aria-atomic="true">{preferences.turnNotices && view.you.participantId === view.activeParticipantId ? t('Ваш ход.', 'Your turn.') : ''}
      {preferences.tradeNotices && ownClosed ? historyTradeNotice(ownClosed.status,lang) : ''}</div>
    {settings && <TerritorialSettings view={view} lang={lang} setLanguage={setLanguage} preferences={preferences} onChange={setPreferences}
      onPreview={() => void audio.preview('house')} onClose={() => setSettings(false)}/>}
    {help && <Modal title={t('Как играть', 'How to play')} onClose={() => setHelp(false)}><TerritorialHelp t={t} goal={view.goal}/><a className="button secondary" href={practiceLink(room.roomId)}>{t('Открыть тренировку', 'Open practice')}</a></Modal>}
    {leave && <Modal title={t('Сдаться в этой партии?', 'Concede this match?')} onClose={() => setLeave(false)}>
      <form onSubmit={(event: FormEvent) => { event.preventDefault(); void act({ type:'leave' }); setLeave(false); }}><button className="button primary" disabled={busy || !!pending}>{t('Сдаться', 'Concede')}</button></form></Modal>}
  </section>;
}

function historyTradeNotice(status: string, lang: Language) {
  if (status === 'accepted') return lang === 'ru' ? 'Обмен исполнен.' : 'Trade completed.';
  if (status === 'declined') return lang === 'ru' ? 'Предложение отклонено.' : 'Offer declined.';
  return lang === 'ru' ? 'Статус предложения изменился.' : 'The offer status changed.';
}

function TerritorialPlayers({ view, lang }: { view: TerritoryView; lang: Language }) {
  const ru = lang === "ru";
  return <ul className="territory-players">
    {view.players.map(player => <li key={player.participantId} className={player.participantId === view.activeParticipantId && !view.outcome ? "is-active" : ""}>
      <span className="territory-seat" style={{ background: colors[player.seatIndex] }}>{player.seatIndex + 1}</span>
      <span className="territory-person"><strong title={player.displayName}>{player.displayName}</strong>
        <small title={ru ? `Ресурсы: ${player.handCount} · Путь: ${player.longestRoute} · Карты развития: ${player.cardCount}` : `Resources: ${player.handCount} · Route: ${player.longestRoute} · Development cards: ${player.cardCount}`}>{player.isBot || player.left ? ru ? "Бот · " : "Bot · " : ""}{ru ? "Ресурсы" : "Resources"} {player.handCount}
          {" · "}{ru ? "Путь" : "Route"} {player.longestRoute}{` · ${ru ? "Карты" : "Cards"} ${player.cardCount}`}</small>
      </span>
      <b className="territory-points">{player.participantId === view.you.participantId ? view.you.points : player.points}<small>/{view.goal}</small></b>
    </li>)}
  </ul>;
}

function TerritorialHelp({ t, goal }: { t: T; goal: number }) {
  return <ol className="territory-help">
    <li>{t("Поставьте два дома и проведите от них дороги. Числа на местности определяют, когда она даст ресурсы.", "Place two homes and connect roads to them. Terrain numbers determine when they produce resources.")}</li>
    <li>{t("В свой ход бросьте кубики. Доход получают все владельцы соседних домов. Семёрка перемещает блокаду и может потребовать сброса.", "Roll on your turn. All owners of neighbouring homes collect income. A seven moves the blockade and may require a discard.")}</li>
    <li>{t("Стройте вдоль своих путей. На море выходят из своего прибрежного дома. Порты улучшают курс банка, а с игроками можно договориться.", "Build along your routes. Sail from a coastal home. Ports improve bank rates, and trades with other players are negotiable.")}</li>
    <li>{t(`Гонка до ${goal} очков. Их дают дома, улучшения, самый длинный путь, патрули и грамоты. При равном максимуме после новости победа совместная.`, `Race to ${goal} points. Score with homes, upgrades, the longest route, patrols and charters. Equal leaders share a win after a news event.`)}</li>
    <li>{t("Круг заканчивается после хода каждого места. Иногда события происходят внезапно. При объявленной угрозе можно защитить выбранный дом.", "A round ends when every seat has played. Some events arrive without warning. When a threat is announced, you can protect a selected building.")}</li>
  </ol>;
}

export function TerritorialPractice() {
  const [lang, setLang] = useState<Language>(() => localStorage.getItem("iva.portal.language") === "en" ? "en" : "ru");
  const t = (ru: string, en: string) => lang === "ru" ? ru : en;
  const [history, setHistory] = useState(() => [createTutorial()]);
  const [selection, setSelection] = useState<BoardSelection | null>(null);
  const [newsId, setNewsId] = useState<string | null>(null);
  const frame = tutorialFrame(history.at(-1)!);
  const { view, target } = frame;
  const roomId = new URLSearchParams(window.location.search).get("room");
  const back = roomId && /^[a-zA-Z0-9-]{1,64}$/.test(roomId) ? "/rooms/" + roomId : "/rooms";
  const news = view.news.find(item => item.messageId === newsId);
  const candidates = target && target.kind !== "sector" ? [target.id] : [];
  const begin = (threat: boolean) => {
    setNewsId(null);
    setSelection(null);
    setHistory([threat ? startTutorialThreat() : createTutorial()]);
  };
  function advance() {
    if (frame.step === "good-news") setNewsId(view.news.at(-1)!.messageId);
    const id = target?.kind === "sector" ? target.id : selection?.id;
    setHistory(previous => {
      const state = previous.at(-1)!;
      const next = advanceTutorial(state, id);
      return next === state ? previous : [...previous, next];
    });
    setSelection(null);
  }
  const needed = target && target.kind !== "sector" || frame.step === "protect";
  const enabled = !needed || selection && (target ? target.id === selection.id : selection.kind === "node");
  return <main className="territory-match territory-practice">
    <header className="territory-top">
      <div className="territory-map-title"><a className="back-link" href={back}>‹ {t("К комнатам", "Rooms")}</a><h2>{t("Тренировка", "Practice")}</h2></div>
      <div className="territory-tools" aria-label={t("Язык", "Language")}>{(["ru", "en"] as const).map(item =>
        <button key={item} className="button small secondary" aria-pressed={lang === item} onClick={() => { localStorage.setItem("iva.portal.language", item); setLang(item); }}>{item.toUpperCase()}</button>)}</div>
    </header>
    <TerritorialPlayers view={view} lang={lang} />
    <div className="territory-statusbar"><TerritorialTurn view={view} lang={lang}/><TerritorialRoll view={view} lang={lang} onSelect={setSelection}/></div>
    <div className="territory-layout">
      <div className="territory-map-column"><div className="territory-map-shell">
        <TerritorialBoard map={view.map} buildings={view.buildings} routes={view.routes} players={view.players} lang={lang}
          blockedTileId={view.blockedTileId} selection={selection} onSelect={setSelection} candidates={candidates}
          newsArea={territorialNewsArea(news)} />
      </div><section className="territory-hand" aria-label={t('Ваша рука', 'Your hand')}>
        <div className="territory-hand-heading"><strong>{t('Ваши ресурсы', 'Your resources')}</strong><small>{Object.values(view.you.hand).reduce((a,b) => a+b,0)} {t('в руке', 'in hand')}</small></div>
        <ResourceStock stock={view.you.hand} lang={lang} showZero appearance="cards"/>
      </section></div>
      <aside className="territory-inspector">
        <div className="territory-panel-scroll">
        <article className="territory-lesson">
          <h3>{frame.title[lang]}</h3><p>{frame.body[lang]}</p>
          {frame.step === "complete" ? <>
            <a className="button primary" href={back}>{frame.button[lang]}</a>
            <button className="button secondary" onClick={() => begin(true)}>{t("Приготовиться к угрозе", "Prepare for a threat")}</button>
          </> : <button className="button primary" disabled={!enabled} onClick={advance}>{frame.button[lang]}</button>}
          <div className="territory-lesson-steps">
            {history.length > 1 && <button className="text-button" onClick={() => { setSelection(null); setNewsId(null); setHistory(history.slice(0, -1)); }}>{t("Назад на шаг", "Previous step")}</button>}
            <button className="text-button" onClick={() => begin(false)}>{t("Сначала", "Restart")}</button>
            <a href={back}>{t("Пропустить", "Skip")}</a>
          </div>
        </article></div>
        <TerritorialNews view={view} lang={lang} selectedId={newsId} onSelect={setNewsId} />
      </aside>
    </div>
  </main>;
}
