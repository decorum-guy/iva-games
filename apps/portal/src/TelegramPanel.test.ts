import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TelegramPanel } from "./TelegramPanel";
import type { TelegramStatus } from "./types";
import { LanguageContext } from "./ui";

function render(status: TelegramStatus, english = false, verified = true) {
  const perform = vi.fn();
  const html = renderToStaticMarkup(
    createElement(
      LanguageContext.Provider,
      {
        value: {
          lang: english ? "en" : "ru",
          t: (ru, en) => (english ? en : ru),
        },
      },
      createElement(TelegramPanel, {
        status,
        verified,
        busy: false,
        perform,
        onStatusChange: vi.fn(),
      }),
    ),
  );
  expect(perform).not.toHaveBeenCalled();
  return html;
}

describe("Telegram status rendering (static HTML, not browser acceptance)", () => {
  it("keeps unavailable and unverified states honest in both languages", () => {
    const disabled: TelegramStatus = {
      available: false,
      linked: false,
      reason: "not_configured",
    };
    expect(render(disabled)).toContain("Telegram пока недоступен");
    expect(render(disabled)).not.toContain("Подключить Telegram</button>");
    expect(render(disabled, true)).toContain(
      "Telegram is currently unavailable",
    );
    expect(render(disabled, false, false)).toContain("Подтвердите почту");
  });

  it("shows server-confirmed muted state and masked identity without numeric identifiers", () => {
    const linked: TelegramStatus = {
      available: true,
      linked: true,
      status: "active",
      notificationsEnabled: false,
      botUsername: "IvaTestBot",
      account: {
        displayNameMasked: "А••••",
        usernameMasked: "@a••••",
        userIdSuffix: "9876",
      },
    };
    const html = render(linked);
    expect(html).toContain("А••••");
    expect(html).toContain("@a••••");
    expect(html).not.toContain("9876");
    expect(html).toContain("Приглашения выключены");
    expect(html).toContain("Получать приглашения");
    expect(html).toContain("Отвязать");
  });

  it("offers reconnection, not an enable button, while the bot is unreachable", () => {
    const html = render(
      {
        available: true,
        linked: true,
        status: "unreachable",
        notificationsEnabled: false,
        botUsername: "IvaTestBot",
        account: null,
      },
      true,
    );
    expect(html).toContain("Bot unavailable");
    expect(html).toContain("Reconnect Telegram");
    expect(html).not.toContain("Receive invitations</button>");
  });
});
