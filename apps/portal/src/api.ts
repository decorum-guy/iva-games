import type { Session } from "./types";

export class PlatformError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
  ) {
    super(message);
    this.name = "PlatformError";
  }
}

let csrfToken = "";
let sessionRequest: Promise<Session> | null = null;
const retryKeys = new Map<string, string>();
export async function request<T>(path: string, body?: unknown): Promise<T> {
  const method = body === undefined ? "GET" : "POST";
  const signature = `${path}:${JSON.stringify(body)}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method === "POST") {
    if (!csrfToken)
      throw new PlatformError(
        "SESSION_REQUIRED",
        "Refresh the page and try again.",
      );
    headers["Content-Type"] = "application/json";
    headers["X-CSRF-Token"] = csrfToken;
    if (!retryKeys.has(signature))
      retryKeys.set(signature, crypto.randomUUID());
    headers["Idempotency-Key"] = retryKeys.get(signature)!;
  }
  let response: Response;
  try {
    response = await fetch(`/api/platform/v1${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers,
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new PlatformError(
      "NETWORK",
      "Connection interrupted. Retry the action.",
    );
  }
  const result = (await response.json().catch(() => null)) as
    | (T & { error?: { code?: string; message?: string } })
    | null;
  // A server failure or unreadable success can follow a committed mutation.
  // Keep the same key when the user retries that uncertain outcome.
  if (result !== null && response.status < 500) retryKeys.delete(signature);
  if (!response.ok)
    throw new PlatformError(
      result?.error?.code || "HTTP_ERROR",
      result?.error?.message || "Request failed.",
      response.status,
    );
  if (result === null)
    throw new PlatformError(
      "INVALID_RESPONSE",
      "The server returned an unreadable response.",
    );
  return result;
}

export function getSession(): Promise<Session> {
  // Multiple React mounts must not race to create different anonymous cookies.
  if (sessionRequest) return sessionRequest;
  sessionRequest = request<Session>("/session")
    .then((session) => {
      csrfToken = session.csrfToken;
      return session;
    })
    .finally(() => {
      sessionRequest = null;
    });
  return sessionRequest;
}
