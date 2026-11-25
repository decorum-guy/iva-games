/** Verify the three built workspace layouts over HTTP; this does not run a browser. */
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as pause } from 'node:timers/promises'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = join(root, '.qa', `workspace-migration-${randomUUID().slice(0, 8)}`)
const reportPath = join(directory, 'report.json')
const requestedPort = process.env.WORKSPACE_SMOKE_PORT === undefined ? null : Number(process.env.WORKSPACE_SMOKE_PORT)
if (requestedPort !== null && (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535 || requestedPort === 4173)) {
  throw new Error('WORKSPACE_SMOKE_PORT must be an isolated port from 1024–65535, excluding 4173')
}
const report = { browser: false, sourceState: 'working tree', status: 'running', checks: [], serverBundles: [], layouts: [] }
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const check = (condition, label) => {
  if (!condition) throw new Error(label)
  report.checks.push(label)
}
const request = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(4000) })
let running = null

async function filesUnder(directory, prefix = '') {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix + entry.name
    if (entry.isDirectory()) files.push(...await filesUnder(join(directory, entry.name), path + '/'))
    else if (entry.isFile()) files.push(path)
    else throw new Error(`Unexpected non-file build output: ${path}`)
  }
  return files.sort()
}

function importsIn(source, filename) {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const imports = []
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text)
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      imports.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return imports
}

async function availablePort() {
  if (requestedPort !== null) return requestedPort
  const probe = createServer()
  await new Promise((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  const address = probe.address()
  if (!address || typeof address === 'string') throw new Error('No ephemeral test port')
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()))
  return address.port
}

async function stop() {
  const processToClose = running
  if (!processToClose) return
  running = null
  const { child } = processToClose
  if (child.exitCode !== null || child.signalCode !== null || processToClose.error) return
  child.kill('SIGTERM')
  const grace = Date.now() + 4000
  while (child.exitCode === null && child.signalCode === null && Date.now() < grace) await pause(25)
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    const deadline = Date.now() + 1500
    while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await pause(25)
    if (child.exitCode === null && child.signalCode === null) throw new Error('Test child did not stop after SIGKILL')
  }
}

async function boot(layout) {
  const port = await availablePort()
  const origin = `http://127.0.0.1:${port}`
  const data = join(directory, layout.name)
  await mkdir(data, { recursive: true })
  const database = relative(root, join(data, 'remorse.sqlite'))
  const overdriveDatabase = relative(root, join(data, 'overdrive.sqlite'))
  const child = spawn(process.execPath, layout.workspace ? ['scripts/start.mjs'] : ['dist-server/main.js'], {
    cwd: layout.workspace ? join(root, 'apps/server') : root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'production', PUBLIC_ORIGIN: origin,
      DATABASE_PATH: database, OVERDRIVE_DATABASE_PATH: overdriveDatabase, STATIC_DIR: layout.output },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const state = { child, output: '', error: null }
  running = state
  const collect = bytes => { state.output = (state.output + String(bytes)).slice(-12000) }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  child.on('error', error => { state.error = error })
  const deadline = Date.now() + 8000
  const ready = `REMORSE HTTP/WebSocket listening on 127.0.0.1:${port}`
  while (Date.now() < deadline) {
    if (state.error) throw state.error
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Test server exited: ${state.output}`)
    if (state.output.split(/\r?\n/).includes(ready)) {
      // Only our child can establish readiness; an existing listener is never accepted.
      const health = await request(origin + '/api/health')
      if (!health.ok || child.exitCode !== null || child.signalCode !== null) throw new Error('Test child health check failed')
      const locations = await Promise.all([database, overdriveDatabase].map(path => stat(join(root, path)).catch(() => null)))
      check(locations.every(info => info?.isFile()), `${layout.name}: relative database paths resolve from repository root`)
      return { origin, database, overdriveDatabase, port }
    }
    await pause(50)
  }
  throw new Error(`Test server readiness timeout: ${state.output}`)
}

const mime = {
  '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
}
async function verifyBytes(origin, pathname, expected) {
  const response = await request(new URL(pathname, origin))
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!response.ok || !bytes.equals(expected)) throw new Error(`Production bytes differ: ${pathname} (HTTP ${response.status})`)
  const expectedType = mime[extname(pathname)]
  if (expectedType && !response.headers.get('content-type')?.startsWith(expectedType)) throw new Error(`Wrong MIME for ${pathname}`)
  return bytes
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)=["']([^"']*)["']/g)].map(match => [match[1], match[2]]))
}

async function inspectEntry(layout, result, origin, route, game, expectedEntry, sourceFiles) {
  const expected = await readFile(join(root, layout.output, expectedEntry))
  const html = (await verifyBytes(origin, route, expected)).toString('utf8')
  const expectedTitle = game === 'remorse' ? '<title>REMORSE</title>' : '<title>Форсаж / OVERDRIVE — Chess 2</title>'
  check(html.includes(expectedTitle), `${layout.name}: ${route} serves ${game} entry`)
  const tags = [...html.matchAll(/<(?:script|link)\b[^>]*>/g)].map(match => attributes(match[0]))
  const modules = tags.filter(tag => tag.type === 'module' && tag.src).map(tag => tag.src)
  const styles = tags.filter(tag => tag.rel === 'stylesheet' && tag.href).map(tag => tag.href)
  if (modules.length !== 1 || styles.length === 0) throw new Error(`Missing production module or stylesheet in ${layout.name}:${route}`)
  const dependencies = tags.map(tag => tag.src ?? tag.href).filter(Boolean)
  for (const reference of dependencies) {
    const url = new URL(reference, origin + route)
    if (url.origin !== origin) throw new Error(`External entry dependency: ${url}`)
    const path = decodeURIComponent(url.pathname.slice(1))
    if (!sourceFiles.includes(path)) throw new Error(`Entry dependency missing from ${layout.output}: ${reference}`)
    await verifyBytes(origin, url.pathname, await readFile(join(root, layout.output, path)))
  }
  check(true, `${layout.name}: ${route} module, stylesheet and preload/icon URLs resolve`)
  result.entries.push({ route, game, module: modules[0], styles })
}

await mkdir(directory, { recursive: true })
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  void stop().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143))
})

try {
  const serverFiles = (await filesUnder(join(root, 'dist-server'))).filter(path => path.endsWith('.js'))
  if (!serverFiles.includes('main.js')) throw new Error('Build the production server before running workspace smoke')
  for (const file of serverFiles) {
    const bytes = await readFile(join(root, 'dist-server', file))
    const imports = importsIn(bytes.toString('utf8'), file)
    check(imports.every(specifier => !specifier.startsWith('@chess-2/') && !/\.tsx?(?:[?#]|$)/.test(specifier)
      && !(specifier.startsWith('.') && /(?:^|\/)src\//.test(specifier))), `server ${file}: no workspace or TypeScript source imports`)
    report.serverBundles.push({ file, bytes: bytes.length, sha256: sha256(bytes), imports })
  }
  const gameFiles = Object.fromEntries(await Promise.all(['remorse', 'overdrive'].map(async game => [game, await filesUnder(join(root, 'games', 'chess', game, 'dist'))])))
  const workers = Object.fromEntries(Object.entries(gameFiles).map(([game, files]) => [game, files.filter(path => /(?:^|\/)search\.worker-[\w-]+\.js$/.test(path))]))
  check(Object.values(workers).every(files => files.length === 1) && workers.remorse[0] !== workers.overdrive[0], 'games emit distinct search Worker bundles')

  const layouts = [
    { name: 'combined', output: 'dist', games: ['remorse', 'overdrive'], workspace: false,
      entries: [['/', 'remorse', 'index.html'], ['/overdrive/', 'overdrive', 'overdrive/index.html']] },
    { name: 'standalone-remorse', output: 'games/chess/remorse/dist', games: ['remorse'], workspace: true,
      entries: [['/', 'remorse', 'index.html']] },
    { name: 'standalone-overdrive', output: 'games/chess/overdrive/dist', games: ['overdrive'], workspace: true,
      entries: [['/', 'overdrive', 'index.html'], ['/overdrive/', 'overdrive', 'index.html']] },
  ]
  for (const layout of layouts) {
    const result = { name: layout.name, output: layout.output, launch: layout.workspace ? 'server workspace launcher' : 'root production entry',
      files: [], entries: [], workers: [], databasePaths: [] }
    report.layouts.push(result)
    try {
      const { origin, database, overdriveDatabase, port } = await boot(layout)
      result.port = port
      result.databasePaths = [database, overdriveDatabase]
      const files = await filesUnder(join(root, layout.output))
      for (const [route, game, entry] of layout.entries) await inspectEntry(layout, result, origin, route, game, entry, files)
      for (const file of files) {
        const path = '/' + file.split('/').map(encodeURIComponent).join('/')
        const expected = await readFile(join(root, layout.output, file))
        const bytes = await verifyBytes(origin, path, expected)
        result.files.push({ file, bytes: bytes.length, sha256: sha256(bytes) })
        if (extname(file) === '.css') {
          for (const match of bytes.toString('utf8').matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)) {
            if (match[1].startsWith('data:')) continue
            const url = new URL(match[1], origin + path)
            const target = decodeURIComponent(url.pathname.slice(1))
            if (url.origin !== origin || !files.includes(target)) throw new Error(`Unresolved CSS asset ${match[1]} in ${file}`)
          }
        }
      }
      check(true, `${layout.name}: all ${files.length} emitted files match HTTP bytes and CSS asset references resolve`)
      const expectedWorkers = layout.games.flatMap(game => workers[game]).sort()
      const actualWorkers = files.filter(file => /(?:^|\/)search\.worker-[\w-]+\.js$/.test(file)).sort()
      check(JSON.stringify(actualWorkers) === JSON.stringify(expectedWorkers), `${layout.name}: only its games' Worker bundles are present`)
      for (const game of layout.games) {
        const worker = workers[game][0]
        const ownBytes = await readFile(join(root, 'games', 'chess', game, 'dist', worker))
        const servedBytes = await verifyBytes(origin, '/' + worker, ownBytes)
        const entry = result.entries.find(entry => entry.game === game)
        const module = await readFile(join(root, layout.output, new URL(entry.module, origin).pathname.slice(1)), 'utf8')
        if (!module.includes(basename(worker))) throw new Error(`${game} entry does not reference its Worker bundle`)
        result.workers.push({ game, file: worker, sha256: sha256(servedBytes) })
      }
      check(true, `${layout.name}: entry modules reference the correct intact Worker bundles`)
      if (layout.games.length === 1) {
        const other = layout.games[0] === 'remorse' ? 'overdrive' : 'remorse'
        const forbidden = other === 'overdrive' ? ['overdrive.svg', 'assets/overdrive/models/king.glb'] : ['remorse.svg', 'assets/chess/chess_set_1k.gltf', 'assets/audio/board.wav']
        for (const file of forbidden) {
          if (files.includes(file) || (await request(origin + '/' + file)).status !== 404) throw new Error(`${layout.name} contains unrelated ${other} asset ${file}`)
        }
        check(true, `${layout.name}: unrelated ${other} production assets absent`)
      }
      for (const pathname of ['/assets/missing.glb', '/assets/does-not-exist', '/overdrive/missing.js']) {
        const response = await request(origin + pathname)
        if (response.status !== 404 || !response.headers.get('content-type')?.startsWith('application/json')) throw new Error(`Missing asset returned HTML: ${pathname}`)
      }
      check(true, `${layout.name}: missing assets return 404`)
      for (const [path, protocol] of [['/api/health', 'remorse-online-v1'], ['/api/overdrive/health', 'overdrive-online-v1']]) {
        const response = await request(origin + path)
        const health = await response.json()
        if (!response.ok || health.ok !== true || health.protocol !== protocol) throw new Error(`Health failed for ${path}`)
      }
      check(true, `${layout.name}: both independent API health endpoints respond`)
      result.status = 'passed'
    } finally {
      if (running) result.serverOutput = running.output
      await stop()
    }
  }
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.error = error instanceof Error ? error.stack : String(error)
  process.exitCode = 1
} finally {
  await stop()
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
}
const verifiedFiles = report.layouts.reduce((count, layout) => count + layout.files.length, 0)
process.stdout.write(`Workspace smoke ${report.status}: ${report.checks.length} checks, ${verifiedFiles} HTTP file comparisons across ${report.layouts.length} layouts.\nReport: ${reportPath}\n`)
if (report.error) process.stderr.write(report.error + '\n')
