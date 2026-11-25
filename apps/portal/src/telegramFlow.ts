import type { TelegramAttempt, TelegramAttemptState } from "./types";

export const TELEGRAM_ATTEMPT_STORAGE_KEY = "iva-games.telegram.attempt.v1";
export interface TelegramAttemptReference {
  attemptId: string;
  expiresAt: number;
}
type AttemptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function pendingTelegramState(state: TelegramAttemptState): boolean {
  return state === "issued" || state === "awaiting_web_confirmation";
}

export function telegramAttemptIsLive(
  attempt: TelegramAttemptReference,
  now: number,
): boolean {
  return Number.isFinite(attempt.expiresAt) && attempt.expiresAt > now;
}

export function normalizeTelegramProof(value: string): string {
  return value.trim().toUpperCase();
}

export function canConfirmTelegramAttempt(
  attempt: TelegramAttempt | null,
  proof: string,
  consent: boolean | null,
  now: number,
): boolean {
  return Boolean(
    attempt?.state === "awaiting_web_confirmation" &&
    attempt.candidate &&
    telegramAttemptIsLive(attempt, now) &&
    attempt.proofAttemptsRemaining > 0 &&
    typeof consent === "boolean" &&
    /^[A-Z2-7]{8}$/.test(normalizeTelegramProof(proof)),
  );
}

// An asynchronous GET may finish after cancel, confirm, or a new attempt.
// Invalidation happens before a mutation, not after its response arrives.
export function acceptTelegramSnapshot(
  current: TelegramAttempt | null,
  incoming: TelegramAttempt,
  requestedId: string,
  requestGeneration: number,
  currentGeneration: number,
): boolean {
  if (
    requestGeneration !== currentGeneration ||
    incoming.attemptId !== requestedId ||
    (current && current.attemptId !== requestedId)
  )
    return false;
  if (current && !pendingTelegramState(current.state))
    return incoming.state === current.state;
  if (
    current?.state === "awaiting_web_confirmation" &&
    incoming.state === "issued"
  )
    return false;
  return true;
}

// Only the configured bot's opaque Start URL may become an external link.
// It is never persisted or copied to another service by the client.
export function safeTelegramStartLink(
  value: string | null,
  botUsername: string,
): string | null {
  if (!value || !/^[A-Za-z0-9_]{5,32}$/.test(botUsername)) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "t.me" ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      url.pathname.toLowerCase() !== "/" + botUsername.toLowerCase() ||
      [...url.searchParams.keys()].length !== 1 ||
      !/^l1_[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("start") ?? "")
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

function tabStorage(): AttemptStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function clearTelegramAttempt(
  storage: AttemptStorage | null = tabStorage(),
): void {
  try {
    storage?.removeItem(TELEGRAM_ATTEMPT_STORAGE_KEY);
  } catch {
    // Private browsing may disable storage; linking still works in memory.
  }
}

export function restoreTelegramAttempt(
  now: number,
  storage: AttemptStorage | null = tabStorage(),
): TelegramAttemptReference | null {
  try {
    const saved = storage?.getItem(TELEGRAM_ATTEMPT_STORAGE_KEY);
    if (!saved) return null;
    const value: unknown = JSON.parse(saved);
    if (
      typeof value !== "object" ||
      value === null ||
      !("attemptId" in value) ||
      !("expiresAt" in value) ||
      typeof value.attemptId !== "string" ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(value.attemptId) ||
      typeof value.expiresAt !== "number" ||
      !telegramAttemptIsLive(
        { attemptId: value.attemptId, expiresAt: value.expiresAt },
        now,
      )
    ) {
      clearTelegramAttempt(storage);
      return null;
    }
    // Deliberately discard any additional data left by an older client.
    return { attemptId: value.attemptId, expiresAt: value.expiresAt };
  } catch {
    clearTelegramAttempt(storage);
    return null;
  }
}

export function rememberTelegramAttempt(
  attempt: TelegramAttempt,
  storage: AttemptStorage | null = tabStorage(),
): void {
  if (!pendingTelegramState(attempt.state)) {
    clearTelegramAttempt(storage);
    return;
  }
  try {
    storage?.setItem(
      TELEGRAM_ATTEMPT_STORAGE_KEY,
      JSON.stringify({
        attemptId: attempt.attemptId,
        expiresAt: attempt.expiresAt,
      }),
    );
  } catch {
    // No token, proof code, identity or password is stored here.
  }
}
