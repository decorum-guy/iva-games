import { describe, expect, it } from "vitest";
import {
  acceptTelegramSnapshot,
  canConfirmTelegramAttempt,
  clearTelegramAttempt,
  rememberTelegramAttempt,
  restoreTelegramAttempt,
  safeTelegramStartLink,
  TELEGRAM_ATTEMPT_STORAGE_KEY,
  telegramAttemptIsLive,
} from "./telegramFlow";
import type { TelegramAttempt } from "./types";

// Isolated fixtures: these identifiers, codes and links never contact Telegram.
const now = 1_800_000_000_000;
const attempt: TelegramAttempt = {
  attemptId: "attempt-fixture-1",
  state: "awaiting_web_confirmation",
  expiresAt: now + 60_000,
  candidate: {
    displayNameMasked: "А••••",
    usernameMasked: "@a••••",
    userIdSuffix: "0001",
  },
  proofAttemptsRemaining: 5,
};
function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
}

describe("Telegram confirmation boundaries", () => {
  it("requires an explicit consent choice and permits linking with delivery off", () => {
    expect(canConfirmTelegramAttempt(attempt, "ABCD2345", null, now)).toBe(
      false,
    );
    expect(canConfirmTelegramAttempt(attempt, "ABCD2345", false, now)).toBe(
      true,
    );
    expect(canConfirmTelegramAttempt(attempt, " abcd2345 ", true, now)).toBe(
      true,
    );
    expect(canConfirmTelegramAttempt(attempt, "12345678", true, now)).toBe(
      false,
    );
    expect(canConfirmTelegramAttempt(attempt, "", false, now)).toBe(false);
  });

  it("never treats Start, a closed attempt or a local timeout as permission to confirm", () => {
    for (const state of [
      "issued",
      "confirmed",
      "cancelled",
      "rejected",
      "expired",
    ] as const) {
      expect(
        canConfirmTelegramAttempt({ ...attempt, state }, "ABCD2345", true, now),
      ).toBe(false);
    }
    expect(
      canConfirmTelegramAttempt(
        { ...attempt, candidate: null },
        "ABCD2345",
        true,
        now,
      ),
    ).toBe(false);
    expect(
      canConfirmTelegramAttempt(
        { ...attempt, proofAttemptsRemaining: 0 },
        "ABCD2345",
        true,
        now,
      ),
    ).toBe(false);
    expect(
      canConfirmTelegramAttempt(attempt, "ABCD2345", true, attempt.expiresAt),
    ).toBe(false);
    expect(telegramAttemptIsLive(attempt, attempt.expiresAt)).toBe(false);
    expect(
      telegramAttemptIsLive({ ...attempt, expiresAt: Number.NaN }, now),
    ).toBe(false);
  });

  it("rejects late GETs after confirm, cancellation and starting a replacement", () => {
    // The request started in generation 4; the user then submitted a mutation.
    expect(
      acceptTelegramSnapshot(attempt, attempt, attempt.attemptId, 4, 5),
    ).toBe(false);
    for (const state of ["confirmed", "cancelled"] as const) {
      expect(
        acceptTelegramSnapshot(
          { ...attempt, state },
          attempt,
          attempt.attemptId,
          5,
          5,
        ),
      ).toBe(false);
    }
    const newer = {
      ...attempt,
      attemptId: "attempt-fixture-2",
      state: "issued" as const,
    };
    expect(
      acceptTelegramSnapshot(newer, attempt, attempt.attemptId, 5, 5),
    ).toBe(false);
    expect(
      acceptTelegramSnapshot(
        attempt,
        { ...attempt, state: "issued" },
        attempt.attemptId,
        5,
        5,
      ),
    ).toBe(false);
    expect(
      acceptTelegramSnapshot(
        { ...attempt, state: "issued" },
        attempt,
        attempt.attemptId,
        5,
        5,
      ),
    ).toBe(true);
  });
});

describe("Telegram attempt recovery and link privacy", () => {
  it("persists only an opaque reference, expires it, and removes it on logout/terminal state", () => {
    const storage = memoryStorage();
    const withSecrets = {
      ...attempt,
      deepLink: "not-to-be-persisted",
      proofCode: "ABCD2345",
    };
    rememberTelegramAttempt(withSecrets, storage);
    expect(JSON.parse(storage.getItem(TELEGRAM_ATTEMPT_STORAGE_KEY)!)).toEqual({
      attemptId: attempt.attemptId,
      expiresAt: attempt.expiresAt,
    });
    expect(restoreTelegramAttempt(now, storage)).toEqual({
      attemptId: attempt.attemptId,
      expiresAt: attempt.expiresAt,
    });
    expect(restoreTelegramAttempt(attempt.expiresAt, storage)).toBeNull();
    expect(storage.getItem(TELEGRAM_ATTEMPT_STORAGE_KEY)).toBeNull();
    rememberTelegramAttempt(attempt, storage);
    clearTelegramAttempt(storage);
    expect(restoreTelegramAttempt(now, storage)).toBeNull();
    rememberTelegramAttempt({ ...attempt, state: "confirmed" }, storage);
    expect(restoreTelegramAttempt(now, storage)).toBeNull();
  });

  it("does not recover malformed references or fail when tab storage is disabled", () => {
    const storage = memoryStorage();
    storage.setItem(TELEGRAM_ATTEMPT_STORAGE_KEY, "{broken");
    expect(restoreTelegramAttempt(now, storage)).toBeNull();
    storage.setItem(
      TELEGRAM_ATTEMPT_STORAGE_KEY,
      JSON.stringify({ attemptId: "../other", expiresAt: now + 5000 }),
    );
    expect(restoreTelegramAttempt(now, storage)).toBeNull();
    const disabled = {
      getItem() {
        throw new Error("storage disabled");
      },
      setItem() {
        throw new Error("storage disabled");
      },
      removeItem() {
        throw new Error("storage disabled");
      },
    };
    expect(restoreTelegramAttempt(now, disabled)).toBeNull();
    expect(() => rememberTelegramAttempt(attempt, disabled)).not.toThrow();
    expect(() => clearTelegramAttempt(disabled)).not.toThrow();
  });

  it("opens only the configured bot's HTTPS Start link, with no extra query payload", () => {
    const payload = "l1_" + "A".repeat(43);
    const valid = "https://t.me/IvaTestBot?start=" + payload;
    expect(safeTelegramStartLink(valid, "IvaTestBot")).toBe(valid);
    for (const invalid of [
      "javascript:alert(1)",
      "http://t.me/IvaTestBot?start=" + payload,
      "https://t.me.evil.example/IvaTestBot?start=" + payload,
      "https://t.me/OtherTestBot?start=" + payload,
      "https://someone@t.me/IvaTestBot?start=" + payload,
      valid + "&email=private",
      valid + "&start=" + payload,
      valid + "#private",
      "https://t.me/IvaTestBot?start=invalid",
    ]) {
      expect(safeTelegramStartLink(invalid, "IvaTestBot")).toBeNull();
    }
  });
});
