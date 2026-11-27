/** Server-only helpers. Do not re-export this entry from the browser-facing kit. */
import { isIP } from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';

export { createHttpLifecycle } from './http-lifecycle.js';

export const CLIENT_IP_HEADER = 'x-iva-client-ip';
interface AddressRequest {
  readonly headers: IncomingHttpHeaders;
  readonly socket: { readonly remoteAddress?: string };
}

function normalizedIp(value: string): string | null {
  const family = isIP(value);
  // Zone identifiers name an interface, not a portable client identity.
  if (!family || value.includes('%')) return null;
  if (family === 4) return value;
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const high = Number.parseInt(mapped[1], 16), low = Number.parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

/** Explicit socket peer IPs only: no hostnames, wildcard ranges or trust-all flag. */
export function parseTrustedProxyIps(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return [...new Set(value.split(',').map(item => {
    const ip = normalizedIp(item.trim());
    if (!ip) throw new Error('TRUSTED_PROXY_IPS must contain exact IPv4 or IPv6 addresses');
    return ip;
  }))];
}

/** The edge proxy must overwrite X-Iva-Client-IP from its TCP peer address.
 * A direct/untrusted peer cannot select its rate-limit identity using headers.
 * Missing, multiple and malformed values retain the socket identity. */
export function createClientAddressReader(trustedProxyIps: readonly string[] = []): (request: AddressRequest) => string {
  const trusted = new Set(parseTrustedProxyIps(trustedProxyIps.join(',')));
  return request => {
    const peer = normalizedIp(request.socket.remoteAddress ?? '') ?? request.socket.remoteAddress ?? 'unknown';
    if (!trusted.has(peer)) return peer;
    const supplied = request.headers[CLIENT_IP_HEADER];
    return typeof supplied === 'string' ? normalizedIp(supplied) ?? peer : peer;
  };
}
