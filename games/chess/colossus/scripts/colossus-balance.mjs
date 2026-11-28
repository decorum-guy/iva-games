// Reproducible positional games. Full logs stay ignored; these are not human win-rate estimates.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const output = resolve(repository, '.qa/colossus-balance');
mkdirSync(output, { recursive: true });
execFileSync(process.execPath, [resolve(repository, 'node_modules/vite/bin/vite.js'), 'build', '--ssr', 'src/engine/balance.ts', '--outDir', `${output}/engine`, '--emptyOutDir'], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit' });
const { playBalanceGame } = await import(pathToFileURL(`${output}/engine/balance.js`).href);
const quick = process.argv.includes('--quick');
const campaignOnly = process.argv.includes('--campaign-only');
const summaries = [];
const configurations = [];
if (!campaignOnly) for (const boss of ['regent', 'spire', 'archivist']) for (const difficulty of quick ? ['knight'] : ['knight', 'veteran']) for (const bossCards of [false, true]) {
  configurations.push({ boss, difficulty, bossCards, seed: 26011, nodeCap: quick ? 100 : 300 });
}
if (!quick || campaignOnly) configurations.push({ boss: 'regent', difficulty: 'knight', bossCards: true, mode: 'campaign', seed: 26011, nodeCap: 300 });
for (const options of configurations) {
  const result = playBalanceGame(options);
  const name = options.mode === 'campaign' ? 'campaign-knight' : `${options.boss}-${options.difficulty}-${options.bossCards ? 'cards' : 'base'}`;
  writeFileSync(`${output}/${name}.json`, JSON.stringify(result, null, 2));
  const summary = Object.fromEntries(Object.entries(result).filter(([key]) => !['log', 'finalState'].includes(key)));
  summaries.push(summary);
  writeFileSync(`${output}/summary.json`, JSON.stringify({ method: 'Real positional transitions using public-current-phase SDK policy. No human calibration.', summaries }, null, 2));
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}
