import { once } from 'node:events';
import { connect } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { createOnlineServer } from '../src/http';

it.each(['/api/guest', '/api/overdrive/guest'])('closes both chess stores after aborting an unfinished %s upload', async path => {
  const directory = await mkdtemp(join(tmpdir(), 'iva-chess-shutdown-'));
  const databasePath = join(directory, 'remorse.sqlite');
  const overdriveDatabasePath = join(directory, 'overdrive.sqlite');
  const app = createOnlineServer({ databasePath, overdriveDatabasePath, shutdownGraceMs: 25 });
  const address = await app.listen(0);
  const origin = `http://${address.host}:${address.port}`;
  const socket = connect(address.port, address.host);
  socket.on('error', () => {});
  try {
    await once(socket, 'connect');
    const accepted = once(app.server, 'request');
    socket.write(`POST ${path} HTTP/1.1\r\nHost: ${address.host}:${address.port}\r\nOrigin: ${origin}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{`);
    await accepted;
    const closing = app.close();
    expect(app.close()).toBe(closing);
    await closing;
    for (const path of [databasePath, overdriveDatabasePath]) {
      const saved = new Database(path);
      try {
        expect(saved.pragma('integrity_check', { simple: true })).toBe('ok');
        expect(saved.prepare('SELECT count(*) AS count FROM guests').get()).toEqual({ count: 0 });
      } finally { saved.close(); }
    }
  } finally { socket.destroy(); await app.close(); await rm(directory, { recursive: true, force: true }); }
}, 3_000);
