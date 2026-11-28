import { cp, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it, vi } from 'vitest';
import { createServer, isRunnableDevEnvironment } from 'vite';
import type { HMRPayload, ViteDevServer } from 'vite';

interface RefreshRuntime {
  validateRefreshBoundaryAndEnqueueUpdate(id: string, before: Record<string, unknown>, after: Record<string, unknown>): string | undefined;
}

it.each([
  { file: 'Board2D.tsx', primaryExport: 'Board2D' },
  { file: 'PieceIcon.tsx', primaryExport: 'PieceIcon' },
] as const)('editing $file retains a React Refresh boundary and emits a self-accepted Vite update', async ({ file, primaryExport }) => {
  const gameRoot = fileURLToPath(new URL('../..', import.meta.url));
  const repoRoot = resolve(gameRoot, '../../..');
  // Vite's filesystem allowlist and watcher use physical paths, including on macOS.
  const root = await mkdtemp(join(await realpath(tmpdir()), 'iva-colossus-dev-hmr-'));
  let server: ViteDevServer | undefined;
  let socket: WebSocket | undefined;
  try {
    // Only this disposable source copy is edited. The running app, checkout and
    // configuration are never touched by the regression.
    await cp(join(gameRoot, 'src'), join(root, 'src'), { recursive: true });
    await cp(join(gameRoot, 'index.html'), join(root, 'index.html'));
    await symlink(join(repoRoot, 'node_modules'), join(root, 'node_modules'), 'dir');
    server = await createServer({
      configFile: join(gameRoot, 'vite.config.ts'), root, cacheDir: join(root, '.vite-cache'),
      server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [root, repoRoot] } },
    });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Vite did not open a TCP listener');
    const messages: HMRPayload[] = [];
    socket = new WebSocket(`ws://127.0.0.1:${address.port}/?token=${server.config.webSocketToken}`, 'vite-hmr');
    socket.addEventListener('message', event => messages.push(JSON.parse(String(event.data)) as HMRPayload));
    await expect.poll(() => messages.some(message => message.type === 'connected'), { timeout: 5000 }).toBe(true);

    const moduleUrl = `/src/ui/${file}`;
    const filename = join(root, moduleUrl.slice(1));
    const original = await readFile(filename, 'utf8');
    await server.transformRequest(moduleUrl);
    await expect.poll(() => server!.watcher.getWatched()[dirname(filename)]?.includes(file), { timeout: 5000 }).toBe(true);
    const environment = server.environments.ssr;
    if (!isRunnableDevEnvironment(environment)) throw new Error('Vite SSR module runner is unavailable');
    const before = await environment.runner.import<Record<string, unknown>>(`${moduleUrl}?fixture=before`);
    const firstUpdate = messages.length;
    await writeFile(filename, `${original}\n// A real source save that changes no gameplay.\n`);
    await expect.poll(() => messages.slice(firstUpdate).some(message => message.type === 'update'
      && message.updates.some(update => update.path === moduleUrl && update.acceptedPath === moduleUrl)), { timeout: 5000 }).toBe(true);
    const after = await environment.runner.import<Record<string, unknown>>(`${moduleUrl}?fixture=after`);
    expect(before[primaryExport]).toBeTypeOf('function');
    expect(after[primaryExport]).toBeTypeOf('function');
    expect(before[primaryExport]).not.toBe(after[primaryExport]);

    // Invoke the installed plugin's own validator on the actual freshly loaded
    // module exports. This is a Node dev-server check, not a rendered browser.
    vi.stubGlobal('window', {});
    const require = createRequire(import.meta.url);
    const refreshPath = join(dirname(require.resolve('@vitejs/plugin-react')), 'refresh-runtime.js');
    const runtime = await import(pathToFileURL(refreshPath).href) as RefreshRuntime;
    expect(runtime.validateRefreshBoundaryAndEnqueueUpdate(moduleUrl, before, after)).toBeUndefined();
    expect(messages.slice(firstUpdate).filter(message => message.type === 'full-reload' || message.type === 'error')).toEqual([]);
  } finally {
    socket?.close();
    await server?.close();
    vi.unstubAllGlobals();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
