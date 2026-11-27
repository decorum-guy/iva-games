/**
 * Technical audio integration through real HTTP/SQLite and native Web Audio.
 * Run after npm run build:portal. Uses an isolated copy of that build.
 * Audio is muted at the headless browser output: this is NOT auditory acceptance.
 * Observers call the original native methods; no game responses or audio buffers are mocked.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import { createFeedbackHarness } from './district-feedback-fixtures.mjs';

const harness = await createFeedbackHarness();
const artifacts = join(harness.directory, 'audio-browser');
await mkdir(artifacts);
const checks = [], errors = [], requests = [], snapshots = [], traces = [];
const assetReads = [], servedAssets = new Map();
const result = { technicalOnly: true, audioListened: false, outputMuted: true, realHttp: true,
  realSqlite: true, mockedGameApi: false, nativePlaybackReplaced: false, syntheticPositions: true,
  gitHead: harness.manifest.gitHead, sourceHasWorkingChanges: !!harness.manifest.gitStatus,
  buildHashes: harness.manifest.buildHashes, checks };
let browser, context, page;
const stock = values => ({ wood: 0, brick: 0, grain: 0, wool: 0, ore: 0, ...values });
const view = async (entry, index = entry.hostIndex) => (await harness.clients[index].request(`/rooms/${entry.roomId}/match`)).view;
async function post(entry, index, payload) {
  const before = await view(entry, index);
  return (await harness.clients[index].request(`/rooms/${entry.roomId}/actions`, {
    actionId: randomUUID(), expectedRevision: before.revision, payload: { ...payload, phaseId: before.phaseId },
  })).view;
}
function passed(name, details = {}) { checks.push({ name, ...details }); console.log(JSON.stringify({ passed: name, ...details })); }

// All wrappers below invoke the unmodified native implementation, with the same
// arguments. Weak maps only associate the fetched file with its decoded buffer.
function installNativeAudioObservers() {
  if (!['http:', 'https:'].includes(location.protocol)) return;
  localStorage.setItem('iva.portal.language', 'en');
  const probe = window.__districtAudioProbe = { events: [], active: 0, phase: 'application', sequence: 0 };
  const bytesUrls = new WeakMap(), bufferUrls = new WeakMap(), connected = new WeakMap();
  const contexts = new WeakMap(); let nextContext = 0;
  const contextId = audio => {
    if (!contexts.has(audio)) contexts.set(audio, ++nextContext);
    return contexts.get(audio);
  };
  const record = value => probe.events.push({ ...value, at: Date.now(), elapsed: performance.now(), phase: probe.phase });
  const arrayBuffer = Response.prototype.arrayBuffer;
  Response.prototype.arrayBuffer = function (...args) {
    const url = this.url;
    return arrayBuffer.apply(this, args).then(bytes => { bytesUrls.set(bytes, url); return bytes; });
  };
  const decode = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = function (bytes, ...rest) {
    const url = bytesUrls.get(bytes);
    return decode.call(this, bytes, ...rest).then(buffer => {
      bufferUrls.set(buffer, url);
      record({ kind: 'decode', url, context: contextId(this), state: this.state,
        duration: buffer.duration, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels });
      return buffer;
    });
  };
  const resume = AudioContext.prototype.resume;
  AudioContext.prototype.resume = function (...args) {
    return resume.apply(this, args).then(value => {
      record({ kind: 'resume', context: contextId(this), state: this.state }); return value;
    });
  };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (...args) {
    const value = connect.apply(this, args); connected.set(this, args[0]); return value;
  };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    const value = start.apply(this, args), id = ++probe.sequence;
    const url = bufferUrls.get(this.buffer), target = connected.get(this);
    probe.active++;
    record({ kind: 'start', id, url, cue: url?.split('/').at(-1)?.replace(/\.wav$/, ''),
      context: contextId(this.context), state: this.context.state, duration: this.buffer?.duration,
      gain: target instanceof GainNode ? target.gain.value : null });
    this.addEventListener('ended', () => { probe.active--; record({ kind: 'ended', id, url }); }, { once: true });
    return value;
  };
  const stop = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.stop = function (...args) {
    const value = stop.apply(this, args); record({ kind: 'stop', url: bufferUrls.get(this.buffer) }); return value;
  };
}
const starts = () => page.evaluate(() => window.__districtAudioProbe.events.filter(item => item.kind === 'start'));
const count = async () => (await starts()).length;
async function idle() {
  await expect.poll(() => page.evaluate(() => window.__districtAudioProbe.active), { timeout: 6_000 }).toBe(0);
}
async function archive(label) {
  if (!page?.url().startsWith(harness.origin)) return;
  traces.push({ label, url: page.url(), probe: await page.evaluate(() => window.__districtAudioProbe) });
}
async function expectCue(cue, since) {
  await expect.poll(async () => (await starts()).slice(since).map(item => item.cue), { timeout: 7_000 }).toContain(cue);
  const events = (await starts()).slice(since);
  assert.ok(events.every(item => item.state === 'running' && item.gain > 0), 'Native source must be running with a nonzero real gain');
  return events;
}
async function observeRevision(entry, revision) {
  await expect.poll(() => snapshots.some(item => item.roomId === entry.roomId && item.revision >= revision), { timeout: 6_000 }).toBe(true);
  // Response arrival precedes React's effects. Allow the browser to paint twice.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function closeNews() {
  const close = page.getByRole('button', { name: 'Dismiss news', exact: true });
  if (await close.isVisible()) await close.click();
}
async function settings() { await closeNews(); await page.getByRole('button', { name: 'Settings', exact: true }).click(); }
async function closeSettings() { await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click(); }
async function open(id, index) {
  await archive('before-' + id);
  await page.goto('about:blank');
  const entry = await harness.reset(id);
  if (index !== undefined && index !== 0) throw new Error('This runner observes account 0; use its role in the fixture');
  await page.goto(entry.url);
  await expect(page.locator('.territorial-board')).toBeVisible();
  await observeRevision(entry, entry.expected.revision);
  return entry;
}
async function action(button) {
  const response = page.waitForResponse(response => response.request().method() === 'POST' && /\/rooms\/[^/]+\/actions$/.test(new URL(response.url()).pathname));
  await button.click();
  const received = await response, data = await received.json();
  assert.equal(received.status(), 200, JSON.stringify(data)); return data.view;
}
async function select(kind, id) {
  const target = page.locator(`[data-board-target="${kind}:${id}"]`);
  await target.focus(); await target.press('Enter');
}
async function playRoll(entry, index) {
  let next = await post(entry, index, { type: 'roll' });
  if (next.phase === 'discard') {
    for (const playerIndex of [0, 1]) {
      const own = await view(entry, playerIndex);
      if (!own.you.discard) continue;
      let remainder = own.you.discard; const resources = stock();
      for (const resource of ['wood', 'brick', 'grain', 'wool', 'ore']) {
        resources[resource] = Math.min(remainder, own.you.hand[resource]); remainder -= resources[resource];
      }
      await post(entry, playerIndex, { type: 'discard', resources });
    }
  }
  next = await view(entry, index);
  if (next.phase === 'block') {
    const block = next.legal.block[0];
    next = await post(entry, index, { type: 'block', tileId: block.tileId,
      ...(block.targets[0] ? { targetId: block.targets[0] } : {}) });
  }
  assert.equal(next.phase, 'play'); return next;
}

try {
  let launch = { headless: true, args: ['--mute-audio'] };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
    launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
    launch.args.push(...JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS ?? '[]'));
  } else {
    const path = join(process.cwd(), '.qa/browser-runtime/node_modules/@sparticuz/chromium/build/index.js');
    if (existsSync(path)) {
      const runtime = (await import(pathToFileURL(path).href)).default;
      launch = { ...launch, executablePath: await runtime.executablePath(), args: [...runtime.args, '--mute-audio'] };
    }
  }
  launch.args = launch.args.filter(value => !value.includes('disable-web-security') && !value.includes('allow-running-insecure-content') && !value.includes('single-process'));
  browser = await chromium.launch(launch); result.browserVersion = browser.version();
  context = await browser.newContext({ storageState: harness.manifest.accounts[0].storageState, viewport: { width: 1440, height: 900 } });
  await context.addInitScript(installNativeAudioObservers);
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  page.on('response', async response => {
    const url = new URL(response.url());
    if (url.origin === harness.origin && url.pathname.startsWith('/assets/') && /\.(js|css)$/.test(url.pathname)) {
      assetReads.push(response.body().then(bytes => {
        servedAssets.set(url.pathname, { path: url.pathname, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      }).catch(error => { errors.push('Asset body observation failed: ' + url.pathname + ' ' + String(error)); }));
    }
    if (url.pathname.startsWith('/assets/district/audio/')) requests.push({ path: url.pathname, origin: url.origin,
      status: response.status(), mime: response.headers()['content-type'] });
    const room = url.pathname.match(/\/rooms\/([^/]+)\/(?:match|actions)$/);
    if (room && response.ok()) {
      try { const data = await response.json(); if (data.view) snapshots.push({ roomId: room[1], revision: data.view.revision,
        serverNow: data.view.serverNow, at: Date.now() }); } catch { /* A navigation can close an already received response body. */ }
    }
  });

  // This fixture belongs to account 0. Start with the actual default, disabled.
  let entry = await open('coupon-free');
  assert.equal(entry.hostIndex, 0); assert.equal(await count(), 0);
  await settings();
  await expect(page.getByRole('dialog').getByLabel('Game sound', { exact: false })).not.toBeChecked();
  await page.getByRole('button', { name: 'Test sound', exact: true }).click();
  assert.equal(await count(), 0);
  await page.getByRole('dialog').getByLabel('Game sound', { exact: false }).check();
  await page.getByRole('button', { name: 'Test sound', exact: true }).click();
  await expectCue('house', 0);
  // Muting during this real 460ms sample must stop it, not merely prevent future events.
  await page.getByRole('dialog').getByLabel('Game sound', { exact: false }).uncheck();
  await expect.poll(() => page.evaluate(() => window.__districtAudioProbe.events.filter(item => item.kind === 'stop').length)).toBeGreaterThan(0);
  await idle();
  await page.getByRole('dialog').getByLabel('Game sound', { exact: false }).check();
  await closeSettings();
  passed('Settings unlocks native AudioContext; disabled preview stays silent; mute stops a playing source');

  // Decode every delivered WAV in Chromium, retaining original bytes and hashes.
  const manifest = JSON.parse(await readFile(join(harness.directory, 'portal/assets/district/audio/manifest.json'), 'utf8'));
  result.decodedClips = await page.evaluate(async clips => {
    const audio = new AudioContext(), decoded = [];
    window.__districtAudioProbe.phase = 'all-files-decode-only';
    try {
      for (const clip of clips) {
        const response = await fetch('/assets/district/audio/' + clip.path);
        if (!response.ok || response.headers.get('content-type') !== 'audio/wav') throw new Error('Invalid WAV response: ' + clip.id);
        const bytes = await response.arrayBuffer();
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
        if (digest !== clip.sha256) throw new Error('Audio bytes differ from manifest: ' + clip.id);
        const buffer = await audio.decodeAudioData(bytes);
        if (Math.abs(buffer.duration - clip.seconds) > .005 || buffer.numberOfChannels !== clip.channels) throw new Error('Decode metadata differs: ' + clip.id);
        decoded.push({ id: clip.id, duration: buffer.duration, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, sha256: digest });
      }
    } finally { await audio.close(); window.__districtAudioProbe.phase = 'application'; }
    return decoded;
  }, manifest.clips);
  assert.equal(result.decodedClips.length, 56);
  passed('All 56 delivered WAV files match manifest SHA-256 and decode with native Web Audio', { count: result.decodedClips.length });

  let before = await count();
  await select('edge', entry.expected.land);
  await action(page.getByRole('button', { name: 'Build road', exact: true }));
  await expectCue('road', before); await idle();
  before = await count();
  await select('node', entry.expected.house);
  await action(page.getByRole('button', { name: 'Upgrade house', exact: true }));
  await expectCue('upgrade', before); await idle();
  passed('Real UI road and upgrade actions produce their distinct native cues');

  await settings(); await page.getByRole('dialog').getByLabel('Game sound', { exact: false }).uncheck(); await closeSettings();
  before = await count();
  let next = await post(entry, 0, { type: 'bank', give: 'wood', receive: 'grain' });
  await observeRevision(entry, next.revision); await delay(1_250);
  assert.equal(await count(), before);
  await settings(); await page.getByRole('dialog').getByLabel('Game sound', { exact: false }).check(); await closeSettings();
  await delay(1_250); assert.equal(await count(), before);
  next = await post(entry, 0, { type: 'bank', give: 'brick', receive: 'wool' });
  await observeRevision(entry, next.revision); await expectCue('trade', before); await idle();
  passed('Muted committed actions stay consumed after re-enable; a fresh bank exchange plays trade');

  entry = await open('trade-draft');
  await settings(); await closeSettings(); before = await count();
  const accepted = await post(entry, entry.guestIndex, { type: 'accept', offerId: entry.expected.offerId });
  await observeRevision(entry, accepted.revision); await expectCue('trade', before); await idle();
  assert.equal((await starts()).slice(before).filter(item => item.cue === 'trade').length, 1);
  passed('Accepted real player trade plays once, without an offer-closed duplicate');

  entry = await open('seven-discard');
  await settings(); await closeSettings(); before = await count();
  const rolled = await action(page.getByRole('button', { name: 'Roll dice', exact: true }));
  assert.equal(rolled.latestRoll.sum, 7); await expectCue('roll', before); await idle();
  passed('An actual seven through the game UI starts the roll cue', { dice: rolled.latestRoll.dice });

  entry = await open('epidemic-risk');
  await settings(); await closeSettings(); assert.equal(await count(), 0);
  // Advance actual game actions until the next published epidemic stage. No API interception.
  let current = await view(entry), steps = 0;
  const already = new Set(current.news.map(item => item.messageId));
  while (!current.news.some(item => item.templateId === 'E01' && !already.has(item.messageId))) {
    assert.ok(steps++ < 6, 'Expected an epidemic update within this synthetic position');
    const activeIndex = current.activeParticipantId === entry.expected.ownerId ? entry.hostIndex : entry.guestIndex;
    await post(entry, activeIndex, { type: 'end' });
    current = await playRoll(entry, 1 - activeIndex);
    await observeRevision(entry, current.revision);
    await delay(150);
  }
  const published = current.news.filter(item => item.templateId === 'E01' && !already.has(item.messageId));
  for (const message of published) await expectCue(`${message.templateId}-${message.stage}`, 0);
  await idle();
  before = await count();
  await closeNews(); await page.locator('.tn-journal-open').click();
  await page.locator('.tn-journal-group button').first().click(); await closeNews();
  await page.getByRole('button', { name: 'Turn history', exact: true }).click();
  await delay(1_250); assert.equal(await count(), before);
  passed('A newly published epidemic stage plays; reopening both journals and normal polling do not replay it', { stages: published.map(item => item.stage) });

  await archive('before-reload');
  await page.reload(); await expect(page.locator('.territorial-board')).toBeVisible();
  await settings(); await closeSettings(); await delay(1_250);
  assert.equal(await count(), 0);
  passed('Reload, persisted enabled preference and a new gesture do not replay old actions or news');

  // Actual browser network loss triggers the app's offline/online listeners. The
  // other authenticated HTTP client makes one legal action while this tab is away.
  await context.setOffline(true);
  const incomingAuthor = 1;
  const authorView = await view(entry, incomingAuthor);
  const give = Object.keys(authorView.you.hand).find(resource => authorView.you.hand[resource] > 0);
  assert.ok(give, 'Expected a funded offer in the synthetic position');
  const receive = give === 'wood' ? 'brick' : 'wood';
  next = await post(entry, incomingAuthor, { type: 'offer', targetId: authorView.players.find(item => item.participantId !== authorView.you.participantId).participantId,
    give: stock({ [give]: 1 }), receive: stock({ [receive]: 1 }) });
  await delay(150); await context.setOffline(false);
  await observeRevision(entry, next.revision); await delay(1_250);
  assert.equal(await count(), 0);
  passed('Real offline/online reconnect silently baselines an action committed while disconnected');
  next = await post(entry, incomingAuthor, { type: 'offer', targetId: authorView.players.find(item => item.participantId !== authorView.you.participantId).participantId,
    give: stock({ [give]: 1 }), receive: stock({ [receive]: 1 }) });
  await observeRevision(entry, next.revision); await expectCue('offer', 0); await idle();
  assert.equal((await starts()).filter(item => item.cue === 'offer').length, 1);
  passed('After reconnect, a genuinely new incoming offer plays once');

  // A genuine room with two normal bots provides setup sound and observed clock
  // intervals. The clock is Date.now(), not the controlled test clock.
  await archive('before-bots'); await page.goto('about:blank');
  // The two fixture accounts already host nine rooms between them. Use a new
  // isolated file-mail account so the production room limit is still respected.
  const host = new harness.clients[0].constructor();
  await host.register(2); harness.clients.push(host);
  await writeFile(join(harness.directory, 'manifest.json'), JSON.stringify(harness.manifest, null, 2) + '\n');
  const botStorage = JSON.parse(await readFile(harness.manifest.accounts[2].storageState, 'utf8'));
  await context.addCookies(botStorage.cookies);
  let room = (await host.request('/rooms', { gameId: 'district', capacity: 3, title: 'ТЕСТ · Аудио и реальные паузы',
    settings: { mapId: 'two-shores', mapVersion: '2', newsPreset: 'medium' } })).room;
  const path = '/rooms/' + room.roomId;
  for (let i = 0; i < 2; i++) room = (await host.request(path + '/bots', { difficulty: 'normal', expectedRevision: room.revision })).room;
  room = (await host.request(path + '/ready', { ready: true, expectedRevision: room.revision })).room;
  room = (await host.request(path + '/start', { expectedRevision: room.revision })).room;
  entry = { hostIndex: 2, roomId: room.roomId, url: harness.origin + path };
  await page.goto(entry.url); await expect(page.locator('.territorial-board')).toBeVisible();
  await settings(); await closeSettings();
  current = await view(entry);
  before = await count();
  await select('node', current.legal.options[0].id);
  await action(page.getByRole('button', { name: 'Build house', exact: true }));
  await expectCue('house', before); await idle();
  current = await view(entry);
  before = await count();
  await select('edge', current.legal.options[0].id);
  await action(page.getByRole('button', { name: 'Build road', exact: true }));
  await expectCue('road', before);
  const sampleStart = Date.now(), measured = [], schedule = new Map();
  let priorObservedAt = sampleStart, previousRevision = -1;
  const botCueOffset = await count();
  while (measured.length < 6 && Date.now() - sampleStart < 30_000) {
    const requestAt = Date.now(); current = await view(entry); const receivedAt = Date.now();
    if (current.botActionAt !== undefined && !schedule.has(current.revision)) schedule.set(current.revision, { at: current.botActionAt,
      participantId: current.botParticipantId, observedAt: receivedAt, serverNow: current.serverNow });
    if (previousRevision !== -1 && current.revision > previousRevision) {
      const events = current.history.filter(item => item.revision > previousRevision && item.source === 'bot' && !['distribution', 'win', 'offer-closed'].includes(item.kind));
      for (const event of events) {
        const expected = schedule.get(event.revision - 1);
        assert.ok(expected, 'Every measured bot action must have a previously observed persisted schedule');
        assert.equal(event.actorId, expected.participantId);
        assert.ok(receivedAt >= expected.at, 'An action was observed before its schedule');
        measured.push({ revision: event.revision, kind: event.kind, participantId: event.actorId,
          scheduledAt: expected.at, scheduleObservedAt: expected.observedAt,
          scheduleRemainingMs: expected.at - expected.serverNow,
          observedAfter: priorObservedAt, requestAt, observedAt: receivedAt,
          latenessUpperMs: receivedAt - expected.at,
          intervalSincePreviousObservationMs: measured.length ? receivedAt - measured.at(-1).observedAt : receivedAt - sampleStart });
      }
    }
    previousRevision = current.revision; priorObservedAt = receivedAt;
    if (measured.length < 6) await delay(80);
  }
  assert.equal(measured.length, 6);
  await observeRevision(entry, current.revision);
  await expectCue('house', botCueOffset); await expectCue('road', botCueOffset); await expectCue('production', botCueOffset); await idle();
  result.botTiming = { controlledClock: false, clock: 'Date.now()', humanActions: 'UI setup house and road',
    pollMs: 80, uiPollMs: 1100, exactExecutionTimestampRecorded: false,
    explanation: 'Execution is bracketed by HTTP observations. Intervals are observed wall-clock values, not exact per-action execution timestamps.', samples: measured };
  passed('Real setup house, road and production cues include bot actions; six HTTP-observed bot intervals measured',
    { intervalsMs: measured.map(item => item.intervalSincePreviousObservationMs), maxLatenessUpperMs: Math.max(...measured.map(item => item.latenessUpperMs)) });

  await archive('final-bots');
  assert.ok(requests.every(item => item.origin === harness.origin && item.status === 200));
  assert.ok(requests.filter(item => item.path.endsWith('.wav')).every(item => item.mime === 'audio/wav'));
  result.audioRequests = requests; result.browserErrors = errors;
  await Promise.all(assetReads);
  assert.deepEqual(errors, []);
  for (const asset of servedAssets.values()) {
    const bytes = await readFile(join(harness.directory, 'portal', asset.path));
    assert.equal(asset.sha256, createHash('sha256').update(bytes).digest('hex'), 'Browser asset differs from the isolated build: ' + asset.path);
  }
  result.servedAssets = [...servedAssets.values()];
  result.indexSha256 = createHash('sha256').update(await readFile(join(harness.directory, 'portal/index.html'))).digest('hex');
  assert.equal(result.indexSha256, harness.manifest.buildHashes.portalIndex);
  await writeFile(join(artifacts, 'native-audio-trace.json'), JSON.stringify({ traces, snapshots, requests }, null, 2) + '\n');
  await writeFile(join(artifacts, 'results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ passed: checks.length, artifacts, browser: result.browserVersion, audioListened: false }, null, 2));
} catch (error) {
  await archive('failure').catch(() => {});
  await page?.screenshot({ path: join(artifacts, 'failure.png') }).catch(() => {});
  await writeFile(join(artifacts, 'failure.json'), JSON.stringify({ error: String(error), checks, errors, traces, snapshots, requests }, null, 2) + '\n');
  console.error('Isolated audio diagnostics:', artifacts); throw error;
} finally { await browser?.close(); await harness.dispose(); }
