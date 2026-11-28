import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { createPosition } from '../../src/core';
import type { Command, GameState, Side } from '../../src/core';
import { ENGINE_VERSION, PRESET_VERSION } from '../../src/engine/presets';
import { initialProfile, RATING_VERSION } from '../../src/rating/elo';
import type { Profile } from '../../src/rating/elo';
import { createMatch } from '../../src/session/match';
import type { MatchRecord } from '../../src/session/match';
import { nextDie } from '../../src/session/random';
import { clickMove } from './qaRecords';

const hotseat = { mode: 'hotseat', level: null, human: null, provenance: 'standard' } as const;
const playfield = (page: Page) => page.getByTestId('playfield');
const cell = (page: Page, square: string) => page.locator(`[data-square="${square}"]`);
const move = (from: string, to: string) => ({ type: 'move', from, to } as const);
const cycle = [move('g1', 'f3'), move('g8', 'f6'), move('f3', 'g1'), move('f6', 'g8')];

async function ready(page: Page) {
  await expect(playfield(page)).toHaveAttribute('data-busy', 'false');
  await expect(playfield(page)).toHaveAttribute('data-animating', 'false');
}

async function open(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('remorse-settings-v1')) {
      localStorage.setItem('remorse-settings-v1', JSON.stringify({ board: '2d', reduce: true }));
    }
  });
  await page.goto('/remorse/');
  await expect(page.getByTestId('mode-ai')).toBeVisible();
}

async function seedBrowser(page: Page, record: MatchRecord, rated = false) {
  const profile: Profile = { ...initialProfile, revision: 1, ratedId: record.id };
  await page.evaluate(async ({ match, profile }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('remorse-v1', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['matches', 'profiles'], 'readwrite');
      tx.objectStore('matches').put(match);
      if (profile) tx.objectStore('profiles').put(profile);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    localStorage.setItem('remorse-view-v1', `game/${match.id}`);
  }, { match: record, profile: rated ? profile : null });
  await page.reload();
  await expect(playfield(page)).toHaveAttribute('data-game-id', record.id);
}

async function readRating(page: Page) {
  return await page.evaluate(async () => await new Promise<{ profile: Profile; count: number }>((resolve, reject) => {
    const request = indexedDB.open('remorse-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['profiles', 'ratingLedger'], 'readonly');
      const profile = tx.objectStore('profiles').get('local');
      const count = tx.objectStore('ratingLedger').count();
      tx.oncomplete = () => { db.close(); resolve({ profile: profile.result, count: count.result }); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}

function walk(start: ReturnType<typeof createMatch>, commands: readonly Command[]) {
  return commands.reduce((game, command) => {
    const source = game.record.config.human && game.record.config.human !== game.state.side ? 'bot' : 'human';
    return game.submit(game.envelope(command), source);
  }, start);
}

function ratedStart(human: Side) {
  return createMatch({
    mode: 'rated', level: 4, human, provenance: 'standard',
    rating: { ratingBefore: 1000, profileRevision: 1, anchor: 1000,
      scaleVersion: RATING_VERSION, engineVersion: ENGINE_VERSION, presetVersion: PRESET_VERSION },
  }, { seed: 102 });
}

async function newGame(page: Page, mode: 'hotseat' | 'rated' | 'practice', black = false) {
  if (mode === 'hotseat') await page.getByTestId('mode-friend').click();
  await page.getByTestId(mode === 'hotseat' ? 'mode-hotseat' : 'mode-ai').click();
  if (mode === 'practice') await page.getByTestId('setup-practice').click();
  if (black) await page.locator('.setup-more > summary').click(); await page.getByTestId('setup-black').click();
  await page.getByTestId('setup-start').click();
  await expect(playfield(page)).toHaveAttribute('data-mode', mode);
}

test('hotseat applies real moves, rejects illegal geometry, restores a bonus and round-trips the save', async ({ page }) => {
  await open(page);
  const seed = Array.from({ length: 100 }, (_, n) => n).find(n => nextDie(n).face === 6)!;
  await seedBrowser(page, createMatch(hotseat, { seed }).record);
  const id = await playfield(page).getAttribute('data-game-id');
  await clickMove(page, 'e2', 'e5');
  await expect(page.getByText('Эта фигура не может попасть на выбранную клетку.')).toBeVisible();
  await expect(playfield(page)).toHaveAttribute('data-revision', '0');
  await cell(page, 'e4').click();
  await expect(playfield(page)).toHaveAttribute('data-turn', '1');
  await clickMove(page, 'd7', 'd5');
  await expect(playfield(page)).toHaveAttribute('data-turn', '2');
  await clickMove(page, 'e4', 'd5');
  await expect(page.getByTestId('roll')).toHaveAttribute('data-face', '6');
  await expect(page.getByTestId('roll')).toHaveAttribute('data-fixed', 'false');
  await expect(playfield(page)).toHaveAttribute('data-phase', 'bonus');
  await expect(page.locator('[data-side="white"] .trophy-group')).toHaveCount(1);
  await expect(page.locator('[data-side="white"] .material')).toHaveText('+1');
  await page.getByTestId('lang-en').click();
  await expect(page.getByTestId('end-turn')).toHaveText('End turn');
  await page.reload();
  await expect(playfield(page)).toHaveAttribute('data-game-id', id!);
  await expect(playfield(page)).toHaveAttribute('data-phase', 'bonus');
  await expect(page.getByTestId('end-turn')).toHaveText('End turn');
  await page.getByTestId('end-turn').click();
  await expect(playfield(page)).toHaveAttribute('data-turn', '3');
  await ready(page);

  await page.getByTestId('settings').click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export game' }).click();
  const path = (await (await download).path())!;
  await page.getByTestId('import-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await expect(page.getByText('Could not read the save. Your current game is still available.')).toBeVisible();
  await expect(playfield(page)).toHaveAttribute('data-game-id', id!);
  await page.getByTestId('settings').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'restored.json', mimeType: 'application/json', buffer: await (await import('node:fs/promises')).readFile(path) });
  await expect(playfield(page)).not.toHaveAttribute('data-game-id', id!);
  await expect(playfield(page)).toHaveAttribute('data-turn', '3');
  await expect(page.locator('[data-side="white"] .trophy-group')).toHaveCount(1);
  await page.getByTestId('undo').click();
  await expect(playfield(page)).toHaveAttribute('data-turn', '2');
  await expect(page.locator('[data-side="white"] .trophy-group')).toHaveCount(0);
  await page.getByTestId('redo').click();
  await expect(playfield(page)).toHaveAttribute('data-turn', '3');
  await expect(page.locator('[data-side="white"] .trophy-group')).toHaveCount(1);
});

test('promotion opens a localized chooser before rolling, then hotseat ends by agreement', async ({ page }) => {
  await open(page);
  const root: GameState = createPosition({ pieces: [
    { side: 'white', type: 'king', square: 'h1' },
    { side: 'black', type: 'king', square: 'h8' },
    { side: 'white', type: 'pawn', square: 'b7' },
    { side: 'black', type: 'rook', square: 'a8' },
    { side: 'black', type: 'pawn', square: 'g6' },
  ] });
  await seedBrowser(page, createMatch(hotseat, { root, seed: 11 }).record);
  await clickMove(page, 'b7', 'a8');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(playfield(page)).toHaveAttribute('data-revision', '0');
  await expect(page.getByTestId('roll')).toHaveCount(0);
  await dialog.getByTestId('lang-en').click();
  await expect(dialog).toHaveAccessibleName('Pawn promotion');
  await dialog.getByTestId('promotion-bishop').click();
  await expect(page.getByTestId('roll')).toHaveAttribute('data-fixed', 'false');
  await expect(cell(page, 'a8')).toHaveAccessibleName(/Bishop, Unafflicted/);
  await expect(page.locator('[data-side="white"] .trophy-group')).toHaveCount(1);
  await ready(page);
  await page.getByRole('button', { name: 'Agree to a draw' }).click();
  await page.getByTestId('confirm-action').click();
  await expect(page.getByTestId('game-result')).toHaveAttribute('data-reason', 'agreement');
});

test('a normal worker answers White and opens when human chooses Black', async ({ page }) => {
  await open(page);
  await newGame(page, 'practice');
  await clickMove(page, 'e2', 'e4');
  await expect(playfield(page)).toHaveAttribute('data-turn', '2');
  await ready(page);
  await expect(playfield(page)).toHaveAttribute('data-active-side', 'white');
  await clickMove(page, 'g1', 'f3');
  await expect(playfield(page)).toHaveAttribute('data-turn', '4');
  await ready(page);
  await page.getByTestId('leave-game').click();
  await newGame(page, 'practice', true);
  await expect(playfield(page)).toHaveAttribute('data-turn', '1');
  await ready(page);
  await expect(playfield(page)).toHaveAttribute('data-active-side', 'black');
  await clickMove(page, 'g8', 'f6');
  await expect(playfield(page)).toHaveAttribute('data-turn', '3');
});

test('undo while a worker is loading rejects its stale reply, then recover from worker failure', async ({ page }) => {
  await open(page);
  await newGame(page, 'practice');
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let attempted = 0;
  await page.route(/\/assets\/search\.worker.*\.js/, async route => {
    attempted++;
    if (attempted === 1) {
      await gate;
      await route.continue().catch(() => undefined);
    } else {
      await route.abort();
    }
  });
  await clickMove(page, 'e2', 'e4');
  await expect.poll(() => attempted).toBe(1);
  await expect(playfield(page)).toHaveAttribute('data-thinking', 'true');
  await page.getByTestId('undo').click();
  await expect(playfield(page)).toHaveAttribute('data-turn', '0');
  release();
  await expect(playfield(page)).toHaveAttribute('data-thinking', 'false');
  await clickMove(page, 'd2', 'd4');
  await expect(page.getByTestId('retry-worker')).toBeVisible();
  await expect.poll(() => attempted).toBe(3);
  await page.unrouteAll({ behavior: 'wait' });
  await page.getByTestId('retry-worker').click();
  await expect(playfield(page)).toHaveAttribute('data-turn', '2');
});

test('rated reservation survives a separate practice match and locks rated controls', async ({ page, context }) => {
  await open(page);
  await newGame(page, 'rated');
  const id = (await playfield(page).getAttribute('data-game-id'))!;
  expect(await readRating(page)).toMatchObject({ profile: { ratedId: id, rating: 1000 }, count: 0 });
  await expect(page.getByTestId('undo')).toHaveCount(0);
  await page.getByTestId('settings').click();
  await expect(page.getByTestId('setup-level')).toHaveCount(0);
  await page.getByTestId('dialog-close').click();
  await clickMove(page, 'e2', 'e4');
  await expect(playfield(page)).toHaveAttribute('data-turn', '2');
  await ready(page);
  await page.getByTestId('leave-game').click();
  const second = await context.newPage();
  await second.goto('/remorse/');
  await second.getByTestId('mode-ai').click();
  await expect(second.getByTestId('setup-start')).toBeDisabled();
  await second.getByTestId('setup-cancel').click();
  await newGame(page, 'practice');
  await expect(playfield(page)).not.toHaveAttribute('data-game-id', id);
  await page.getByTestId('leave-game').click();
  await page.getByTestId('home-resume-rated').click();
  await expect(playfield(page)).toHaveAttribute('data-game-id', id);
  await expect(playfield(page)).toHaveAttribute('data-turn', '2');
  expect(await readRating(page)).toMatchObject({ profile: { ratedId: id, rating: 1000 }, count: 0 });
  await second.close();
});

test('real IndexedDB settles a mate exactly once when two tabs play its final move', async ({ page, context }) => {
  await open(page);
  const prior = walk(ratedStart('black'), [move('f2', 'f3'), move('e7', 'e5'), move('g2', 'g4')]);
  await seedBrowser(page, prior.record, true);
  const second = await context.newPage();
  await second.goto('/remorse/');
  await expect(playfield(second)).toHaveAttribute('data-game-id', prior.record.id);
  await Promise.all([clickMove(page, 'd8', 'h4'), clickMove(second, 'd8', 'h4')]);
  await expect(page.getByTestId('game-result')).toHaveAttribute('data-reason', 'checkmate');
  await expect(second.getByTestId('game-result')).toHaveAttribute('data-reason', 'checkmate');
  await page.reload();
  await expect(page.getByTestId('game-result')).toHaveAttribute('data-reason', 'checkmate');
  await page.getByTestId('lang-en').click();
  await expect(page.getByTestId('game-result')).toContainText('You won');
  expect(await readRating(page)).toMatchObject({ profile: { ratedId: null, rating: 1016, wins: 1 }, count: 1 });
  await second.close();
});

test('genuine rated repetition and resignation settle distinct score outcomes', async ({ page }) => {
  await open(page);
  const before = walk(ratedStart('white'), [...cycle, ...cycle]);
  await seedBrowser(page, before.record, true);
  await page.getByTestId('claim-draw').click();
  await expect(page.getByTestId('game-result')).toHaveAttribute('data-reason', 'repetition');
  expect(await readRating(page)).toMatchObject({ profile: { ratedId: null, rating: 1000, draws: 1 }, count: 1 });
  await page.getByTestId('leave-game').click();
  await newGame(page, 'rated');
  await clickMove(page, 'd2', 'd4');
  await expect(playfield(page)).toHaveAttribute('data-turn', '2');
  await ready(page);
  await page.getByTestId('resign').click();
  await page.getByTestId('confirm-action').click();
  await expect(page.getByTestId('game-result')).toHaveAttribute('data-reason', 'resignation');
  expect(await readRating(page)).toMatchObject({ profile: { ratedId: null, rating: 984, draws: 1, losses: 1 }, count: 2 });
});

test('the same white piece uses a real berserk bonus before the black worker can act', async ({ page }) => {
  await open(page);
  const seed = Array.from({ length: 100 }, (_, n) => n).find(n => {
    const first = nextDie(n);
    return first.face === 6 && nextDie(first.seed).face !== 6;
  })!;
  const initial = createMatch({ mode: 'practice', human: 'white', level: 4, provenance: 'standard' }, { seed });
  const prior = walk(initial, [move('e2', 'e4'), move('d7', 'd5')]);
  await seedBrowser(page, prior.record);
  await clickMove(page, 'e4', 'd5');
  await expect(playfield(page)).toHaveAttribute('data-phase', 'bonus');
  await expect(playfield(page)).toHaveAttribute('data-turn', '2');
  await expect(playfield(page)).toHaveAttribute('data-thinking', 'false');
  await clickMove(page, 'd5', 'd6');
  await expect(playfield(page)).toHaveAttribute('data-turn', '4');
  await expect(playfield(page)).toHaveAttribute('data-active-side', 'white');
});

test('starting a fresh game during a die reveal clears the old board presentation', async ({ page }) => {
  await open(page);
  await page.evaluate(() => localStorage.setItem('remorse-settings-v1', JSON.stringify({ board: '2d', reduce: false })));
  const seed = Array.from({ length: 100 }, (_, n) => n).find(n => nextDie(n).face === 6)!;
  const previous = walk(createMatch(hotseat, { seed }), [move('e2', 'e4'), move('d7', 'd5')]);
  await seedBrowser(page, previous.record);
  await clickMove(page, 'e4', 'd5');
  await expect(playfield(page)).toHaveAttribute('data-animating', 'true');
  await page.getByTestId('leave-game').click();
  await newGame(page, 'hotseat');
  await expect(playfield(page)).not.toHaveAttribute('data-game-id', previous.record.id);
  await expect(playfield(page)).toHaveAttribute('data-turn', '0');
  await expect(playfield(page)).toHaveAttribute('data-phase', 'primary');
  await expect(page.getByTestId('roll')).toHaveCount(0);
  await expect(page.locator('.trophy-group')).toHaveCount(0);
});
