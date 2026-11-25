// Actual deterministic tactical probes, kept separate from full-game evidence.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const repository = fileURLToPath(new URL('../../../../', import.meta.url))
const output = resolve(repository, '.qa/overdrive-balance-probes')
mkdirSync(output, { recursive: true })
execFileSync(process.execPath, [resolve(repository, 'node_modules/vite/bin/vite.js'), 'build', '--ssr', 'src/engine/balance-probes.ts', '--outDir', `${output}/engine`, '--emptyOutDir'], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit' })
const engine = `${output}/engine/balance-probes.js`
const { runBalanceProbes } = await import(pathToFileURL(engine).href)
const result = {
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  engineSha256: createHash('sha256').update(readFileSync(engine)).digest('hex'),
  ...runBalanceProbes(),
}
writeFileSync(`${output}/results.json`, JSON.stringify(result, null, 2))
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
