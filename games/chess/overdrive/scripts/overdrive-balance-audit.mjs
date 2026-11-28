// Reproducible actual-core self-play. Bulk results remain in ignored .qa.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'

if (!isMainThread) {
  const { runAuditGame } = await import(pathToFileURL(workerData.engine).href)
  parentPort.on('message', job => {
    try {
      const result = runAuditGame(job, ply => { if (ply % 50 === 0) parentPort.postMessage({ progress: { id: job.id, ply } }) })
      result.summary.engineSha256 = workerData.engineSha256
      result.summary.deterministicReplaySha256 = createHash('sha256').update(JSON.stringify({ options: job, commands: result.commands, finalState: result.finalState })).digest('hex')
      const json = JSON.stringify(result)
      writeFileSync(resolve(workerData.output, `${job.id}.json`), json)
      parentPort.postMessage({ summary: { ...result.summary, artifactSha256: createHash('sha256').update(json).digest('hex') } })
    } catch (error) { parentPort.postMessage({ error: String(error.stack ?? error), id: job.id }) }
  })
} else {
  const args = new Map(process.argv.slice(2).map(a => { const split = a.indexOf('='); return split < 0 ? [a, true] : [a.slice(0, split), a.slice(split + 1)] }))
  const integer = (key, fallback) => {
    const value = Number(args.get(`--${key}`) ?? fallback)
    if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid ${key}`)
    return value
  }
  const repository = fileURLToPath(new URL('../../../../', import.meta.url))
  const output = resolve(repository, String(args.get('--output') ?? '.qa/overdrive-energy-v2-audit'))
  const openings = integer('openings', 12), seeds = integer('seeds', 1), workers = integer('workers', 4)
  if (openings > 12) throw new Error('Only 12 opening tapes are defined')
  const nodeCap = integer('nodes', 1400), maxDepth = integer('depth', 3), maxPly = integer('plies', 300)
  const temperature = Number(args.get('--temperature') ?? .1)
  if (!Number.isFinite(temperature) || temperature < 0) throw new Error('Invalid temperature')
  const openingPlies = Number(args.get('--opening-plies') ?? 8)
  if (!Number.isInteger(openingPlies) || openingPlies < 0 || openingPlies > 8) throw new Error('Invalid opening-plies')
  mkdirSync(output, { recursive: true })
  execFileSync(process.execPath, [resolve(repository, 'node_modules/vite/bin/vite.js'), 'build', '--ssr', 'src/engine/balance-audit.ts', '--outDir', `${output}/engine`, '--emptyOutDir'], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit' })
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim()
  const engineSha256 = createHash('sha256').update(readFileSync(`${output}/engine/balance-audit.js`)).digest('hex')
  const versions = String(args.get('--version') ?? 'overdrive-v1,overdrive-v2').split(',')
  if (versions.some(v => !['overdrive-v1', 'overdrive-v2', 'overdrive-v3'].includes(v))) throw new Error('Invalid version')
  const jobs = []
  for (let opening = 0; opening < openings; opening++) for (let sample = 0; sample < seeds; sample++) for (const swap of [false, true]) for (const rulesVersion of versions) {
    const seed = 26112601 + opening * 1000 + sample * 2
    jobs.push({ id: `${rulesVersion}-o${opening + 1}-s${sample + 1}-${swap ? 'ba' : 'ab'}`, rulesVersion, opening, seed, swap, nodeCap, maxDepth, maxPly, temperature, ...(openingPlies !== 8 ? { openingPlies } : {}) })
  }
  const summaries = [], pending = [], active = new Set()
  for (const job of jobs) {
    const path = resolve(output, `${job.id}.json`)
    if (args.has('--resume') && existsSync(path)) {
      const json = readFileSync(path, 'utf8'), previous = JSON.parse(json)
      if (JSON.stringify(previous.summary.options) !== JSON.stringify(job)) throw new Error(`Resume options changed: ${job.id}`)
      if (previous.summary.engineSha256 !== engineSha256) throw new Error(`Resume engine changed: ${job.id}; use a new output directory`)
      summaries.push({ ...previous.summary, artifactSha256: createHash('sha256').update(json).digest('hex') })
    } else pending.push(job)
  }
  const started = Date.now()
  const save = () => writeFileSync(resolve(output, 'summary.json'), JSON.stringify({ sourceCommit, engineSha256, settings: { openings, seeds, workers, nodeCap, maxDepth, maxPly, temperature, openingPlies }, expectedGames: jobs.length, completedGames: summaries.length, summaries: [...summaries].sort((a, b) => a.options.id.localeCompare(b.options.id)) }, null, 2))
  save()
  await new Promise((finish, reject) => {
    if (!pending.length) return finish()
    const assign = worker => {
      const job = pending.shift()
      if (job) worker.postMessage(job)
      else { active.delete(worker); void worker.terminate(); if (!active.size) finish() }
    }
    const workerCount = Math.min(workers, pending.length)
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { engine: `${output}/engine/balance-audit.js`, engineSha256, output } })
      active.add(worker)
      worker.on('error', reject)
      worker.on('message', message => {
        if (message.error) { for (const running of active) void running.terminate(); reject(new Error(message.error)); return }
        if (message.progress) { process.stdout.write(`${JSON.stringify(message)}\n`); return }
        summaries.push(message.summary); save()
        const s = message.summary
        process.stdout.write(`${JSON.stringify({ completed: summaries.length, total: jobs.length, id: s.options.id, plies: s.plies, outcome: s.outcome, depth: s.stats.depth, seconds: Math.round((Date.now() - started) / 1000) })}\n`)
        assign(worker)
      })
      assign(worker)
    }
  })
  save()
}
