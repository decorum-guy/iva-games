import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("portal session and retry transport", () => {
  it("creates one anonymous session when two components start together", async () => {
    let respond!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { getSession } = await import("./api");
    const first = getSession();
    const second = getSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    respond(Response.json({ user: null, csrfToken: "one-session" }));
    expect(await first).toEqual(await second);
  });

  it("reuses the mutation key after a lost response and retires it after acknowledgement", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ user: null, csrfToken: "csrf-token" }),
      )
      .mockRejectedValueOnce(new TypeError("connection closed after commit"))
      .mockResolvedValueOnce(Response.json({ room: { roomId: "saved-room" } }))
      .mockResolvedValueOnce(Response.json({ room: { roomId: "new-room" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { getSession, request } = await import("./api");
    await getSession();
    const body = { gameId: "platform-lab", capacity: 2 };
    await expect(request("/rooms", body)).rejects.toMatchObject({
      code: "NETWORK",
    });
    expect(await request("/rooms", body)).toEqual({
      room: { roomId: "saved-room" },
    });
    await request("/rooms", body);
    const headers = [1, 2, 3].map(
      (index) =>
        (fetchMock.mock.calls[index][1] as RequestInit).headers as Record<
          string,
          string
        >,
    );
    expect(headers[0]["X-CSRF-Token"]).toBe("csrf-token");
    expect(headers[1]["Idempotency-Key"]).toBe(headers[0]["Idempotency-Key"]);
    expect(headers[2]["Idempotency-Key"]).not.toBe(
      headers[0]["Idempotency-Key"],
    );
  });

  it("retains the mutation key after an unreadable successful response or server error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ user: null, csrfToken: "csrf-token" }),
      )
      .mockResolvedValueOnce(new Response("truncated", { status: 200 }))
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: "INTERNAL_ERROR", message: "Try again" } },
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { getSession, request } = await import("./api");
    await getSession();
    await expect(
      request("/rooms/one/ready", { ready: true }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(
      request("/rooms/one/ready", { ready: true }),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    await request("/rooms/one/ready", { ready: true });
    const keys = [1, 2, 3].map(
      (index) =>
        (
          (fetchMock.mock.calls[index][1] as RequestInit).headers as Record<
            string,
            string
          >
        )["Idempotency-Key"],
    );
    expect(new Set(keys).size).toBe(1);
  });
});
