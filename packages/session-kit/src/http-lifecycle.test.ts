import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { createHttpLifecycle } from './http-lifecycle';

it('drains an unfinished real HTTP upload without waiting for the request timeout', async () => {
  let aborted = false, committed = false, receivedBytes = 0;
  const server = createServer((request, response) => { void lifecycle.run(async () => {
    try {
      for await (const chunk of request) receivedBytes += Buffer.byteLength(chunk);
      committed = true;
      response.end('saved');
    } catch { aborted = true; }
  }); });
  const lifecycle = createHttpLifecycle(server, 25);
  server.requestTimeout = 60_000;
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const socket = connect((server.address() as AddressInfo).port, '127.0.0.1');
  socket.on('error', () => {});
  try {
    await once(socket, 'connect');
    const received = once(server, 'request');
    socket.write('POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\n{');
    await received;
    const closed = lifecycle.close();
    expect(lifecycle.close()).toBe(closed);
    await closed;
    expect(aborted).toBe(true);
    expect(committed).toBe(false);
    expect(receivedBytes).toBe(1);
  } finally { socket.destroy(); await lifecycle.close(); }
}, 2_000);

it('waits for accepted application work even after its HTTP socket is destroyed', async () => {
  let finish!: () => void, began!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const started = new Promise<void>(resolve => { began = resolve; });
  let persisted = false, drained = false;
  const server = createServer((_request, response) => { void lifecycle.run(async () => {
    began(); await pending;
    persisted = true;
    if (!response.destroyed) response.end('saved');
  }); });
  const lifecycle = createHttpLifecycle(server, 25);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const socket = connect((server.address() as AddressInfo).port, '127.0.0.1');
  socket.on('error', () => {});
  try {
    await once(socket, 'connect');
    socket.write('GET / HTTP/1.1\r\nHost: localhost\r\n\r\n');
    await started;
    const peerClosed = once(socket, 'close');
    const close = lifecycle.close().then(() => { drained = true; });
    await peerClosed;
    expect(drained).toBe(false);
    expect(persisted).toBe(false);
    finish(); await close;
    expect(persisted).toBe(true);
  } finally { finish(); socket.destroy(); await lifecycle.close(); }
}, 2_000);

it('allows an already accepted response to finish during its grace period', async () => {
  let finish!: () => void, began!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const started = new Promise<void>(resolve => { began = resolve; });
  const server = createServer((_request, response) => { void lifecycle.run(async () => {
    began(); await pending; response.end('saved');
  }); });
  const lifecycle = createHttpLifecycle(server, 1_000);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const reply = fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`).then(response => response.text());
    await started;
    const closed = lifecycle.close();
    expect(lifecycle.stopping).toBe(true);
    finish();
    expect(await reply).toBe('saved');
    await closed;
  } finally { finish(); await lifecycle.close(); }
});

it('closes a stalled download after its handler returned without waiting for the client to read', async () => {
  let reply: ServerResponse | undefined;
  const server = createServer((_request, response) => { void lifecycle.run(async () => {
    reply = response;
    response.end(Buffer.alloc(32 * 1024 * 1024));
  }); });
  const lifecycle = createHttpLifecycle(server, 25);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const socket = connect((server.address() as AddressInfo).port, '127.0.0.1');
  socket.on('error', () => {});
  try {
    const received = new Promise<void>(resolve => {
      socket.once('data', () => { socket.pause(); resolve(); });
    });
    socket.write('GET / HTTP/1.1\r\nHost: localhost\r\n\r\n');
    await received;
    expect(reply?.writableFinished).toBe(false);
    await lifecycle.close();
    expect(reply?.destroyed).toBe(true);
  } finally { socket.destroy(); await lifecycle.close(); }
}, 2_000);
