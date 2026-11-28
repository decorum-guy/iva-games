import { readFile } from 'node:fs/promises';
const registry = JSON.parse(await readFile(new URL('./game-registry.json', import.meta.url), 'utf8'));
const paths = registry.games.flatMap(game => game.chess?.health ? [game.chess.health.path] : []);
if (!paths.length) process.exit(1);
try {
  const responses = await Promise.all(paths.map(path => fetch('http://127.0.0.1:' + (process.env.PORT || '4173') + path, { signal: AbortSignal.timeout(3000) })));
  if (responses.some(response => !response.ok)) process.exit(1);
} catch { process.exit(1); }
