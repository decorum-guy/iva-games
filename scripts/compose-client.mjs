import { chessGames } from '../packages/game-registry/src/index.ts'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const files = new Map()

async function collect(directory, prefix = '') {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name
    if (entry.isDirectory()) result.push(...await collect(join(directory, entry.name), relative + '/'))
    else if (entry.isFile()) result.push(relative)
    else throw new Error(`Unexpected non-file build output: ${relative}`)
  }
  return result.sort()
}

// Validate all outputs and all collisions before replacing the combined build.
// Each game remains independently deployable from games/chess/<game>/dist.
for (const registration of chessGames) {
  const game = registration.gameId
  const source = join(root, registration.chess.source, 'dist')
  const entries = await collect(source)
  if (!entries.includes('index.html')) throw new Error(`Build ${game} before composing clients`)
  for (const entry of entries) {
    const destination = entry === 'index.html' ? registration.chess.route.slice(1) + 'index.html' : entry
    const bytes = await readFile(join(source, entry))
    const previous = files.get(destination)
    if (previous && !previous.equals(bytes)) throw new Error(`Conflicting game build outputs: ${destination}`)
    files.set(destination, bytes)
  }
}

// The collection has its own entry. Game assets still share their existing
// origin-relative URLs so saves, rooms and previously loaded resources survive.
const catalogue = join(root, 'apps/portal/chess-home/dist')
const catalogueEntries = await collect(catalogue)
if (!catalogueEntries.includes('index.html')) throw new Error('Build the chess catalogue before composing clients')
for (const entry of catalogueEntries) {
  const bytes = await readFile(join(catalogue, entry))
  const previous = files.get(entry)
  if (previous && !previous.equals(bytes)) throw new Error(`Conflicting chess catalogue build output: ${entry}`)
  files.set(entry, bytes)
}

await mkdir(join(root, '.qa'), { recursive: true })
const staging = await mkdtemp(join(root, '.qa', 'client-compose-'))
try {
  for (const [path, bytes] of files) {
    const target = join(staging, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }
  await rm(join(root, 'dist'), { recursive: true, force: true })
  await rename(staging, join(root, 'dist'))
} finally {
  await rm(staging, { recursive: true, force: true })
}
process.stdout.write(`Composed ${files.size} client files: ${chessGames.map(game => game.gameId + ' ' + game.chess.route).join(', ')}\n`)
