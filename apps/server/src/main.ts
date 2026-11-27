import { resolve } from 'node:path'
import { parseTrustedProxyIps } from '@iva-games/session-kit/http'
import { createOnlineServer } from './http'

function positive(value: string | undefined, fallback: number) {
  const number = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error('Invalid server number setting')
  return number
}

const publicOrigin = process.env.PUBLIC_ORIGIN
if (process.env.NODE_ENV === 'production' && !publicOrigin) throw new Error('PUBLIC_ORIGIN is required in production')
const app = createOnlineServer({
  databasePath: resolve(process.env.DATABASE_PATH ?? 'data/remorse.sqlite'),
  overdriveDatabasePath: process.env.OVERDRIVE_DATABASE_PATH ? resolve(process.env.OVERDRIVE_DATABASE_PATH) : undefined,
  staticDir: resolve(process.env.STATIC_DIR ?? 'dist'),
  publicOrigin,
  trustedProxyIps: parseTrustedProxyIps(process.env.TRUSTED_PROXY_IPS),
  allowedOrigins: process.env.DEV_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean),
  inactiveMs: positive(process.env.ROOM_INACTIVE_MS, 86_400_000),
  finishedMs: positive(process.env.FINISHED_ROOM_MS, 7 * 86_400_000),
})
const address = await app.listen(positive(process.env.PORT, 4173), process.env.HOST ?? '0.0.0.0')
console.log('REMORSE HTTP/WebSocket listening on ' + address.host + ':' + address.port)
let stopping = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  if (stopping) return
  stopping = true
  const deadline = setTimeout(() => {
    console.error('Chess shutdown exceeded 30s; durable state retained for recovery.')
    process.exit(1)
  }, 30_000)
  void app.close().then(() => {
    clearTimeout(deadline); process.exit(0)
  }, () => {
    clearTimeout(deadline)
    console.error('Chess shutdown failed; durable state retained for recovery.')
    process.exit(1)
  })
})
