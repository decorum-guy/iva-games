import { useState } from "react";
import type { FormEvent } from "react";
import { Brand, GameArt, Icon, useLanguage } from "./ui";
import { PlatformError, request } from "./api";
import { PortalLink } from "./navigation";
import { TelegramSignIn } from "./TelegramSignIn";
import type { AuthMethods } from "./types";
import { chessHomeUrl } from "./links";

export type Entrance = { kind: "verify" | "reset"; token: string } | null;
export function readEntrance(): Entrance {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("token");
  if (!token) return null;
  const kind = /reset/.test(url.pathname)
    ? "reset"
    : /verify/.test(url.pathname)
      ? "verify"
      : null;
  if (!kind) return null;
  url.searchParams.delete("token");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  return { kind, token };
}

export type Perform = (
  action: () => Promise<void>,
  success?: string,
) => Promise<boolean>;
export function Auth({
  busy,
  perform,
  onAuthenticated,
  entrance: requestedEntrance,
  clearEntrance,
  auth,
}: {
  busy: boolean;
  perform: Perform;
  onAuthenticated: () => Promise<void>;
  entrance: Entrance;
  auth?: AuthMethods;
  clearEntrance: () => void;
}) {
  const { t } = useLanguage();
  const entrance = auth?.email === false ? null : requestedEntrance;
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [sent, setSent] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      (entrance?.kind === "reset" || mode === "register") &&
      ([...password].length < 15 || [...password].length > 128)
    ) {
      await perform(async () => {
        throw new PlatformError("INVALID_PASSWORD", "Use 15–128 characters.");
      });
      return;
    }
    if (entrance?.kind === "reset") {
      if (
        await perform(
          async () => {
            await request("/auth/reset-password", {
              token: entrance.token,
              password,
            });
            await onAuthenticated();
          },
          t(
            "Пароль изменён. Войдите с новым паролем.",
            "Password changed. Sign in with your new password.",
          ),
        )
      ) {
        clearEntrance();
        setPassword("");
        setMode("login");
      }
    } else if (mode === "forgot") {
      if (
        await perform(async () => {
          await request("/auth/forgot-password", { email });
        })
      )
        setSent(true);
    } else {
      await perform(async () => {
        await request(
          `/auth/${mode}`,
          mode === "register"
            ? {
                email,
                password,
                handle,
                displayName: displayName.trim() || handle,
              }
            : { email, password },
        );
        setPassword("");
        await onAuthenticated();
      });
    }
  };
  const title =
    entrance?.kind === "verify"
      ? t("Подтвердите почту", "Confirm your email")
      : entrance?.kind === "reset"
        ? t("Новый пароль", "New password")
        : mode === "register"
          ? t("Создать аккаунт", "Create account")
          : mode === "forgot"
            ? t("Сбросить пароль", "Reset password")
            : t("Войти в Iva Games", "Sign in to Iva Games");
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <Brand />
        <div className="story-copy">
          <h1>
            {t("Хорошая компания.\nТвой ход.", "Good company.\nYour move.")}
          </h1>
          <p>
            {t(
              "Собирайте друзей, договаривайтесь и играйте вместе.",
              "Bring friends together, make deals and play.",
            )}
          </p>
        </div>
        <div className="story-board">
          <GameArt kind="district" />
          <GameArt kind="harbor" />
          <span className="story-die">
            <Icon name="games" size={54} />
          </span>
        </div>
        <p className="story-footer">
          {t(
            "Друзья и игры в одном месте",
            "Friends and games in one place",
          )}
        </p>
      </section>
      <section className="auth-form-wrap">
        <div className="auth-card">
          <h2>{title}</h2>
          {!entrance && auth?.telegram ? (
            <TelegramSignIn busy={busy} perform={perform} onAuthenticated={onAuthenticated} />
          ) : !entrance && auth?.email === false ? (
            <div className="telegram-sign-in">
              <p>{t("Вход через Telegram пока недоступен. Гостевые шахматы уже можно открыть.", "Telegram sign-in is currently unavailable. You can still play chess as a guest.")}</p>
              <PortalLink href={chessHomeUrl} className="button secondary wide">{t("К шахматам", "Go to chess")}</PortalLink>
            </div>
          ) : entrance?.kind === "verify" ? (
            <>
              <button
                className="button primary wide"
                disabled={busy}
                onClick={() =>
                  void perform(
                    async () => {
                      await request("/auth/verify", { token: entrance.token });
                      clearEntrance();
                      await onAuthenticated();
                    },
                    t("Почта подтверждена.", "Email confirmed."),
                  )
                }
              >
                {t("Подтвердить почту", "Confirm email")}
              </button>
            </>
          ) : sent ? (
            <div className="auth-sent">
              <span className="success-symbol">
                <Icon name="mail" size={32} />
              </span>
              <h3>{t("Проверьте почту", "Check your inbox")}</h3>
              <button
                className="button secondary wide"
                onClick={() => {
                  setSent(false);
                  setMode("login");
                }}
              >
                {t("Вернуться ко входу", "Back to sign in")}
              </button>
            </div>
          ) : (
            <>
              <p className="auth-intro">
                {entrance?.kind === "reset"
                  ? t(
                      "От 15 до 128 символов. Можно использовать пробелы.",
                      "Use 15–128 characters. Spaces are welcome.",
                    )
                  : mode === "register"
                    ? t(
                        "Друзья найдут вас по имени пользователя.",
                        "Your friends can find you by your username.",
                      )
                    : mode === "forgot"
                      ? t(
                          "Пришлём ссылку на вашу почту.",
                          "We’ll email you a recovery link.",
                        )
                      : t(
                          "Войдите, чтобы играть с друзьями.",
                          "Sign in to play with friends.",
                        )}
              </p>
              <form onSubmit={(event) => void submit(event)}>
                {!entrance && (
                  <label>
                    {t("Почта", "Email")}
                    <input
                      type="email"
                      name="email"
                      autoComplete="email"
                      required
                      maxLength={254}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                    />
                  </label>
                )}
                {mode === "register" && !entrance && (
                  <>
                    <label>
                      {t("Имя пользователя", "Username")}
                      <div className="input-prefix">
                        <span>@</span>
                        <input
                          name="handle"
                          autoComplete="username"
                          pattern="[A-Za-z0-9_]{3,24}"
                          required
                          minLength={3}
                          maxLength={24}
                          value={handle}
                          onChange={(e) =>
                            setHandle(e.target.value.toLowerCase())
                          }
                          placeholder="your_name"
                        />
                      </div>
                      <small>
                        {t(
                          "3–24 латинских символа, цифры или _",
                          "3–24 letters, numbers or _",
                        )}
                      </small>
                    </label>
                    <label>
                      {t("Как вас называть", "Display name")}
                      <input
                        name="displayName"
                        autoComplete="nickname"
                        maxLength={40}
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder={t("Ваше имя", "Your name")}
                      />
                    </label>
                  </>
                )}
                {(mode !== "forgot" || entrance?.kind === "reset") && (
                  <label>
                    {t("Пароль", "Password")}
                    <input
                      type="password"
                      name="password"
                      autoComplete={
                        mode === "register" || entrance?.kind === "reset"
                          ? "new-password"
                          : "current-password"
                      }
                      required
                      maxLength={512}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    {mode === "register" && (
                      <small>
                        {t(
                          "Не менее 15 символов. Подойдёт длинная фраза.",
                          "At least 15 characters. A long phrase works well.",
                        )}
                      </small>
                    )}
                  </label>
                )}
                <button
                  className="button primary wide"
                  disabled={busy}
                  type="submit"
                >
                  {busy
                    ? t("Подождите…", "Please wait…")
                    : entrance?.kind === "reset"
                      ? t("Сохранить пароль", "Save password")
                      : mode === "register"
                        ? t("Создать аккаунт", "Create account")
                        : mode === "forgot"
                          ? t("Отправить ссылку", "Send recovery link")
                          : t("Войти", "Sign in")}
                </button>
              </form>
              {!entrance && (
                <div className="auth-alternatives">
                  {mode === "login" && (
                    <button
                      className="text-button"
                      onClick={() => setMode("forgot")}
                    >
                      {t("Забыли пароль?", "Forgot password?")}
                    </button>
                  )}
                  <div className="auth-switch">
                    {mode === "login"
                      ? t("Первый раз здесь?", "First time here?")
                      : t("Уже есть аккаунт?", "Already have an account?")}{" "}
                    <button
                      className="text-button"
                      onClick={() =>
                        setMode(mode === "login" ? "register" : "login")
                      }
                    >
                      {mode === "login"
                        ? t("Зарегистрироваться", "Create one")
                        : t("Войти", "Sign in")}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {entrance && (
            <div className="auth-alternatives">
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  clearEntrance();
                  setPassword("");
                  setMode("login");
                }}
              >
                {t("Вернуться на сайт", "Back to the site")}
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
