import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { advanceTutorial, createTutorial, startTutorialThreat, tutorialFrame } from "@iva-games/district/territorial";
import type { TerritoryAction, TerritoryView } from "@iva-games/district/territorial";
import { PlatformError, request } from "./api";
import { go } from "./navigation";
import { practiceLink } from "./TerritorialLobby";
import { Modal, useLanguage } from "./ui";
import type { Language, Room } from "./types";
import { TerritorialBoard } from "./TerritorialBoard";
import type { BoardSelection } from "./TerritorialBoard";
import { TerritorialNews, territorialNewsArea } from "./TerritorialNews";
import { TerritorialActions, ResourceStock } from "./TerritorialActions";
import "./territorial-district.css";

const colors = ["#ca4e37", "#2867a8", "#79498f", "#2c7954"];
type Pending = { actionId: string; expectedRevision: number; payload: TerritoryAction & { phaseId: string } };
type T = ReturnType<typeof useLanguage>["t"];

export function TerritorialMatch({ room, refresh }: { room: Room; refresh: () => Promise<void> }) {
  const { t, lang } = useLanguage();
  const [view, setView] = useState<TerritoryView | null>(null);
  const latest = useRef<TerritoryView | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [status, setStatus] = useState<"retry" | "changed" | "invalid" | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selection, setSelection] = useState<BoardSelection | null>(null);
  const [newsSelection, setNewsSelection] = useState<{ issue: string; id: string | null } | null>(null);
  const [help, setHelp] = useState(false);
  const [leave, setLeave] = useState(false);
  const active = useRef(true);
  const accept = useCallback((next: TerritoryView) => {
    if (!active.current || latest.current && (latest.current.revision > next.revision ||
      latest.current.revision === next.revision && latest.current.serverNow > next.serverNow)) return;
    latest.current = next;
    setView(next);
    setLoadError(false);
  }, []);
  const load = useCallback(async () => {
    try {
      accept((await request<{ view: TerritoryView }>(`/rooms/${room.roomId}/match`)).view);
    } catch {
      if (active.current) setLoadError(true);
    }
  }, [room.roomId, accept]);

  useEffect(() => {
    active.current = true;
    const poll = () => { if (!latest.current?.outcome && document.visibilityState === "visible") void load(); };
    poll();
    const timer = setInterval(poll, 1100);
    document.addEventListener("visibilitychange", poll);
    window.addEventListener("online", poll);
    return () => {
      active.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
      window.removeEventListener("online", poll);
    };
  }, [load]);

  async function submit(command: Pending) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setStatus(null);
    try {
      const result = await request<{ view: TerritoryView }>(`/rooms/${room.roomId}/actions`, command);
      accept(result.view);
      setPending(null);
      if (command.payload.type === "leave") { go("rooms"); return; }
      if (result.view.outcome) void refresh().catch(() => {});
      else void load();
    } catch (error) {
      if (error instanceof PlatformError && error.status > 0 && error.status < 500) {
        setPending(null);
        setStatus(error.status === 409 ? "changed" : "invalid");
        void load();
      } else {
        setPending(command);
        setStatus("retry");
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  function act(action: TerritoryAction) {
    if (!latest.current || sending.current || pending) return;
    void submit({ actionId: crypto.randomUUID(), expectedRevision: latest.current.revision, payload: { ...action, phaseId: latest.current.phaseId } });
  }

  if (!view) return <section className="territory-match">
    <button className="back-link" onClick={() => go("rooms")}>‹ {t("Мои комнаты", "My rooms")}</button>
    {loadError ? <button className="button secondary" onClick={() => void load()}>{t("Загрузить партию", "Load match")}</button> : <span className="spinner" />}
  </section>;

  const activePlayer = view.players.find(player => player.participantId === view.activeParticipantId)!;
  const own = view.you.participantId === view.activeParticipantId;
  const left = view.players.find(player => player.participantId === view.you.participantId)?.left;
  const seconds = Math.max(0, Math.ceil(((view.deadlineAt ?? view.serverNow) - view.serverNow) / 1000));
  const countdown = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const winnerNames = view.players.filter(player => view.outcome?.winnerParticipantIds.includes(player.participantId)).map(player => player.displayName);
  const issue = view.news.at(-1)?.messageId ?? "";
  const hasChoice = newsSelection?.issue === issue;
  const newsId = hasChoice ? newsSelection.id : null;
  const automatic = view.threats.at(-1) ?? (view.news.at(-1)?.round === view.round ? view.news.at(-1) : undefined);
  const news = hasChoice ? view.news.find(item => item.messageId === newsId) : automatic;
  const selectNews = (id: string | null) => setNewsSelection({ issue, id });
  const candidates = view.legal.block.length ? view.legal.block.map(item => item.tileId) : view.legal.options.map(item => item.id);
  return <section className="territory-match" aria-label={t("Территориальная партия Района", "District territorial match")}>
    <header className="territory-top">
      <div className="territory-map-title">
        <button className="back-link" onClick={() => go("rooms")}>‹ {t("Комнаты", "Rooms")}</button>
        <h2>{view.map.name[lang]}</h2>
      </div>
      <div className="territory-turn">
        <strong>{view.outcome ? t("Партия завершена", "Match complete") : view.turn === 0 ? t("Расстановка", "Setup") : `${t("Круг", "Round")} ${view.round + 1}`}</strong>
        {!view.outcome && <span>{own && !left ? t("Ваш ход", "Your turn") : activePlayer.displayName}</span>}
        {!view.outcome && <span className="territory-clock" aria-label={t("На действие осталось " + countdown, "Time left " + countdown)}>{countdown}</span>}
      </div>
      <div className="territory-tools">
        <button className="button small secondary" onClick={() => setHelp(true)}>{t("Правила", "Rules")}</button>
        {!view.outcome && !left && <button className="text-button" onClick={() => setLeave(true)}>{t("Сдаться", "Concede")}</button>}
      </div>
    </header>
    <TerritorialPlayers view={view} lang={lang} />
    <div className="territory-layout">
      <div className="territory-map-shell">
        <TerritorialBoard map={view.map} buildings={view.buildings} routes={view.routes} players={view.players} lang={lang}
          blockedTileId={view.blockedTileId} selection={selection} onSelect={setSelection} candidates={candidates}
          newsArea={territorialNewsArea(news)} />
      </div>
      <aside className="territory-inspector">
        <div className="territory-hand">
          <strong>{t("Ваша рука", "Your hand")}</strong>
          <ResourceStock stock={view.you.hand} lang={lang} showZero />
        </div>
        {status && <div className="territory-notice" role="status">
          {status === "retry" ? t("Связь прервалась.", "Connection interrupted.") : status === "changed" ? t("Положение изменилось. Выберите действие ещё раз.", "The board has changed. Choose again.") : t("Действие недоступно. Проверьте выбранное место и ресурсы.", "Check the selected spot and your resources.")}
          {pending && <button className="button small secondary" disabled={busy} onClick={() => void submit(pending)}>{t("Повторить", "Retry")}</button>}
        </div>}
        {loadError && !status && <p className="territory-notice" role="status">{t("Переподключение…", "Reconnecting…")}</p>}
        {view.outcome ? <div className="territory-outcome" role="status"><small>{view.outcome.reason === "abandoned" ? t("Партия закрыта", "Match closed") : winnerNames.length > 1 ? t("Совместная победа", "Joint victory") : t("Победитель", "Winner")}</small><h3>{winnerNames.join(" · ")}</h3></div>
          : left ? <p className="territory-notice">{t("Ваше место ведёт бот.", "A bot is playing your seat.")}</p>
          : <TerritorialActions view={view} lang={lang} selection={selection} busy={busy || Boolean(pending) || loadError} onAction={act} />}
        <TerritorialNews view={view} lang={lang} selectedId={newsId} onSelect={selectNews} />
      </aside>
    </div>
    {help && <Modal title={t("Как играть", "How to play")} onClose={() => setHelp(false)}>
      <TerritorialHelp t={t} goal={view.goal} /><a className="button secondary" href={practiceLink(room.roomId)}>{t("Открыть тренировку", "Open practice")}</a>
    </Modal>}
    {leave && <Modal title={t("Сдаться в этой партии?", "Concede this match?")} onClose={() => setLeave(false)}>
      <form onSubmit={(event: FormEvent) => { event.preventDefault(); act({ type: "leave" }); setLeave(false); }}>
        <button className="button primary" disabled={busy || !!pending}>{t("Сдаться", "Concede")}</button>
      </form>
    </Modal>}
  </section>;
}

function TerritorialPlayers({ view, lang }: { view: TerritoryView; lang: Language }) {
  const ru = lang === "ru";
  return <ul className="territory-players">
    {view.players.map(player => <li key={player.participantId} className={player.participantId === view.activeParticipantId && !view.outcome ? "is-active" : ""}>
      <span className="territory-seat" style={{ background: colors[player.seatIndex] }}>{player.seatIndex + 1}</span>
      <span className="territory-person"><strong>{player.displayName}</strong>
        <small>{player.isBot || player.left ? ru ? "Бот · " : "Bot · " : ""}{ru ? "Рука" : "Hand"} {player.handCount}
          {" · "}{ru ? "Путь" : "Route"} {player.longestRoute}{player.cardCount > 0 ? ` · ${ru ? "Карты" : "Cards"} ${player.cardCount}` : ""}</small>
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
    <div className="territory-layout">
      <div className="territory-map-shell">
        <TerritorialBoard map={view.map} buildings={view.buildings} routes={view.routes} players={view.players} lang={lang}
          blockedTileId={view.blockedTileId} selection={selection} onSelect={setSelection} candidates={candidates}
          newsArea={territorialNewsArea(news)} />
      </div>
      <aside className="territory-inspector">
        <div className="territory-hand"><strong>{t("Ваша рука", "Your hand")}</strong><ResourceStock stock={view.you.hand} lang={lang} showZero /></div>
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
        </article>
        <TerritorialNews view={view} lang={lang} selectedId={newsId} onSelect={setNewsId} />
      </aside>
    </div>
  </main>;
}
