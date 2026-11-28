import { dirname, resolve } from 'node:path';
import { retainRuntimeArtifact } from './artifacts.js';
import { retainClientContent } from './content.js';
import { createRealtimeServer, trustedKeysFromFile } from './server.js';
import { capacityProfileFromFile } from './capacity.js';
process.umask(0o077);
const port = Number(process.env.REALTIME_PORT ?? 4331), host = process.env.REALTIME_HOST ?? '127.0.0.1';
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid realtime port');
const databasePath = resolve(process.env.REALTIME_DATABASE_PATH ?? '.runtime/forpost-realtime.sqlite');
const artifactDirectory = resolve(dirname(databasePath), 'artifacts');
const artifact = retainRuntimeArtifact(new URL('./', import.meta.url), artifactDirectory);
const contentDirectory = resolve(dirname(databasePath), 'content');
const client = retainClientContent(resolve(process.env.REALTIME_STATIC_DIRECTORY ?? 'games/forpost/dist'), contentDirectory);
const app = createRealtimeServer({
  databasePath,
  signingKeyPath: resolve(process.env.REALTIME_PRACTICE_KEY_PATH ?? '.runtime/forpost-practice-key.pem'),
  trustedKeys: trustedKeysFromFile(process.env.REALTIME_TRUSTED_KEYS_PATH),
  publicOrigin: process.env.REALTIME_PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`,
  staticDirectory: client.directory,
  contentId: client.contentId,
  contentDirectory,
  maxRooms: Number(process.env.REALTIME_MAX_ROOMS ?? 4),
  capacityProfile: capacityProfileFromFile(process.env.REALTIME_CAPACITY_PROFILE_PATH, artifact.artifactId),
  artifactId: artifact.artifactId,
  artifactDirectory,
  buildRevision: process.env.IVA_BUILD_SHA ?? 'unknown',
  workerDirectory: new URL('./', import.meta.url),
});
await app.runtime.ready;
app.server.listen(port, host, () => console.info(`Iva realtime listening on ${host}:${port}`));
let stopping = false;
const stop = () => {
  if (stopping) return; stopping = true;
  const deadline = setTimeout(() => process.exit(1), 30_000);
  void app.close().then(() => { clearTimeout(deadline); process.exit(0); }, () => { clearTimeout(deadline); process.exit(1); });
};
process.once('SIGTERM', stop); process.once('SIGINT', stop);
