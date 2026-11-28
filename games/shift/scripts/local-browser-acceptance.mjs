/** Real-time UI-only Shift acceptance. Reads only renderer ShiftView props; never mutates application state. */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat, readdir, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { build } from 'vite';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = new Set(process.argv.length > 2 ? process.argv.slice(2) : ['--all']);
for (const arg of args) if (!['--all', '--ui', '--lessons', '--touch', '--matrix'].includes(arg)) throw new Error(`Unknown acceptance flag: ${arg}`);
const label = process.env.SHIFT_QA_LABEL || 'diagnostic';
const folder = resolve(root, '.qa/shift-local', label);
await mkdir(folder, { recursive: true });
const report = { label, build: {}, method: 'Headless Chromium automation at normal 30 Hz. Reads only the filtered ShiftView passed to the renderer; every gameplay action uses pointer, keyboard or visible buttons. No application-state writes, timer acceleration or account data changes.', tests: [], defects: [], errors: [], screenshots: [], captureWarnings: [], matches: [] };
const sourceDist = resolve(root, 'apps/portal/dist');
const dist = resolve(folder, 'built');
await rm(dist, { recursive: true, force: true });
await cp(sourceDist, dist, { recursive: true, force: true });
const html = await readFile(resolve(dist, 'index.html'));
async function digestFiles(base, files) {
  const hash = createHash('sha256');
  for (const name of [...new Set(files)].sort()) { try { hash.update(name); hash.update(await readFile(resolve(base, name))); } catch { hash.update('[missing]'); } }
  return hash.digest('hex');
}
async function listFiles(base, prefix = '') { const files = []; for (const entry of await readdir(resolve(base, prefix), { withFileTypes: true })) { const name = prefix + entry.name; if (entry.isDirectory()) files.push(...await listFiles(base, name + '/')); else if (entry.isFile()) files.push(name); } return files; }
const dirty = execFileSync('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8' }).trim();
const sourceFiles = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
report.build = { testedArtifactCopy: dist, sourceDist, sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), dirtyWorktree: !!dirty, worktreeChanges: dirty.split('\n').filter(Boolean), sourceTreeSha256AtRun: await digestFiles(root, sourceFiles), sourceDigestScope: 'Current working files at run start; diagnostic builds may predate these sources. Built artifact digest identifies tested bytes.', artifactSha256: await digestFiles(dist, await listFiles(dist)), htmlSha256: createHash('sha256').update(html).digest('hex'), htmlEntry: String(html).match(/src="([^"]+\.js)"/)?.[1] };
const helperEntry = resolve(folder, 'helpers.ts');
await writeFile(helperEntry, `export { chooseBotCommands, pilotWaypoint } from '${resolve(root, 'games/shift/src/bots/index.ts')}';\nexport { worldPosition, goalPosition, lineOfSight } from '${resolve(root, 'games/shift/src/core/index.ts')}';`);
await build({ configFile: false, logLevel: 'silent', build: { ssr: helperEntry, outDir: resolve(folder, 'helpers'), emptyOutDir: true, rollupOptions: { output: { entryFileNames: 'helpers.mjs' } } } });
const { chooseBotCommands, pilotWaypoint, worldPosition, goalPosition, lineOfSight } = await import(pathToFileURL(resolve(folder, 'helpers/helpers.mjs')).href);
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.glb': 'model/gltf-binary', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    if (pathname.startsWith('/api/')) { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { code: 'LOCAL_STATIC_ACCEPTANCE' } })); }
    let path = resolve(dist, '.' + pathname);
    if (!path.startsWith(dist + '/')) path = resolve(dist, 'index.html');
    try { if (!(await stat(path)).isFile()) path = resolve(dist, 'index.html'); } catch { path = resolve(dist, 'index.html'); }
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(await readFile(path));
  } catch { res.writeHead(500); res.end(); }
});
await new Promise(resolveListen => server.listen(5299, '127.0.0.1', resolveListen));
const localChromium = resolve(root, '.qa/shift-chromium/chrome-headless-shell-linux64/chrome-headless-shell');
const executablePath = process.env.SHIFT_CHROMIUM_EXECUTABLE || (existsSync(localChromium) ? localChromium : chromium.executablePath());
const browserServer = await chromium.launchServer({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const browser = await chromium.connect(browserServer.wsEndpoint());
report.browser = await browser.version();
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
async function bounded(action, milliseconds) { let timer; try { return await Promise.race([action(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Browser teardown timeout')), milliseconds); })]); } finally { clearTimeout(timer); } }
async function closeContext(context) { try { await bounded(() => context.close(), 4000); } catch { console.log(JSON.stringify({ harnessWarning: 'Context teardown exceeded4sec; browser process will be closed at run end.' })); } }
const log = (name, details = {}) => { report.tests.push({ name, ...details }); console.log(JSON.stringify({ test: name, ...details })); };
const defect = (name, details) => { report.defects.push({ name, details }); console.log(JSON.stringify({ defect: name, details })); };
async function snap(page, name) { if (await page.locator('.shift-match').count()) { console.log(JSON.stringify({ captureSkipped: name, reason: 'Headless canvas capture timed out in diagnostics; gameplay and DOM observations continue. Separate renderer fixtures provide visual evidence.' })); return; } const file = resolve(folder, `${name}.png`); try { await page.screenshot({ path: file, fullPage: !!(await page.locator('.shift-home').count()), timeout: 15000 }); report.screenshots.push(file); } catch (error) { const warning = { name, message: error.message }; report.captureWarnings.push(warning); console.log(JSON.stringify({ captureWarning: name, message: error.message })); } }
async function view(page) {
  return page.evaluate(() => {
    const host = document.querySelector('.shift-scene [data-shift-renderer]'); if (!host) return null;
    let fiber = host[Object.keys(host).find(key => key.startsWith('__reactFiber$'))];
    while (fiber) { if (fiber.memoizedProps?.view?.wireVersion === 'shift-wire@1') { const views = [fiber.memoizedProps.view, fiber.alternate?.memoizedProps?.view].filter(v => v?.wireVersion === 'shift-wire@1'); return structuredClone(views.sort((a, b) => b.tick - a.tick)[0]); } fiber = fiber.return; }
    return null;
  });
}
async function setupPage(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, ...options });
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  page.on('pageerror', error => report.errors.push({ url: page.url(), message: error.message }));
  await page.goto('http://127.0.0.1:5299/shift'); await page.locator('.shift-home').waitFor();
  return { context, page };
}
async function settings(page, mode = '2d', language) {
  await page.getByRole('button', { name: /^(Настройки|Settings)$/ }).click();
  await page.getByLabel(/Вид этажа|Floor view/).selectOption(mode);
  if (language) await page.getByLabel(/^(Язык|Language)$/).selectOption(language);
  await page.keyboard.press('Escape');
}
async function focusScene(page) { await page.locator('.shift-scene [data-shift-renderer]').focus(); }
async function aimAt(page, point) {
  const box = await page.locator('.shift-scene [data-shift-renderer]').boundingBox();
  if (!box) return;
  const scale = Math.min((box.width - 20) / 33, (box.height - 20) / 25);
  await page.mouse.move(box.x + box.width / 2 + (point.x - 8) * scale, box.y + box.height / 2 + (point.z - 8) * scale);
}
const held = new WeakMap();
async function keysFor(page, moveX = 0, moveZ = 0, fire = false) {
  const desired = new Set();
  if (Math.abs(moveX) > .24) desired.add(moveX > 0 ? 'd' : 'a');
  if (Math.abs(moveZ) > .24) desired.add(moveZ > 0 ? 's' : 'w');
  if (fire) desired.add('Space');
  const old = held.get(page) || new Set();
  for (const key of old) if (!desired.has(key)) await page.keyboard.up(key);
  for (const key of desired) if (!old.has(key)) await page.keyboard.down(key);
  held.set(page, desired);
}
async function stop(page) { await keysFor(page); }
async function lesson(page, role) {
  await settings(page, '2d');
  await page.getByRole('button', { name: role === 'pilot' ? /Урок пилота|Pilot lesson/ : /Урок штурмана|Navigator lesson/ }).click();
  await page.locator('.shift-match').waitFor(); await focusScene(page);
  const seen = new Set(), started = Date.now(); let lastStep = -1, lastActionTick = -1000, rideObserved = false;
  while (Date.now() - started < 120000) {
    const v = await view(page); if (!v) { await sleep(40); continue; }
    const complete = await page.locator('.shift-lesson.complete').count();
    if (complete) { await stop(page); await snap(page, `${role}-lesson-complete`); log(`${role} lesson completed`, { wallSeconds: (Date.now() - started) / 1000, tick: v.tick, steps: [...seen], rideObserved }); return; }
    const title = await page.locator('.shift-lesson h2').textContent();
    const step = Number((await page.locator('.shift-lesson-number').textContent()).match(/\d+/)?.[0]) - 1;
    seen.add(title);
    if (step !== lastStep) { console.log(JSON.stringify({ lesson: role, step, title, tick: v.tick })); lastStep = step; if (step === 0) { await stop(page); await snap(page, `${role}-lesson-step-${step}`); } }
    if (v.motion) rideObserved = true;
    if (role === 'navigator') {
      await stop(page);
      if (step === 0) { await page.keyboard.press('ArrowUp'); }
      else if (step === 1 && !v.motion && v.tick - lastActionTick > 15) { await focusScene(page); await page.keyboard.press('Enter'); lastActionTick = v.tick; }
      else if (step === 3 && !v.motion) {
        const option = v.shiftOptions.find(o => o.allowed);
        if (option && v.tick - lastActionTick > 15) { await page.locator('.shift-room-keys').getByRole('button', { name: option.roomId, exact: true }).click(); await page.locator('.shift-order').getByRole('button', { name: /Сдвинуть|Shift room/ }).click(); lastActionTick = v.tick; }
      } else if (step === 4) {
        const option = v.shiftOptions.find(o => o.reason === 'NOT_ADJACENT');
        if (option) await page.locator('.shift-room-keys').getByRole('button', { name: option.roomId, exact: true }).click();
      }
    } else {
      const actor = v.actors.find(a => a.seatId === v.self.seatId); if (!actor) throw new Error('Pilot actor missing');
      let target, fire = false;
      if (step === 0) target = { spaceId: 'O', x: -3.4, z: 0 };
      if (step === 1) {
        const enemy = v.actors.find(a => a.team !== actor.team && a.hp > 0);
        if (enemy && lineOfSight(v.settings.arena, v.board, actor, enemy, v.motion, v.tick, 12)) { await aimAt(page, worldPosition(v.board, enemy, v.motion, v.tick)); fire = true; }
        else target = { spaceId: 'O', x: 0, z: 1.3 };
      }
      if (step === 2) {
        target = { spaceId: 'O', x: 0, z: 0 };
        if (lineOfSight(v.settings.arena, v.board, actor, target, v.motion, v.tick, .85) && v.tick - lastActionTick > 4) { await page.keyboard.press('e'); lastActionTick = v.tick; }
      }
      if (step === 4) target = goalPosition(v.goalSpace);
      const point = target ? pilotWaypoint(v, actor, target) : { x: actor.x, z: actor.z };
      const dx = point.x - actor.x, dz = point.z - actor.z, distance = Math.hypot(dx, dz);
      const done = target && target.spaceId === actor.spaceId && Math.hypot(actor.x - target.x, actor.z - target.z) < (step === 4 ? .35 : .09);
      await keysFor(page, distance > .07 && !done ? dx / distance : 0, distance > .07 && !done ? dz / distance : 0, fire);
    }
    await sleep(35);
  }
  await stop(page); await snap(page, `${role}-lesson-timeout`);
  throw new Error(`${role} lesson did not finish: ${JSON.stringify({ title: await page.locator('.shift-lesson h2').textContent(), view: await view(page) })}`);
}
async function uiSweep() {
  const { page, context } = await setupPage();
  try {
    await snap(page, 'home-ru');
    await page.getByRole('button', { name: /Как устроен матч/ }).click();
    const dialog = page.getByRole('dialog'); await dialog.waitFor();
    for (let i = 0; i < 14; i++) await page.keyboard.press('Tab');
    const trapped = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    if (!trapped) defect('Modal keyboard focus escapes', 'Help dialog after14 Tab presses');
    await page.keyboard.press('Escape');
    const restored = await page.evaluate(() => document.activeElement?.textContent?.includes('Как устроен матч'));
    if (!restored) defect('Help focus does not return to opener', 'Open help, pressEscape');
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await page.getByRole('button', { name: /How the match works/ }).click(); await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Floor view').selectOption('2d'); await page.getByLabel('Quality').selectOption('low'); await page.getByLabel('Text size').selectOption('1.3');
    await page.getByLabel('Reduce camera motion').check(); await page.getByLabel('Reduce effects').check();
    for (const label of ['Game sound volume', 'Ambience volume', 'Aim stick sensitivity']) { const slider = page.getByLabel(label, { exact: true }); await slider.focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); }
    await page.locator('.shift-bindings button').filter({ hasText: 'Battery' }).click(); await page.keyboard.press('f');
    if (!(await page.locator('.shift-bindings button').filter({ hasText: 'Battery' }).textContent()).includes('F')) defect('Key rebinding failed', 'Battery→F');
    await snap(page, 'settings-en-130');
    await page.getByRole('button', { name: 'Reset settings', exact: true }).click(); await page.getByLabel('Floor view').selectOption('2d'); await page.keyboard.press('Escape');
    for (const arena of ['Crane Foundry', 'Calibration', 'Module Depot']) await page.locator('.shift-arena-picker button').filter({ hasText: arena }).click();
    await page.getByRole('button', { name: '3×3', exact: true }).click(); await page.getByLabel(/^Bots/).selectOption('hard'); await page.getByLabel('Rotate roles each round').uncheck();
    await page.locator('.shift-role-picker button').filter({ hasText: 'Navigator' }).click();
    await snap(page, 'home-en-configured');
    await page.getByRole('button', { name: /Start practice/ }).click(); await page.locator('.shift-match').waitFor();
    const v = await view(page); log('UI configuration reaches match', { settings: v.settings, role: v.self.role, botDifficulties: v.seats.filter(s => s.bot).map(s => s.difficulty) });
    if (v.settings.difficulty === 'hard' && v.seats.some(s => s.bot && s.difficulty !== 'hard')) defect('Practice difficulty ignored by bot seats', 'SelectHard onhome→start;settingshard butseatdifficulty!=hard');
    await page.getByRole('button', { name: 'Pause', exact: true }).click(); const pausedTick = (await view(page)).tick; await sleep(700); const heldTick = (await view(page)).tick;
    if (heldTick !== pausedTick) defect('Pause advanced simulation', `${pausedTick}→${heldTick}`);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Rules', exact: true }).click(); await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Switch view', exact: true }).click(); await sleep(1000); const renderer = await page.locator('.shift-scene [data-shift-renderer]').getAttribute('data-shift-renderer');
    await snap(page, 'navigator-3d');
    await page.getByRole('button', { name: 'Switch view', exact: true }).click();
    await page.getByRole('button', { name: 'RU', exact: true }).click();
    await page.getByRole('button', { name: 'В меню', exact: true }).click();
    await page.getByRole('button', { name: /Продолжить практику/ }).click();
    const resumed = await view(page); log('Pause/settings/mode/locale/resume buttons', { renderer3d: renderer, pausedTick, heldTick, resumedArena: resumed.settings.arena, resumedTeamSize: resumed.settings.teamSize });
    await snap(page, 'navigator-resumed-ru');
  } finally { await closeContext(context); }
}
async function fullMatch({ arena, teamSize, role, language, viewport }) {
  const { page, context } = await setupPage({ viewport });
  const title = { foundry: /Крановый цех|Crane Foundry/, calibration: /Калибровка|Calibration/, depot: /Склад модулей|Module Depot/ }[arena];
  const id = `${arena}-${teamSize}v${teamSize}-${role}`;
  try {
    await settings(page, '2d', language);
    await page.locator('.shift-arena-picker button').filter({ hasText: title }).click();
    await page.getByRole('button', { name: `${teamSize}×${teamSize}`, exact: true }).click();
    await page.locator('.shift-role-picker button').filter({ hasText: role === 'pilot' ? /Пилот|Pilot/ : /Штурман|Navigator/ }).click();
    await page.getByRole('button', { name: /Начать практику|Start practice/ }).click(); await page.locator('.shift-match').waitFor(); await focusScene(page);
    const memory = { seq: 0, counter: 0, nextDecisionTick: 0, recentRooms: [] }, started = Date.now();
    let priorRound = 0, lastInteract = -100, lastShift = -100, lastRole, maxTick = 0, shiftsObserved = 0, previousMotionId;
    while (Date.now() - started < 540000) {
      const v = await view(page); if (!v) { await sleep(40); continue; }
      maxTick = Math.max(maxTick, v.tick);
      if (v.round !== priorRound) { console.log(JSON.stringify({ match: id, round: v.round, role: v.self.role, score: v.score, tick: v.tick })); priorRound = v.round; }
      if (v.self.role !== lastRole) { await stop(page); await focusScene(page); lastRole = v.self.role; memory.nextDecisionTick = 0; }
      if (v.motion && `${v.motion.startTick}:${v.motion.roomId}` !== previousMotionId) { shiftsObserved++; previousMotionId = `${v.motion.startTick}:${v.motion.roomId}`; }
      if (v.phase === 'finished') {
        await stop(page); await page.locator('.shift-result').waitFor(); await snap(page, `match-${id}-result`);
        const result = { id, arena, teamSize, initialRole: role, language, viewport, normalClock: true, wallSeconds: (Date.now() - started) / 1000, tick: v.tick, score: v.score, rounds: v.rounds, stats: v.stats, shiftsObserved, documentHidden: await page.evaluate(() => document.hidden) };
        report.matches.push(result); log('Full browser practice match finished', result);
        await page.getByRole('button', { name: /Реванш|Rematch/ }).click(); await page.locator('.shift-result').waitFor({ state: 'hidden' });
        const rematch = await view(page); if (rematch.round !== 1 || rematch.score.teal || rematch.score.amber) defect('Rematch did not reset', id);
        await page.getByRole('button', { name: /В меню|Back to menu/ }).click();
        return;
      }
      if (v.phase !== 'active') { await stop(page); await sleep(80); continue; }
      const commands = chooseBotCommands(v, memory), move = commands.find(c => c.type === 'input');
      if (move) {
        const actor = v.actors.find(a => a.seatId === v.self.seatId);
        if (actor) { const point = worldPosition(v.board, actor, v.motion, v.tick); await aimAt(page, { x: point.x + Math.cos(move.aim) * 6, z: point.z + Math.sin(move.aim) * 6 }); }
        await keysFor(page, move.moveX, move.moveZ, move.fireHeld);
      }
      if (commands.some(c => c.type === 'interact') && v.tick - lastInteract >= 5) { await page.keyboard.press('e'); lastInteract = v.tick; }
      const shift = commands.find(c => c.type === 'shift');
      if (shift && v.tick - lastShift >= 15) {
        const button = page.locator('.shift-room-keys').getByRole('button', { name: shift.roomId, exact: true });
        await button.click(); const act = page.locator('.shift-order').getByRole('button', { name: /Сдвинуть|Shift room/ });
        if (await act.isEnabled()) await act.click(); await focusScene(page); lastShift = v.tick;
      }
      await sleep(40);
    }
    await snap(page, `match-${id}-timeout`); throw new Error(`Practice match timeout ${id}, maxTick${maxTick}, view=${JSON.stringify(await view(page))}`);
  } finally { await stop(page).catch(() => {}); await closeContext(context); }
}
async function touchSweep() {
  const { page, context } = await setupPage({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  try {
    await settings(page, '2d'); await page.getByRole('button', { name: /Начать практику/ }).click(); await page.locator('.shift-match').waitFor();
    const readyStart = Date.now(); let ready; while ((ready = await view(page))?.phase !== 'active' && Date.now() - readyStart < 25000) await sleep(100); if (ready?.phase !== 'active') throw new Error(`Touch practice did not reach active: ${JSON.stringify({ tick: ready?.tick, phase: ready?.phase, hidden: await page.evaluate(() => document.hidden), text: (await page.locator('.shift-match').innerText()).slice(0, 1500) })}`);
    const before = await view(page), actorBefore = before.actors.find(a => a.seatId === 'self');
    const cdp = await context.newCDPSession(page), stick = await page.getByRole('group', { name: 'Ход', exact: true }).boundingBox();
    if (!stick) throw new Error('Touch movement stick is absent');
    const x = stick.x + stick.width * .78, y = stick.y + stick.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); await sleep(450); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(100);
    const after = await view(page), actorAfter = after.actors.find(a => a.seatId === 'self');
    if (actorBefore.x === actorAfter.x && actorBefore.z === actorAfter.z && actorBefore.spaceId === actorAfter.spaceId) defect('Touch movement did not move actor', { actorBefore, actorAfter });
    const fire = await page.getByRole('button', { name: 'Выстрел', exact: true }).boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fire.x + fire.width / 2, y: fire.y + fire.height / 2, id: 2 }] }); await sleep(450); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.getByRole('button', { name: 'Поставить метку', exact: true }).tap(); await page.getByRole('button', { name: 'Взять или сбросить батарею', exact: true }).tap();
    await page.getByRole('button', { name: /План этажа/ }).click(); await page.getByRole('button', { name: /План этажа/ }).click();
    const metrics = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, buttons: [...document.querySelectorAll('.shift-touch-controls button')].map(e => ({ label: e.getAttribute('aria-label'), w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height, bottom: e.getBoundingClientRect().bottom })), fps: document.querySelector('.shift-scene [data-fps]')?.getAttribute('data-fps') }));
    if (metrics.buttons.some(b => b.w < 44 || b.h < 44 || b.bottom > metrics.height)) defect('Touch controls miss44px orviewport constraint', metrics);
    await snap(page, 'touch-844x390'); log('Touch emulation and expanded minimap', metrics);
  } finally { await closeContext(context); }
}
try {
  if (args.has('--ui') || args.has('--all')) await uiSweep().catch(error => defect('UI sweep failed', error.message));
  if (args.has('--lessons') || args.has('--all')) for (const role of ['pilot', 'navigator']) {
    const { page, context } = await setupPage();
    try { await lesson(page, role); } catch (error) { defect(`${role} browser lesson failed`, error.message); } finally { await closeContext(context); }
  }
  if (args.has('--touch') || args.has('--all')) await touchSweep().catch(error => defect('Touch sweep failed', error.message));
  if (args.has('--matrix') || args.has('--all')) {
    const cases = ['foundry', 'calibration', 'depot'].flatMap((arena, i) => [2, 3].map((teamSize, j) => ({ arena, teamSize, role: j ? 'navigator' : 'pilot', language: i % 2 ? 'en' : 'ru', viewport: { width: j ? 1920 : 1366, height: j ? 1080 : 768 } })));
    const results = await Promise.allSettled(cases.map(fullMatch));
    results.forEach((result, i) => { if (result.status === 'rejected') defect('Full browser match failed', { case: cases[i], error: result.reason?.message }); });
  }
} finally {
  await writeFile(resolve(folder, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ resultFile: resolve(folder, 'results.json'), tests: report.tests.length, matches: report.matches.length, defects: report.defects.length, pageErrors: report.errors.length }));
  try { await bounded(() => browser.close(), 4000); } catch { /* BrowserServer owns fallback shutdown. */ }
  try { await bounded(() => browserServer.close(), 4000); } catch { await browserServer.kill(); }
  server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose));
}
process.exitCode = report.defects.length || report.errors.length ? 1 : 0;
