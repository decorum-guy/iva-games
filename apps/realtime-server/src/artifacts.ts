/** Retain exact simulation code for active saves across ordinary image changes. */
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

interface ArtifactManifest { format: 1; artifactId: string; files: string[] }
const relativeFile = /^(?:assets\/)?[A-Za-z0-9_.-]+\.js$/;
function flush(path: string): void { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
function digest(directory: string, files: string[]): string {
  const hasher = createHash('sha256');
  for (const file of files) {
    if (!relativeFile.test(file) || !lstatSync(join(directory, file)).isFile()) throw new Error('INVALID_RUNTIME_ARTIFACT');
    hasher.update(file); hasher.update(readFileSync(join(directory, file)));
  }
  return 'sha256:' + hasher.digest('hex');
}
function artifactPath(root: string, artifactId: string): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(artifactId)) throw new Error('UNSUPPORTED_SAVED_RUNTIME');
  return resolve(root, artifactId.slice(7));
}
export function retainedWorkerDirectory(root: string, artifactId: string): URL {
  const directory = artifactPath(root, artifactId);
  if (!lstatSync(directory).isDirectory() || !lstatSync(join(directory, 'package.json')).isFile() ||
    readFileSync(join(directory, 'package.json'), 'utf8') !== '{"type":"module"}\n') throw new Error('INVALID_RUNTIME_ARTIFACT');
  const manifest: unknown = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('INVALID_RUNTIME_ARTIFACT');
  const value = manifest as ArtifactManifest;
  if (value.format !== 1 || value.artifactId !== artifactId || !Array.isArray(value.files) || value.files.length > 128 ||
    new Set(value.files).size !== value.files.length || !value.files.includes('simulation-worker.js') ||
    value.files.some(file => typeof file !== 'string' || !relativeFile.test(file)) || digest(directory, value.files) !== artifactId) throw new Error('INVALID_RUNTIME_ARTIFACT');
  return pathToFileURL(directory + '/');
}
export function retainRuntimeArtifact(source: URL, root: string): { artifactId: string; workerDirectory: URL } {
  const directory = fileURLToPath(source);
  const files = ['main.js', 'simulation-worker.js', 'store-worker.js', ...readdirSync(join(directory, 'assets')).filter(name => name.endsWith('.js')).sort().map(name => 'assets/' + name)];
  const artifactId = digest(directory, files), target = artifactPath(root, artifactId);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (!existsSync(target)) {
    const temporary = join(root, '.pending-' + randomUUID()); mkdirSync(temporary, { mode: 0o700 });
    try {
      for (const file of files) { mkdirSync(dirname(join(temporary, file)), { recursive: true, mode: 0o700 }); copyFileSync(join(directory, file), join(temporary, file)); flush(join(temporary, file)); }
      writeFileSync(join(temporary, 'package.json'), '{"type":"module"}\n', { mode: 0o600 });
      writeFileSync(join(temporary, 'manifest.json'), JSON.stringify({ format: 1, artifactId, files } satisfies ArtifactManifest), { mode: 0o600 });
      if (digest(temporary, files) !== artifactId) throw new Error('INVALID_RUNTIME_ARTIFACT');
      flush(join(temporary, 'package.json')); flush(join(temporary, 'manifest.json')); flush(join(temporary, 'assets')); flush(temporary);
    } catch (error) { rmSync(temporary, { recursive: true, force: true }); throw error; }
    try { renameSync(temporary, target); }
    catch (error) { rmSync(temporary, { recursive: true, force: true }); if (!existsSync(target)) throw error; }
    flush(root);
  }
  return { artifactId, workerDirectory: retainedWorkerDirectory(root, artifactId) };
}
