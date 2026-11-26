import { request } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createOnlineServer } from '../src/http'

const PUBLIC_ORIGIN = 'https://chess.iva-games.pro'
const apps: ReturnType<typeof createOnlineServer>[] = []

async function server(trustedProxyIps: string[]) {
  const app = createOnlineServer({ databasePath: ':memory:', publicOrigin: PUBLIC_ORIGIN, trustedProxyIps })
  apps.push(app)
  const address = await app.listen(0, '127.0.0.1')
  return `http://127.0.0.1:${address.port}`
}

function status(endpoint: string, path: string, client: string, upgrade = false): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(endpoint + path, {
      headers: {
        Origin: PUBLIC_ORIGIN, 'X-Iva-Client-IP': client, 'X-Forwarded-For': '203.0.113.250',
        ...(upgrade ? { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' } : {}),
      },
    }, response => { response.resume(); response.once('end', () => resolve(response.statusCode!)) })
    req.once('error', reject)
    req.once('upgrade', (_response, socket) => { socket.destroy(); reject(new Error('Missing guest must never upgrade')) })
    req.end()
  })
}

afterEach(async () => { for (const app of apps.splice(0)) await app.close() })

describe('chess HTTP and WebSocket limits behind the edge proxy', () => {
  it.each(['/api/rooms/missing', '/api/overdrive/rooms/missing'])('uses each trusted client address for %s', async path => {
    const endpoint = await server(['127.0.0.1'])
    // Authentication still rejects the calls; rate limiting happens before it.
    for (let i = 0; i < 180; i++) expect(await status(endpoint, path, '198.51.100.10')).toBe(401)
    expect(await status(endpoint, path, '198.51.100.10')).toBe(429)
    expect(await status(endpoint, path, '198.51.100.11')).toBe(401)
  })

  it.each(['/ws', '/overdrive-online'])('keeps upgrade budgets independent for %s', async path => {
    const endpoint = await server(['127.0.0.1'])
    for (let i = 0; i < 60; i++) expect(await status(endpoint, path, '198.51.100.10', true)).toBe(401)
    expect(await status(endpoint, path, '198.51.100.10', true)).toBe(429)
    expect(await status(endpoint, path, '198.51.100.11', true)).toBe(401)
  })

  it('ignores changing supplied addresses when the socket is not trusted', async () => {
    const endpoint = await server(['192.0.2.20'])
    for (let i = 0; i < 60; i++) expect(await status(endpoint, '/ws', `198.51.100.${i + 1}`, true)).toBe(401)
    expect(await status(endpoint, '/ws', '203.0.113.12', true)).toBe(429)
  })
})
