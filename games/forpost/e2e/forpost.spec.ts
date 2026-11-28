import { test, expect, errors } from '@playwright/test'
import type { Page, APIRequestContext, Locator } from '@playwright/test'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { WorldView } from '../src/core/types'
import { getMap } from '../src/core/maps'
import { installDiagnostics } from './diagnostics'

installDiagnostics(test)

const origin = 'http://127.0.0.1:5274'
const root = resolve(import.meta.dirname, '../../..')
async function post(api: APIRequestContext, path: string, body: unknown) {
  const current = await (await api.get('/api/platform/v1/session')).json()
  const response = await api.post('/api/platform/v1' + path, { data: body, headers: { Origin: origin, 'X-CSRF-Token': current.csrfToken, 'Idempotency-Key': randomUUID() } })
  expect(response.ok(), `${path}: HTTP ${response.status()}`).toBe(true)
  return response.json()
}
/** Explicit isolated fixtures: local .test accounts and file mailbox, no outgoing mail. */
async function account(page: Page, prefix: string) {
  const suffix = randomUUID().slice(0, 8), handle = `fp_${prefix}_${suffix}`, email = `${handle}@example.test`
  await post(page.request, '/auth/register', { email, password: 'Forpost-local-fixture-2026!', handle, displayName: `QA ${prefix}` })
  const config = JSON.parse(await readFile(resolve(root, '.qa/forpost/current-e2e.json'), 'utf8')) as { mailDirectory: string; origin: string }
  const files = await readdir(config.mailDirectory)
  let verification: string | undefined
  for (const file of files) {
    const message = await readFile(resolve(config.mailDirectory, file), 'utf8')
    if (message.split(/\r?\n/, 1)[0] !== `To: ${email}`) continue
    const link = message.split(/\r?\n/).map(line => line.trim()).find(line => line.startsWith(`${config.origin}/verify?`))
    if (link) { const url = new URL(link); if (url.origin === origin && url.pathname === '/verify') verification = url.searchParams.get('token') ?? undefined }
  }
  expect(verification, 'local verification token').toMatch(/^[A-Za-z0-9_-]{40,64}$/)
  await post(page.request, '/auth/verify', { token: verification })
}
function observeView(page: Page, onView?: (view: WorldView) => void) {
  let latest: WorldView | undefined
  let serverOverloadObserved = false
  const bases = new Map<number, WorldView>()
  let epoch: number | undefined
  page.on('websocket', socket => socket.on('framereceived', event => {
    const packet = JSON.parse(String(event.payload))
    if (packet.type === 'phaseChanged' && packet.phase === 'paused' && packet.reason === 'SERVER_BUSY') serverOverloadObserved = true
    if (packet.type === 'hello') { epoch = packet.epoch; bases.clear(); latest = undefined; return }
    if (packet.type === 'full') { if (epoch !== packet.epoch) bases.clear(); epoch = packet.epoch; latest = packet.view }
    else if (packet.type === 'delta') {
      const baseline = bases.get(packet.baselineSnapshotSeq)
      if (packet.epoch !== epoch || !baseline) return
      latest = { ...baseline, ...packet.patch }
    } else return
    if (latest) { bases.set(packet.snapshotSeq, latest); while (bases.size > 64) bases.delete(bases.keys().next().value!); onView?.(latest) }
  }))
  return () => {
    // A real overload pause already violates this continuous-match scenario.
    // Fail at the next observation instead of waiting out the 20-minute match
    // budget. The original result/escort/privacy assertions remain mandatory.
    expect(serverOverloadObserved, 'SERVER_BUSY observed in an actual phaseChanged message').toBe(false)
    return latest
  }
}
/** A result overlay can arrive between the last snapshot and a visible UI click. */
async function clickWithinOperation(locator: Locator, latest: () => WorldView | undefined): Promise<boolean> {
  const before = latest()
  if (!before || before.phase === 'operationResult' || before.phase === 'finished') return false
  try { await locator.click({ timeout: 1500 }); return true }
  catch (error) {
    const after = latest()
    // Suppress only a click timeout accompanied by the actually observed result transition.
    if (error instanceof errors.TimeoutError && after && (after.phase === 'operationResult' || after.phase === 'finished' || after.operation !== before.operation)) return false
    throw error
  }
}
async function setupMapRoom(page: Page, map: string): Promise<void> {
  const createDialog = page.getByRole('dialog', { name: 'Новая комната', exact: true })
  await expect(createDialog).toBeVisible()
  await createDialog.getByRole('combobox', { name: 'Игра', exact: true }).selectOption('forpost')
  await createDialog.getByRole('combobox', { name: /^Мест за столом/ }).selectOption('2')
  await createDialog.getByRole('combobox', { name: /^Карта операции/ }).selectOption(map)
  await createDialog.getByRole('button', { name: 'Создать комнату', exact: true }).click()
  await page.getByRole('combobox', { name: 'Сложность бота', exact: true }).selectOption('normal')
  await page.locator('.add-bot').getByRole('button', { name: 'Добавить', exact: true }).click()
  await page.getByRole('button', { name: 'Я готов', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Начать игру', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Начать игру', exact: true }).click()
  await page.getByRole('link', { name: 'Открыть Форпост', exact: true }).click()
  await expect(page.locator('.fp-game')).toBeVisible()
}
async function waitForActionView(latest: () => WorldView | undefined, operation: number, check: (view: WorldView) => boolean): Promise<boolean> {
  await expect.poll(() => {
    const view = latest()
    return !!view && (view.operation !== operation || view.phase === 'operationResult' || view.phase === 'finished' || check(view))
  }, { timeout: 10_000 }).toBe(true)
  const view = latest()
  return !!view && view.operation === operation && !['operationResult', 'finished'].includes(view.phase) && check(view)
}
async function selectOperationPad(page: Page, latest: () => WorldView | undefined, padId: string): Promise<boolean> {
  const before = latest()
  if (!before || ['operationResult', 'finished'].includes(before.phase)) return false
  try {
    // An operation may end with an unconfirmed build preview still open. Cancel
    // that preview through its visible control before choosing the new side's pad.
    const preview = page.locator('.fp-build-confirm')
    if (await preview.isVisible() && !await clickWithinOperation(preview.getByRole('button', { name: 'Отмена', exact: true }), latest)) return false
    await page.getByRole('combobox', { name: /^Выбрать площадку/ }).selectOption(padId, { timeout: 1500 })
    return true
  } catch (error) {
    const after = latest()
    if (error instanceof errors.TimeoutError && after && (['operationResult', 'finished'].includes(after.phase) || after.operation !== before.operation)) return false
    throw error
  }
}
async function queueOwnedDock(page: Page, latest: () => WorldView | undefined): Promise<void> {
  const view = latest()
  if (!view || ['operationResult', 'finished'].includes(view.phase)) return
  if (view.buildings.some(building => building.ownerId === view.you && building.kind === 'dock') || view.buildOrders.some(order => order.ownerId === view.you && order.kind === 'dock')) return
  const padId = `${view.teams[view.yourTeam].side}-03`
  if (!view.buildOptions[padId]?.some(option => option.kind === 'dock' && option.ok)) return
  if (!await selectOperationPad(page, latest, padId)) return
  const dock = page.locator('.fp-build-option').filter({ has: page.getByText('Док дронов', { exact: true }) })
  if (!await clickWithinOperation(dock, latest)) return
  if (!await clickWithinOperation(page.getByRole('button', { name: 'Построить', exact: true }), latest)) return
  await waitForActionView(latest, view.operation, next => next.buildings.some(building => building.ownerId === next.you && building.kind === 'dock') || next.buildOrders.some(order => order.ownerId === next.you && order.kind === 'dock'))
}
async function maintainOwnedSquad(page: Page, latest: () => WorldView | undefined): Promise<void> {
  let view = latest()
  if (!view || ['operationResult', 'finished'].includes(view.phase)) return
  const ownId = view.you
  const player = view.participants.find(participant => participant.id === ownId)!
  if (player.mode !== 'tactics') {
    if (!await clickWithinOperation(page.locator('.fp-mode-switch'), latest)) return
    if (!await waitForActionView(latest, view.operation, next => next.participants.find(participant => participant.id === next.you)?.mode === 'tactics')) return
  }
  // The route is a normal player choice. The current vehicle keeps its route;
  // the next one uses the selected southern road, including FP03's shorter road.
  view = latest()!
  const team = view.teams[view.yourTeam]
  if (team.manualRoute !== 'S' && team.nextRoute !== 'S' && view.tick - (team.routeChangedTick ?? -100) >= 90) {
    const south = page.locator('.fp-route-control').getByRole('button', { name: 'Юг', exact: true })
    if (await south.isEnabled()) {
      if (!await clickWithinOperation(south, latest)) return
      if (!await waitForActionView(latest, view.operation, next => next.teams[next.yourTeam].manualRoute === 'S' || next.transports.some(transport => transport.team === next.yourTeam && transport.route === 'S'))) return
    }
  }
  await queueOwnedDock(page, latest)
  view = latest()!
  if (['operationResult', 'finished'].includes(view.phase)) return
  const dock = view.buildings.find(building => building.ownerId === ownId && building.kind === 'dock' && building.completedTick !== null && building.powered)
  const ownedDroneCount = view.units.filter(unit => unit.ownerId === ownId && unit.kind === 'drone').length
  if (dock && ownedDroneCount + (dock.droneQueue?.length ?? 0) < 2 && (view.participants.find(participant => participant.id === ownId)?.credits ?? 0) >= 60) {
    if (!await selectOperationPad(page, latest, dock.padId)) return
    const produce = page.getByRole('button', { name: /^Заказать дрон/ })
    if (await produce.isEnabled()) {
      const knownOrders = new Set(dock.droneQueue?.map(order => order.id) ?? [])
      const knownDrones = new Set(view.units.filter(unit => unit.ownerId === ownId && unit.kind === 'drone').map(unit => unit.id))
      if (!await clickWithinOperation(produce, latest)) return
      await waitForActionView(latest, view.operation, next => next.buildings.some(building => building.id === dock.id && building.droneQueue?.some(order => !knownOrders.has(order.id))) || next.units.some(unit => unit.ownerId === next.you && unit.kind === 'drone' && !knownDrones.has(unit.id)))
    }
  }
  view = latest()!
  if (['operationResult', 'finished'].includes(view.phase)) return
  // Stable DOM keys identify only the player's already-visible own units. A new
  // fighter generation after respawn and every produced drone receive the order.
  for (const unit of view.units.filter(unit => unit.ownerId === ownId && unit.kind !== 'builder' && unit.order?.type !== 'escort')) {
    const current = latest()
    if (!current || ['operationResult', 'finished'].includes(current.phase)) return
    if (!current.units.some(candidate => candidate.id === unit.id && candidate.hp > 0)) continue
    const button = page.locator(`.fp-unit-bar button[data-unit-id=${JSON.stringify(unit.id)}]`)
    try {
      if (!await clickWithinOperation(button, latest)) return
      const escort = page.getByRole('button', { name: 'Сопровождать', exact: true })
      if (!await clickWithinOperation(escort, latest)) return
      await waitForActionView(latest, current.operation, next => !next.units.some(candidate => candidate.id === unit.id) || next.units.some(candidate => candidate.id === unit.id && candidate.order?.type === 'escort'))
    } catch (error) {
      // A unit can die while Playwright waits for its button or command. Only
      // that observed disappearance is retryable; other UI timeouts remain failures.
      if (error instanceof errors.TimeoutError && !latest()?.units.some(candidate => candidate.id === unit.id)) continue
      throw error
    }
  }
}

async function lesson(page: Page, index: number) {
  await page.goto('/play/forpost/')
  await page.getByRole('button', { name: /Научиться играть/ }).click()
  await page.locator('.fp-lesson-list button').nth(index).click()
  await expect(page.locator('.fp-lesson')).toBeVisible()
}
async function exitMenu(page: Page) {
  await page.getByRole('button', { name: 'Меню партии', exact: true }).click()
  await page.getByRole('button', { name: 'В главное меню', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'ФОРПОСТ', exact: true })).toBeVisible()
}
test('catalogue, exact build, all map choices and persisted RU/EN/settings', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/games')
  await expect(page.locator('.game-forpost')).toBeVisible()
  await page.locator('.game-forpost').getByRole('link', { name: 'Играть', exact: true }).click()
  const identity = await (await page.request.get('/api/realtime/v1/health')).json()
  await expect(page.locator('[data-build]')).toHaveAttribute('data-build', identity.buildRevision)
  for (const map of ['FP01', 'FP02', 'FP03']) {
    const choice = page.locator('.fp-map-card').filter({ hasText: map }); await choice.click(); await expect(choice).toHaveAttribute('aria-pressed', 'true')
  }
  await page.getByRole('button', { name: 'Настройки', exact: true }).click()
  // A wrapping label also contains option text; locate the named control itself.
  await page.getByRole('combobox', { name: /^Язык/ }).selectOption('en')
  await page.getByRole('combobox', { name: /^Text size/ }).selectOption('1.3')
  await page.getByLabel('Reduced motion', { exact: true }).check()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'FORPOST', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('combobox', { name: /^Text size/ })).toHaveValue('1.3')
  await expect(page.getByLabel('Reduced motion', { exact: true })).toBeChecked()
  expect(errors).toEqual([])
})

test('actual tutorial construction, queue, power state and isolated save', async ({ page }) => {
  await lesson(page, 3)
  await page.locator('.fp-mode-switch').click()
  await page.getByRole('button', { name: 'Строительство', exact: true }).click()
  for (const [pad, name] of [['L-03', 'Ретранслятор'], ['L-01', 'Экстрактор']]) {
    await page.getByRole('combobox', { name: /^Выбрать площадку/ }).selectOption(pad)
    await page.locator('.fp-build-option').filter({ has: page.getByText(name, { exact: true }) }).click()
    await expect(page.getByRole('button', { name: 'Построить', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Построить', exact: true }).click()
  }
  await expect(page.locator('.fp-lesson')).toContainText('Задача выполнена', { timeout: 40_000 })
  await exitMenu(page)
  await page.getByRole('button', { name: /Научиться играть/ }).click()
  await page.getByRole('button', { name: 'Продолжить сохранённый урок', exact: true }).click()
  await expect(page.locator('.fp-lesson')).toContainText('Задача выполнена')
  expect(await page.evaluate(() => localStorage.getItem('iva.forpost.last-match.v1'))).toBeNull()
})

test.describe('mobile controls', () => {
  // The fixture owns teardown, preserving the original error if a test times out.
  test.use({ viewport: { width: 390, height: 600 }, isMobile: true, hasTouch: true })
  test('touch viewport, 130 percent text, renderer fallback and rotation keep controls usable', async ({ page }) => {
    await lesson(page, 0)
    await expect(page.getByRole('button', { name: 'Джойстик движения', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Меню партии', exact: true }).click()
    await page.getByRole('dialog', { name: 'Меню партии', exact: true }).getByRole('button', { name: 'Настройки', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Настройки', exact: true })
    await settings.getByRole('combobox', { name: /^Размер текста/ }).selectOption('1.3')
    await settings.getByRole('combobox', { name: /^Отображение/ }).selectOption('2d')
    await settings.getByRole('button', { name: 'Готово', exact: true }).click()
    await expect(settings).not.toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.setViewportSize({ width: 844, height: 390 })
    await expect(page.getByRole('button', { name: 'Огонь', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Меню партии', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Продолжить', exact: true })).toBeVisible()
  })
})

test.describe('three complete network matches through visible controls', () => {
  test.describe.configure({ mode: 'parallel' })
  const renderer = process.env.FORPOST_MAP_RENDERER === '2d' ? '2d' : '3d'
  for (const map of ['FP01', 'FP02', 'FP03'] as const) test(`${map}: lobby, direct input, squad escort, match result and return [${renderer}]`, async ({ page }) => {
    test.setTimeout(1_300_000)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    let primaryMatch: string | undefined, observedEscort = false, observedDroneEscort = false, observedEligibleUnload = false, remainedHuman = true
    const deliveryEvents = new Set<number>(), eligibleUnloadDeliveryEvents = new Set<number>()
    const ownUnload = new Map<string, { operation: number; tick: number }>()
    const latest = observeView(page, view => {
      primaryMatch ??= view.matchId
      if (view.matchId !== primaryMatch) return
      const player = view.participants.find(participant => participant.id === view.you)!
      remainedHuman &&= player.controller === 'human' && !player.temporaryBot
      const ownUnits = view.units.filter(unit => unit.ownerId === view.you && unit.kind !== 'builder')
      if (player.mode === 'tactics' && ownUnits.some(unit => unit.kind === 'fighter' && unit.order?.type === 'escort')) observedEscort = true
      if (ownUnits.some(unit => unit.kind === 'drone' && unit.order?.type === 'escort')) observedDroneEscort = true
      const center = getMap(view.mapId).complex
      const autonomousParticipant = player.controller === 'human' && !player.temporaryBot && ownUnits.some(unit => unit.hp > 0 && !unit.protected && (unit.kind === 'drone' || player.mode === 'tactics') && Math.hypot(unit.x - center.x, unit.z - center.z) <= 3)
      for (const transport of view.transports.filter(transport => transport.team === view.yourTeam)) {
        if ((transport.unloadTicks ?? 0) > 0 && autonomousParticipant) {
          observedEligibleUnload = true; ownUnload.set(transport.id, { operation: view.operation, tick: view.tick })
        } else ownUnload.delete(transport.id)
      }
      for (const event of view.events) if (event.type === 'delivery' && event.team === view.yourTeam) {
        deliveryEvents.add(event.seq)
        const unload = event.targetId ? ownUnload.get(event.targetId) : undefined
        // Correlate the public delivery with this same vehicle's witnessed eligible
        // unload, within the actual three-second unloading interval. No hidden world.
        if (unload && unload.operation === view.operation && event.tick >= unload.tick && event.tick - unload.tick <= 90) eligibleUnloadDeliveryEvents.add(event.seq)
      }
    })
    await account(page, map.toLowerCase())
    if (renderer === '2d') {
      // An additional supported-renderer passage, separate from the unchanged
      // default-3D jobs. Selecting it never counts as 3D performance acceptance.
      await page.goto('/play/forpost/')
      await page.getByRole('button', { name: 'Настройки', exact: true }).click()
      const settings = page.getByRole('dialog', { name: 'Настройки', exact: true })
      await settings.getByRole('combobox', { name: /^Отображение/ }).selectOption('2d')
      await settings.getByRole('button', { name: 'Готово', exact: true }).click()
    }
    await page.goto('/rooms?game=forpost')
    await setupMapRoom(page, map)
    const healthResponse = await page.request.get('/api/realtime/v1/health')
    expect(healthResponse.ok()).toBe(true)
    const identity = await healthResponse.json()
    expect(identity.artifactId).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(identity.contentId).toMatch(/^sha256:[a-f0-9]{64}$/)
    await expect(page.locator('[data-build]')).toHaveAttribute('data-build', identity.buildRevision)
    expect(new URL(page.url()).pathname).toBe(`/realtime-assets/${identity.contentId.slice(7)}/`)
    console.log(JSON.stringify({ automatedBuildIdentity: true, map, renderer, buildRevision: identity.buildRevision, artifactId: identity.artifactId, contentId: identity.contentId }))
    await expect.poll(() => latest()?.mapId).toBe(map)
    expect(latest()!.teamSize).toBe(1)
    expect(latest()!.participants.filter(participant => participant.controller === 'bot')).toHaveLength(1)
    expect(latest()!.participants.find(participant => participant.controller === 'bot')!.botLevel).toBe('normal')
    // Queue real builder work during preparation; no money, poses or results are injected.
    await queueOwnedDock(page, latest)
    await expect.poll(() => latest()?.phase, { timeout: 30_000 }).toBe('battle')
    const stage = page.locator('.fp-stage'), bounds = (await stage.boundingBox())!
    await stage.click(); const side = latest()!.teams[latest()!.yourTeam].side
    const beforeMove = latest()!.units.find(unit => unit.ownerId === latest()!.you && unit.kind === 'fighter')!
    await page.keyboard.down(side === 'L' ? 'KeyD' : 'KeyA')
    try { await page.waitForTimeout(1200) } finally { await page.keyboard.up(side === 'L' ? 'KeyD' : 'KeyA') }
    await expect.poll(() => { const unit = latest()?.units.find(unit => unit.ownerId === latest()!.you && unit.kind === 'fighter'); return unit ? Math.hypot(unit.x - beforeMove.x, unit.z - beforeMove.z) : 0 }).toBeGreaterThan(.5)
    const magazine = latest()!.units.find(unit => unit.ownerId === latest()!.you && unit.kind === 'fighter')!.magazine!
    await page.mouse.move(bounds.x + bounds.width * (side === 'L' ? .7 : .3), bounds.y + bounds.height / 2)
    await page.mouse.down(); try { await page.waitForTimeout(400) } finally { await page.mouse.up() }
    await expect.poll(() => latest()?.units.find(unit => unit.ownerId === latest()!.you && unit.kind === 'fighter')?.magazine ?? magazine).toBeLessThan(magazine)
    await page.locator('.fp-mode-switch').click()
    const started = Date.now()
    while (Date.now() - started < 1_220_000 && latest()?.phase !== 'finished') {
      if (latest()?.phase === 'operationResult') { await page.waitForTimeout(1000); continue }
      await maintainOwnedSquad(page, latest)
      const view = latest()
      if (view && view.phase !== 'finished') for (const transport of view.transports.filter(transport => transport.team !== view.yourTeam)) {
        expect(transport).not.toHaveProperty('speed'); expect(transport).not.toHaveProperty('escorted'); expect(transport).not.toHaveProperty('unloadTicks'); expect(transport).not.toHaveProperty('lastDamageTick')
      }
      await page.waitForTimeout(2000)
    }
    expect(latest()?.phase).toBe('finished')
    const result = latest()!, me = result.participants.find(participant => participant.id === result.you)!
    const ownDeliveries = result.operations.reduce((sum, operation) => sum + operation.deliveries[result.yourTeam], 0)
    expect(observedEscort).toBe(true); expect(observedDroneEscort).toBe(true); expect(observedEligibleUnload).toBe(true)
    expect(remainedHuman, 'Own deliveries must not be performed by temporary controller takeover').toBe(true)
    expect(ownDeliveries, 'At least one real delivery is required from the player’s one-person team').toBeGreaterThan(0)
    expect(me.statistics?.deliveries, 'Final personal credit requires an alive eligible own nonbuilder at unloading').toBeGreaterThan(0)
    expect(deliveryEvents.size).toBeGreaterThan(0)
    expect(eligibleUnloadDeliveryEvents.size, 'The delivered vehicle must have a witnessed eligible own autonomous unload').toBeGreaterThan(0)
    expect(result.resultId).toBeTruthy()
    expect(result.operations.length).toBeGreaterThanOrEqual(2); expect(result.operations.length).toBeLessThanOrEqual(3)
    for (const team of ['A', 'B'] as const) expect(result.teams[team].wins).toBe(result.operations.filter(operation => operation.winner === team).length)
    expect(result.winner).toBe(result.teams.A.wins === result.teams.B.wins ? null : result.teams.A.wins > result.teams.B.wins ? 'A' : 'B')
    const outcome = result.winner === null ? 'Ничья' : result.winner === result.yourTeam ? 'Победа' : 'Поражение'
    await expect(page.locator('.fp-result')).toBeVisible()
    await expect(page.locator('.fp-result h1')).toHaveText(outcome)
    await expect(page.locator('.fp-result-deliveries b')).toHaveText(String(me.statistics!.deliveries))
    const operationRows = page.locator('.fp-result-operations>div')
    await expect(operationRows).toHaveCount(result.operations.length)
    for (const [index, operation] of result.operations.entries()) await expect(operationRows.nth(index).locator('strong')).toHaveText(`${operation.deliveries.A} : ${operation.deliveries.B}`)
    await page.getByRole('button', { name: 'В меню', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'ФОРПОСТ', exact: true })).toBeVisible()
    // Reopening a completed match preserves its result. Identity stays in memory.
    await page.getByRole('button', { name: 'Продолжить партию', exact: true }).click()
    await expect(page.locator('.fp-result')).toBeVisible()
    await expect.poll(() => latest()?.resultId).toBe(result.resultId)
    expect(latest()!.operations).toEqual(result.operations)
    expect(latest()!.participants.find(participant => participant.id === result.you)!.statistics?.deliveries).toBe(me.statistics!.deliveries)
    // Finished platform rooms are immutable: repeat through the normal new-room UI.
    await page.getByRole('link', { name: 'В комнату', exact: true }).click()
    await expect(page.getByText('Этот стол завершён', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Создать комнату', exact: true }).click()
    await setupMapRoom(page, map)
    await expect.poll(() => latest()?.matchId && latest()!.matchId !== result.matchId).toBe(true)
    expect(latest()!.mapId).toBe(map); expect(['preparation', 'battle']).toContain(latest()!.phase)
    expect(latest()!.resultId).toBeNull(); expect(latest()!.operations).toHaveLength(0)
    await queueOwnedDock(page, latest)
    expect(latest()!.buildOrders.some(order => order.ownerId === latest()!.you && order.kind === 'dock') || latest()!.buildings.some(building => building.ownerId === latest()!.you && building.kind === 'dock')).toBe(true)
    await exitMenu(page)
    await expect(page.getByRole('heading', { name: 'ФОРПОСТ', exact: true })).toBeVisible()
    expect(errors).toEqual([])
    console.log(JSON.stringify({ automatedUi: true, map, renderer, tick: result.tick, operations: result.operations, winner: result.winner, ownDeliveries, ownEligibleDeliveryCredit: me.statistics!.deliveries, correlatedEligibleUnloads: eligibleUnloadDeliveryEvents.size, observedEscort, observedDroneEscort, observedEligibleUnload, remainedHuman, resultRestoredUnchanged: true, replayStarted: true, replayBuildAccepted: true, returnedToMenu: true }))
  })
})
