import { useEffect, useId, useRef, useState } from "react";
import type { Perform } from "./Auth";
import { PlatformError, request } from "./api";
import {
  acceptTelegramSnapshot,
  canConfirmTelegramAttempt,
  clearTelegramAttempt,
  normalizeTelegramProof,
  pendingTelegramState,
  rememberTelegramAttempt,
  restoreTelegramAttempt,
  safeTelegramStartLink,
  telegramAttemptIsLive,
} from "./telegramFlow";
import type { TelegramAttemptReference } from "./telegramFlow";
import type {
  TelegramAttempt,
  TelegramCreatedAttempt,
  TelegramStatus,
} from "./types";
import { Icon, Modal, useLanguage } from "./ui";

type TelegramAction =
  | { kind: "start" }
  | { kind: "confirm"; attemptId: string; proofCode: string; consent: boolean }
  | { kind: "cancel"; attemptId: string }
  | { kind: "preferences"; enabled: boolean }
  | { kind: "unlink" };

const errorCopy: Record<string, [string, string]> = {
  NETWORK: [
    "Не получилось. Попробуйте ещё раз.",
    "Something went wrong. Please try again.",
  ],
  INVALID_CREDENTIALS: [
    "Неверный пароль. Попробуйте ещё раз.",
    "Incorrect password. Try again.",
  ],
  REAUTH_REQUIRED: [
    "Введите пароль, чтобы продолжить.",
    "Enter your password to continue.",
  ],
  LINK_EXPIRED: [
    "Ссылка истекла. Начните заново.",
    "This link expired. Start again.",
  ],
  LINK_ALREADY_USED: [
    "Эта ссылка уже использована. Начните заново.",
    "This link has been used. Start again.",
  ],
  LINK_SESSION_MISMATCH: [
    "Начните подключение заново в этом браузере.",
    "Start connecting again in this browser.",
  ],
  LINK_PROOF_INVALID: [
    "Неверный код. Попробуйте ещё раз.",
    "Incorrect code. Try again.",
  ],
  LINK_PROOF_LOCKED: [
    "Слишком много ошибок. Начните заново.",
    "Too many incorrect codes. Start again.",
  ],
  TELEGRAM_ALREADY_LINKED: [
    "Telegram связан с другим аккаунтом. Сначала отвяжите его там.",
    "Telegram is linked to another account. Unlink it there first.",
  ],
  TELEGRAM_UNREACHABLE: [
    "Разрешите сообщения от бота и подключитесь снова.",
    "Allow messages from the bot and reconnect.",
  ],
  TELEGRAM_NOT_LINKED: [
    "Сначала подключите Telegram.",
    "Connect Telegram first.",
  ],
  TELEGRAM_UNAVAILABLE: [
    "Telegram пока недоступен.",
    "Telegram is currently unavailable.",
  ],
  TELEGRAM_NOT_CONFIGURED: [
    "Telegram пока недоступен.",
    "Telegram is currently unavailable.",
  ],
  RATE_LIMITED: [
    "Слишком много попыток. Подождите немного и повторите.",
    "Too many attempts. Wait a little and retry.",
  ],
  EMAIL_NOT_VERIFIED: [
    "Сначала подтвердите почту.",
    "Confirm your email first.",
  ],
  UNAUTHENTICATED: [
    "Войдите снова, чтобы продолжить.",
    "Sign in again to continue.",
  ],
  CSRF_INVALID: [
    "Обновите страницу и попробуйте ещё раз.",
    "Reload the page and try again.",
  ],
};

function errorText(
  error: unknown,
  t: (ru: string, en: string) => string,
): string {
  const copy = error instanceof PlatformError ? errorCopy[error.code] : null;
  // Do not render arbitrary server text or account identifiers in this flow.
  return copy
    ? t(...copy)
    : t(
        "Не получилось. Попробуйте ещё раз.",
        "Something went wrong. Please try again.",
      );
}

function attemptPath(id: string): string {
  return "/telegram/link-attempts/" + encodeURIComponent(id);
}

export function TelegramPanel({
  status,
  verified,
  busy,
  perform,
  onStatusChange,
}: {
  status: TelegramStatus | null;
  verified: boolean;
  busy: boolean;
  perform: Perform;
  onStatusChange: (status: TelegramStatus) => void;
}) {
  const { t } = useLanguage();
  const fieldId = useId();
  const [reference, setReference] = useState<TelegramAttemptReference | null>(
    () => restoreTelegramAttempt(Date.now()),
  );
  const [attempt, setAttempt] = useState<TelegramAttempt | null>(null);
  const attemptRef = useRef<TelegramAttempt | null>(null);
  const generation = useRef(0);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [proof, setProof] = useState("");
  const [consent, setConsent] = useState<boolean | null>(null);
  const [clock, setClock] = useState(Date.now);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [pendingAuth, setPendingAuth] = useState<TelegramAction | null>(null);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const available = Boolean(verified && status?.available);
  const live = Boolean(reference && telegramAttemptIsLive(reference, clock));

  function commitAttempt(next: TelegramAttempt) {
    attemptRef.current = next;
    setAttempt(next);
    setClock(Date.now());
    rememberTelegramAttempt(next);
    setReference(
      pendingTelegramState(next.state)
        ? { attemptId: next.attemptId, expiresAt: next.expiresAt }
        : null,
    );
    if (!pendingTelegramState(next.state)) {
      setDeepLink(null);
      setProof("");
      setConsent(null);
    }
  }

  function forgetAttempt() {
    clearTelegramAttempt();
    attemptRef.current = null;
    setAttempt(null);
    setReference(null);
    setDeepLink(null);
    setProof("");
    setConsent(null);
    setPollError(null);
  }

  useEffect(() => {
    if (!reference) return;
    const updateClock = () => {
      const now = Date.now();
      setClock(now);
      if (now >= reference.expiresAt) {
        clearTelegramAttempt();
        return false;
      }
      return true;
    };
    if (!updateClock()) return;
    const timer = window.setInterval(() => {
      if (!updateClock()) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [reference?.attemptId, reference?.expiresAt]);

  useEffect(() => {
    if (!available || !reference || !live || busy) return;
    const id = reference.attemptId;
    const expiresAt = reference.expiresAt;
    let disposed = false;
    let loading = false;
    const load = async () => {
      if (
        disposed ||
        loading ||
        document.visibilityState !== "visible" ||
        Date.now() >= expiresAt
      )
        return;
      loading = true;
      const requestGeneration = generation.current;
      try {
        const next = await request<TelegramAttempt>(attemptPath(id));
        if (
          disposed ||
          !acceptTelegramSnapshot(
            attemptRef.current,
            next,
            id,
            requestGeneration,
            generation.current,
          )
        )
          return;
        commitAttempt(next);
        setPollError(null);
        if (next.state === "confirmed") {
          // A confirmed attempt is not itself proof of a current binding:
          // another tab may already have unlinked it. Read the actual status.
          const current = await request<TelegramStatus>("/telegram");
          if (!disposed && requestGeneration === generation.current)
            onStatusChange(current);
        }
      } catch (cause) {
        if (disposed || requestGeneration !== generation.current) return;
        if (
          cause instanceof PlatformError &&
          ["LINK_SESSION_MISMATCH", "NOT_FOUND", "UNAUTHENTICATED"].includes(
            cause.code,
          )
        ) {
          generation.current++;
          forgetAttempt();
          setError(errorText(cause, t));
        } else setPollError(errorText(cause, t));
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 3000);
    const onVisible = () => void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [
    available,
    reference?.attemptId,
    reference?.expiresAt,
    live,
    busy,
    retry,
    t,
    onStatusChange,
  ]);

  async function execute(action: TelegramAction) {
    if (action.kind === "start") {
      const { deepLink: link, ...next } = await request<TelegramCreatedAttempt>(
        "/telegram/link-attempts",
        {},
      );
      commitAttempt(next);
      setProof("");
      setConsent(null);
      setDeepLink(
        status?.available
          ? safeTelegramStartLink(link, status.botUsername)
          : null,
      );
    } else if (action.kind === "confirm") {
      const next = await request<TelegramStatus>(
        attemptPath(action.attemptId) + "/confirm",
        { proofCode: action.proofCode, consent: action.consent },
      );
      forgetAttempt();
      onStatusChange(next);
      setMessage(
        next.linked
          ? t("Telegram подключён.", "Telegram connected.")
          : t("Начните подключение заново.", "Start connecting again."),
      );
    } else if (action.kind === "cancel") {
      await request(attemptPath(action.attemptId) + "/cancel", {});
      forgetAttempt();
      setMessage(t("Ожидание отменено.", "Waiting cancelled."));
    } else if (action.kind === "preferences") {
      const next = await request<TelegramStatus>("/telegram/preferences", {
        enabled: action.enabled,
      });
      onStatusChange(next);
      setMessage(
        next.available && next.notificationsEnabled
          ? t(
              "Приглашения в Telegram включены.",
              "Telegram invitations are turned on.",
            )
          : t(
              "Приглашения в Telegram выключены.",
              "Telegram invitations are turned off.",
            ),
      );
    } else {
      const next = await request<TelegramStatus>("/telegram/unlink", {});
      forgetAttempt();
      onStatusChange(next);
      setMessage(
        next.linked
          ? t("Готово.", "Done.")
          : t("Telegram отвязан.", "Telegram unlinked."),
      );
    }
  }

  async function failed(action: TelegramAction, cause: unknown) {
    if (cause instanceof PlatformError && cause.code === "REAUTH_REQUIRED") {
      setPendingAuth(action);
      setPassword("");
      setAuthError(null);
      return;
    }
    setError(errorText(cause, t));
    if (
      cause instanceof PlatformError &&
      ["LINK_SESSION_MISMATCH", "NOT_FOUND", "UNAUTHENTICATED"].includes(
        cause.code,
      )
    ) {
      forgetAttempt();
      return;
    }
    // Read remaining proof attempts/terminal state after a rejected POST.
    // This read never retries confirmation or changes consent.
    if ("attemptId" in action) {
      const requestGeneration = generation.current;
      try {
        const next = await request<TelegramAttempt>(
          attemptPath(action.attemptId),
        );
        if (
          acceptTelegramSnapshot(
            attemptRef.current,
            next,
            action.attemptId,
            requestGeneration,
            generation.current,
          )
        )
          commitAttempt(next);
      } catch {
        // Keep the original actionable error; normal polling can recover.
      }
    }
  }

  function run(action: TelegramAction) {
    void perform(async () => {
      // Discard even an already in-flight poll before any side effect starts.
      generation.current++;
      setError(null);
      setMessage(null);
      setPollError(null);
      try {
        await execute(action);
      } catch (cause) {
        await failed(action, cause);
      }
    });
  }

  function reauthenticate() {
    if (!pendingAuth || !password) return;
    const action = pendingAuth;
    const enteredPassword = password;
    void perform(async () => {
      generation.current++;
      setAuthError(null);
      setError(null);
      setMessage(null);
      setPassword("");
      try {
        await request("/auth/reauthenticate", { password: enteredPassword });
      } catch (cause) {
        setAuthError(errorText(cause, t));
        return;
      }
      setPendingAuth(null);
      try {
        await execute(action);
      } catch (cause) {
        await failed(action, cause);
      }
    });
  }

  const connected = status?.available && status.linked;
  const unreachable = status?.available && status.status === "unreachable";
  const activeAttempt = attempt && pendingTelegramState(attempt.state) && live;
  const expired = attempt?.state === "expired" || Boolean(reference && !live);
  const closed =
    attempt?.state === "cancelled" || attempt?.state === "rejected";
  const seconds = reference
    ? Math.max(0, Math.ceil((reference.expiresAt - clock) / 1000))
    : 0;
  const timeLeft =
    Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  const canConfirm = canConfirmTelegramAttempt(attempt, proof, consent, clock);

  return (
    <section className="profile-card telegram-card">
      <div className="telegram-symbol" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none" width="31" height="31">
          <path
            d="M27 5 5 14l8 3 3 9L27 5ZM13 17l14-12M16 26l4-7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h2>Telegram</h2>
      <p className="telegram-intro">
        {t(
          "Приглашения от друзей прямо в Telegram.",
          "Friends’ invitations straight to Telegram.",
        )}
      </p>
      <div className="telegram-flow">
        {!verified ? (
          <div className="telegram-unavailable">
            <Icon name="mail" size={18} />
            <span>
              {t(
                "Подтвердите почту, чтобы подключить Telegram.",
                "Confirm your email to connect Telegram.",
              )}
            </span>
          </div>
        ) : !status ? (
          <p role="status">
            {t("Проверяем подключение…", "Checking connection…")}
          </p>
        ) : !status.available ? (
          <div className="telegram-unavailable">
            <Icon name="mail" size={18} />
            <span>
              {t(
                "Telegram пока недоступен.",
                "Telegram is currently unavailable.",
              )}
            </span>
          </div>
        ) : (
          <>
            {connected && (
              <div className="telegram-connection">
                <div className="telegram-connection-heading">
                  <span
                    className={"tag " + (unreachable ? "planned" : "success")}
                  >
                    {unreachable
                      ? t("Бот недоступен", "Bot unavailable")
                      : t("Подключён", "Connected")}
                  </span>
                  {status.account && (
                    <span className="telegram-account">
                      <strong>{status.account.displayNameMasked}</strong>
                      {status.account.usernameMasked && (
                        <span>{status.account.usernameMasked}</span>
                      )}
                    </span>
                  )}
                </div>
                <p>
                  {unreachable
                    ? t(
                        "Разрешите сообщения от бота и подключитесь снова.",
                        "Allow messages from the bot and reconnect.",
                      )
                    : status.notificationsEnabled
                      ? t("Приглашения включены.", "Invitations are on.")
                      : t("Приглашения выключены.", "Invitations are off.")}
                </p>
                <div className="telegram-actions">
                  {(!unreachable || status.notificationsEnabled) && (
                    <button
                      className="button secondary small"
                      disabled={busy || (Boolean(reference) && live)}
                      onClick={() =>
                        run({
                          kind: "preferences",
                          enabled: !status.notificationsEnabled,
                        })
                      }
                    >
                      {status.notificationsEnabled
                        ? t("Выключить приглашения", "Turn invitations off")
                        : t("Получать приглашения", "Receive invitations")}
                    </button>
                  )}
                  <button
                    className="text-button danger-text"
                    disabled={busy}
                    onClick={() => setConfirmUnlink(true)}
                  >
                    {t("Отвязать", "Unlink")}
                  </button>
                </div>
              </div>
            )}

            {reference && !attempt && live && (
              <div className="telegram-attempt" aria-busy="true">
                <p role="status">
                  {t("Проверяем подключение…", "Checking connection…")}
                </p>
                <button
                  className="text-button telegram-cancel"
                  disabled={busy}
                  onClick={() =>
                    run({ kind: "cancel", attemptId: reference.attemptId })
                  }
                >
                  {t("Отменить", "Cancel")}
                </button>
              </div>
            )}

            {activeAttempt && (
              <div className="telegram-attempt">
                <div className="telegram-attempt-heading">
                  <strong>
                    {attempt.state === "issued"
                      ? t("Откройте бота", "Open the bot")
                      : t("Подтвердите подключение", "Confirm the connection")}
                  </strong>
                  <span
                    className="telegram-countdown"
                    aria-label={
                      t("Осталось времени", "Time remaining") + " " + timeLeft
                    }
                  >
                    {timeLeft}
                  </span>
                </div>
                {attempt.state === "issued" ? (
                  <div className="telegram-start-step">
                    {deepLink ? (
                      <>
                        <p>
                          {t(
                            "Нажмите Start в боте, затем вернитесь сюда.",
                            "Press Start in the bot, then return here.",
                          )}
                        </p>
                        <a
                          href={deepLink}
                          className="button teal"
                          target="_blank"
                          rel="noopener noreferrer"
                          referrerPolicy="no-referrer"
                        >
                          {t("Открыть Telegram", "Open Telegram")}
                          <Icon name="arrow" size={17} />
                        </a>
                      </>
                    ) : (
                      <>
                        <p>
                          {t(
                            "Если бот ещё не открыт, получите новую ссылку.",
                            "If you have not opened the bot, get a new link.",
                          )}
                        </p>
                        <button
                          className="button teal"
                          disabled={busy}
                          onClick={() => run({ kind: "start" })}
                        >
                          {t("Получить новую ссылку", "Get a new link")}
                        </button>
                      </>
                    )}
                    <p className="telegram-waiting" role="status">
                      <span aria-hidden="true" />
                      {t("Ждём Start в боте…", "Waiting for Start in the bot…")}
                    </p>
                  </div>
                ) : (
                  <form
                    className="telegram-proof-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (
                        consent === null ||
                        !canConfirmTelegramAttempt(
                          attempt,
                          proof,
                          consent,
                          Date.now(),
                        )
                      )
                        return;
                      run({
                        kind: "confirm",
                        attemptId: attempt.attemptId,
                        proofCode: normalizeTelegramProof(proof),
                        consent,
                      });
                    }}
                  >
                    {attempt.candidate && (
                      <div className="telegram-candidate">
                        <span>
                          {t("Подключаем Telegram", "Connecting Telegram")}
                        </span>
                        <strong>{attempt.candidate.displayNameMasked}</strong>
                        {attempt.candidate.usernameMasked && (
                          <span>{attempt.candidate.usernameMasked}</span>
                        )}
                      </div>
                    )}
                    <label htmlFor={fieldId + "-proof"}>
                      {t("Код из бота", "Code from the bot")}
                      <input
                        id={fieldId + "-proof"}
                        className="telegram-proof-input"
                        value={proof}
                        onChange={(event) =>
                          setProof(event.target.value.toUpperCase())
                        }
                        autoComplete="one-time-code"
                        autoCapitalize="characters"
                        spellCheck={false}
                        maxLength={16}
                        required
                        disabled={busy}
                        aria-describedby={fieldId + "-proof-help"}
                      />
                      <small id={fieldId + "-proof-help"}>
                        {t(
                          "8 символов: A–Z и 2–7.",
                          "8 characters: A–Z and 2–7.",
                        )}{" "}
                        {attempt.proofAttemptsRemaining < 5 &&
                          t(
                            "Осталось попыток: " +
                              attempt.proofAttemptsRemaining +
                              ".",
                            "Attempts remaining: " +
                              attempt.proofAttemptsRemaining +
                              ".",
                          )}
                      </small>
                    </label>
                    <fieldset className="telegram-consent" disabled={busy}>
                      <legend>
                        {t("Приглашения от друзей", "Invitations from friends")}
                      </legend>
                      <label>
                        <input
                          type="radio"
                          name={fieldId + "-consent"}
                          checked={consent === true}
                          onChange={() => setConsent(true)}
                          required
                        />
                        <span>
                          {t("Получать приглашения", "Receive invitations")}
                        </span>
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={fieldId + "-consent"}
                          checked={consent === false}
                          onChange={() => setConsent(false)}
                          required
                        />
                        <span>
                          {t(
                            "Подключить без уведомлений",
                            "Connect without notifications",
                          )}
                        </span>
                      </label>
                    </fieldset>
                    <button
                      className="button teal"
                      disabled={busy || !canConfirm}
                    >
                      {t("Подключить Telegram", "Connect Telegram")}
                    </button>
                    <p className="telegram-code-note">
                      {t(
                        "Если это не ваш Telegram, отмените подключение.",
                        "If this is not your Telegram, cancel.",
                      )}
                    </p>
                  </form>
                )}
                <button
                  className="text-button telegram-cancel"
                  disabled={busy}
                  onClick={() =>
                    run({ kind: "cancel", attemptId: attempt.attemptId })
                  }
                >
                  {t("Отменить", "Cancel")}
                </button>
              </div>
            )}

            {(expired || closed) && (
              <div className="telegram-attempt telegram-terminal" role="status">
                <strong>
                  {expired
                    ? t("Ссылка истекла", "Link expired")
                    : attempt?.state === "rejected"
                      ? t("Не удалось подключить", "Could not connect")
                      : t("Подключение отменено", "Connection cancelled")}
                </strong>
                <p>{t("Получите новую ссылку.", "Get a new link.")}</p>
              </div>
            )}
            {(!reference || expired) &&
              (!connected || unreachable || expired || closed) && (
                <button
                  className="button teal telegram-connect"
                  disabled={busy}
                  onClick={() => run({ kind: "start" })}
                >
                  {expired || closed
                    ? t("Начать заново", "Start again")
                    : unreachable
                      ? t("Восстановить связь", "Reconnect Telegram")
                      : t("Подключить Telegram", "Connect Telegram")}
                </button>
              )}
          </>
        )}
        {pollError && (
          <div className="telegram-feedback error" role="alert">
            <p>{pollError}</p>
            {reference && live && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => setRetry((value) => value + 1)}
              >
                {t("Проверить снова", "Check again")}
              </button>
            )}
          </div>
        )}
        {error && (
          <div className="telegram-feedback error" role="alert">
            {error}
          </div>
        )}
        {message && (
          <div className="telegram-feedback success" role="status">
            {message}
          </div>
        )}
      </div>
      {pendingAuth && (
        <Modal
          title={t("Подтвердите паролем", "Confirm your password")}
          onClose={() => {
            if (busy) return;
            setPendingAuth(null);
            setPassword("");
            setAuthError(null);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              reauthenticate();
            }}
          >
            <label>
              {t("Пароль Iva Games", "Iva Games password")}
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                maxLength={512}
                required
                disabled={busy}
                autoFocus
              />
            </label>
            {authError && (
              <div className="telegram-feedback error" role="alert">
                {authError}
              </div>
            )}
            <button className="button teal" disabled={busy || !password}>
              {pendingAuth.kind === "unlink"
                ? t("Отвязать Telegram", "Unlink Telegram")
                : pendingAuth.kind === "confirm"
                  ? t("Подключить Telegram", "Connect Telegram")
                  : t("Получить ссылку", "Get a link")}
            </button>
          </form>
        </Modal>
      )}
      {confirmUnlink && (
        <Modal
          title={t("Отвязать Telegram?", "Unlink Telegram?")}
          onClose={() => setConfirmUnlink(false)}
        >
          <div className="button-group">
            <button
              className="button secondary"
              onClick={() => setConfirmUnlink(false)}
            >
              {t("Оставить", "Keep connected")}
            </button>
            <button
              className="button secondary danger-text"
              disabled={busy}
              onClick={() => {
                setConfirmUnlink(false);
                run({ kind: "unlink" });
              }}
            >
              {t("Отвязать Telegram", "Unlink Telegram")}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
