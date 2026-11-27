import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chessGames, gameRegistry } from '../packages/game-registry/src/index.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
for (const game of chessGames) {
  const packageFile = JSON.parse(await readFile(resolve(root, game.chess.source, 'package.json'), 'utf8'));
  if (packageFile.name !== game.chess.workspace || !packageFile.scripts?.build) throw new Error(`Missing/mismatched build workspace for ${game.gameId}`);
}
process.stdout.write(`Validated ${gameRegistry.games.length} catalogue registrations and ${chessGames.length} chess builds.\n`);
