/** Verify the public game's effective profile against this release's rules. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TERRITORY_CONTENT, TERRITORY_RULES } from '../games/district/src/territorial/types.ts';

export const expectedDistrictProfile = Object.freeze({
  rulesVersion: TERRITORY_RULES,
  contentVersion: TERRITORY_CONTENT,
});

export async function checkLiveCatalogue(origin) {
  const base = new URL(origin);
  assert.ok(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password,
    'Use an HTTP(S) origin without credentials');
  const response = await fetch(new URL('/api/platform/v1/games', base), {
    signal: AbortSignal.timeout(10_000), redirect: 'error',
    headers: { Accept: 'application/json' },
  });
  assert.equal(response.status, 200, 'The public catalogue must return HTTP 200');
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  const { games } = await response.json();
  assert.ok(Array.isArray(games), 'The public catalogue must list games');
  const district = games.find(game => game.gameId === 'district');
  assert.ok(district, 'District must be registered');
  assert.equal(district.status, 'available', 'District must be available');
  assert.equal(district.supportsBots, true, 'District must support bots');
  assert.deepEqual({ rulesVersion: district.rulesVersion, contentVersion: district.contentVersion },
    expectedDistrictProfile, 'The public District profile must match the delivered release');
  return { origin: base.origin, gameId: 'district', ...expectedDistrictProfile };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.info(JSON.stringify({ catalogue: 'verified', ...await checkLiveCatalogue(process.argv[2] ?? 'https://iva-games.pro') }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
