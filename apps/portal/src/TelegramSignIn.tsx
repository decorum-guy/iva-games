import { useState } from "react";
import type { FormEvent } from "react";
import type { Perform } from "./Auth";
import { request } from "./api";
import { useLanguage } from "./ui";

type Attempt = { attemptId: string; deepLink: string };

export function TelegramSignIn({ busy, perform, onAuthenticated }: {
  busy: boolean;
  perform: Perform;
  onAuthenticated: () => Promise<void>;
}) {
  const { lang, t } = useLanguage();
  const [attempt, setAttempt] = useState<Attempt>();
  const [code, setCode] = useState("");
  const [profileRequired, setProfileRequired] = useState(false);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const start = () => void perform(async () => {
    const next = await request<Attempt>("/auth/telegram/start", { locale: lang });
    setAttempt(next);
    setCode("");
    setProfileRequired(false);
  });
  const finish = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!attempt) return;
    void perform(async () => {
      const result = await request<{ profileRequired?: true }>("/auth/telegram/finish", {
        attemptId: attempt.attemptId,
        code,
        ...(profileRequired ? { handle, displayName: displayName.trim() || handle } : {}),
      });
      if (result.profileRequired) setProfileRequired(true);
      else {
        setCode("");
        await onAuthenticated();
      }
    });
  };
  if (!attempt) return (
    <div className="telegram-sign-in">
      <p>{t("Один код для регистрации и входа. Бот пришлёт его в личный чат.", "Use a code to sign up or sign in. The bot sends it in a private chat.")}</p>
      <button className="button primary wide" type="button" disabled={busy} onClick={start}>
        {t("Продолжить через Telegram", "Continue with Telegram")}
      </button>
    </div>
  );
  return (
    <div className="telegram-sign-in">
      {!profileRequired && (
        <>
          <p>{t("Откройте бота, нажмите «Старт» и введите код здесь.", "Open the bot, press Start, and enter the code here.")}</p>
          <a className="button secondary wide" href={attempt.deepLink} target="_blank" rel="noreferrer">
            {t("Открыть бота", "Open the bot")}
          </a>
        </>
      )}
      <form onSubmit={finish}>
        {profileRequired ? (
          <>
            <label>{t("Имя пользователя", "Username")}
              <input name="handle" autoComplete="username" placeholder="your_name" required
                pattern="[A-Za-z0-9_]{3,24}" minLength={3} maxLength={24}
                value={handle} onChange={event => setHandle(event.target.value.toLowerCase())} />
            </label>
            <label>{t("Как вас называть", "Display name")}
              <input name="displayName" autoComplete="nickname" maxLength={40}
                value={displayName} onChange={event => setDisplayName(event.target.value)} />
            </label>
          </>
        ) : (
          <label>{t("Код из Telegram", "Telegram code")}
            <input name="telegramCode" autoComplete="one-time-code" autoCapitalize="characters"
              spellCheck={false} required pattern="[A-Za-z2-7]{8}" maxLength={8}
              value={code} onChange={event => setCode(event.target.value.toUpperCase())} />
          </label>
        )}
        <button className="button primary wide" type="submit" disabled={busy}>
          {profileRequired ? t("Создать аккаунт", "Create account") : t("Подтвердить код", "Confirm code")}
        </button>
      </form>
      <button className="text-button" type="button" disabled={busy} onClick={start}>
        {t("Запросить новый код", "Request another code")}
      </button>
    </div>
  );
}
