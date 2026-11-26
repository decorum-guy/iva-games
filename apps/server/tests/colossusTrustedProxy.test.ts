import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createOnlineServer } from '../src/http';

const PUBLIC_ORIGIN = 'https://chess.iva-games.pro';
const apps: ReturnType<typeof createOnlineServer>[] = [];

async function server(trustedProxyIps: string[]) {
  const app = createOnlineServer({ databasePath: ':memory:', publicOrigin: PUBLIC_ORIGIN, trustedProxyIps });
  apps.push(app);
  const address = await app.listen(0, '127.0.0.1');
  return `http://127.0.0.1:${address.port}`;
}

function status(endpoint: string, client: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(endpoint + '/api/colossus/rooms/missing', {
      headers: { Origin: PUBLIC_ORIGIN, 'X-Iva-Client-IP': client, 'X-Forwarded-For': '203.0.113.250' },
    }, response => { response.resume(); response.once('end', () => resolve(response.statusCode!)); });
    req.once('error', reject);
    req.end();
  });
}

afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });

describe('Colossus HTTP rate limits behind the edge proxy', () => {
  it('separates trusted client budgets while retaining the exhausted client limit and guest authentication', async () => {
    const endpoint = await server(['127.0.0.1']);
    // These unauthenticated requests consume the actual IP budget before the
    // guest guard. They must never gain access to a cooperative room.
    for (let i = 0; i < 600; i++) expect(await status(endpoint, '198.51.100.10')).toBe(401);
    expect(await status(endpoint, '198.51.100.10')).toBe(429);
    expect(await status(endpoint, '198.51.100.11')).toBe(401);
    expect(await status(endpoint, '198.51.100.10')).toBe(429);
  });

  it('cannot refresh an untrusted socket budget by rotating supplied client addresses', async () => {
    const endpoint = await server(['192.0.2.20']);
    for (let i = 0; i < 600; i++) expect(await status(endpoint, `198.51.100.${i % 250 + 1}`)).toBe(401);
    expect(await status(endpoint, '203.0.113.12')).toBe(429);
    expect(await status(endpoint, '203.0.113.13')).toBe(429);
  });
});
