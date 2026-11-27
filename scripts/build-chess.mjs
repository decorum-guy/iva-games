import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chessGames } from '../packages/game-registry/src/index.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
for (const game of chessGames) {
  process.stdout.write(`Building ${game.gameId} at ${game.chess.route}\n`);
  const child = promisify(execFile)('npm', ['run', 'build', '--workspace', game.chess.workspace], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
  const result = await child;
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
}
