// Real local SDK self-play. Keep output in .qa; never publish bulk game artifacts.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const quick = process.argv.includes('--quick')
const repository = fileURLToPath(new URL('../../../', import.meta.url))
const output = resolve(repository, '.qa/overdrive-balance')
mkdirSync(output, { recursive: true })
execFileSync(process.execPath, [resolve(repository, 'node_modules/vite/bin/vite.js'), 'build', '--ssr', 'src/engine/balance.ts', '--outDir', `${output}/engine`, '--emptyOutDir'], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit' })
const { playBalanceGame } = await import(pathToFileURL(`${output}/engine/balance.js`).href)
const pairings = [
  { whiteLevel: 10, blackLevel: 4, seed: 81001 }, { whiteLevel: 4, blackLevel: 10, seed: 81001 },
  { whiteLevel: 10, blackLevel: 7, seed: 81002 }, { whiteLevel: 7, blackLevel: 10, seed: 81002 },
  { whiteLevel: 10, blackLevel: 9, seed: 81003 }, { whiteLevel: 9, blackLevel: 10, seed: 81003 },
]
const summaries = []
for (const [index, pairing] of pairings.entries()) {
  const options = { ...pairing, maxPly: quick ? 80 : 180, openingPly: 4, ...(quick ? { nodeCap: 500, timeCapMs: 150 } : {}) }
  const result = playBalanceGame(options, ply => { if (ply % 20 === 0) process.stdout.write(`Game ${index + 1}: ${ply} plies\n`) })
  writeFileSync(`${output}/game-${index + 1}.json`, JSON.stringify(result, null, 2))
  const summary = Object.fromEntries(Object.entries(result).filter(([key]) => !['log', 'finalState', 'actionKeys'].includes(key)))
  summaries.push(summary)
  writeFileSync(`${output}/summary.json`, JSON.stringify({ quick, summaries }, null, 2))
  process.stdout.write(`${JSON.stringify({ game: index + 1, ...summary })}\n`)
}
