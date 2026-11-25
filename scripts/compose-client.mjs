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

// Validate both outputs and all collisions before replacing the combined build.
// Each game remains independently deployable from games/<game>/dist.
for (const game of ['remorse', 'overdrive']) {
  const source = join(root, 'games', game, 'dist')
  const entries = await collect(source)
  if (!entries.includes('index.html')) throw new Error(`Build ${game} before composing clients`)
  for (const entry of entries) {
    const destination = game === 'overdrive' && entry === 'index.html' ? 'overdrive/index.html' : entry
    const bytes = await readFile(join(source, entry))
    const previous = files.get(destination)
    if (previous && !previous.equals(bytes)) throw new Error(`Conflicting game build outputs: ${destination}`)
    files.set(destination, bytes)
  }
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
process.stdout.write(`Composed ${files.size} client files: REMORSE / and OVERDRIVE /overdrive/\n`)
