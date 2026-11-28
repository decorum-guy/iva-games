/** Content-addressed public assets; saved games retain the client that created them. */
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
const safeName = /^(?!\.)(?!.*(?:^|\/)\.\.?\/)[A-Za-z0-9_./-]+$/;
const verified = new Map<string, string>();
function flush(path: string): void { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
function inventory(root: string, prefix = ''): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (!safeName.test(name)) throw new Error('INVALID_CLIENT_CONTENT');
    if (entry.isDirectory()) files.push(...inventory(root, name + '/'));
    else if (entry.isFile()) files.push(name);
    else throw new Error('INVALID_CLIENT_CONTENT');
  }
  return files.sort();
}
function identity(directory: string, files: string[]): string {
  return 'sha256:' + createHash('sha256').update(JSON.stringify(files.map(file => {
    if (!safeName.test(file) || !lstatSync(join(directory, file)).isFile()) throw new Error('INVALID_CLIENT_CONTENT');
    return [file, createHash('sha256').update(readFileSync(join(directory, file))).digest('hex')];
  }))).digest('hex');
}
export function retainedClientDirectory(root: string, contentId: string): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(contentId)) throw new Error('UNSUPPORTED_CLIENT_CONTENT');
  const directory = resolve(root, contentId.slice(7)), cacheKey = directory + ':' + contentId;
  if (verified.has(cacheKey)) return verified.get(cacheKey)!;
  if (!lstatSync(directory).isDirectory()) throw new Error('INVALID_CLIENT_CONTENT');
  const manifest: unknown = JSON.parse(readFileSync(join(directory, '_content-manifest.json'), 'utf8'));
  if (!manifest || typeof manifest !== 'object' || !('files' in manifest) || !Array.isArray(manifest.files) ||
    manifest.files.length > 10_000 || !manifest.files.includes('index.html') || new Set(manifest.files).size !== manifest.files.length ||
    manifest.files.some(file => typeof file !== 'string' || !safeName.test(file)) || identity(directory, manifest.files) !== contentId) throw new Error('INVALID_CLIENT_CONTENT');
  verified.set(cacheKey, directory); return directory;
}
export function retainClientContent(source: string, root: string): { contentId: string; directory: string } {
  const files = inventory(source); if (!files.includes('index.html')) throw new Error('CLIENT_BUILD_REQUIRED');
  const contentId = identity(source, files), target = resolve(root, contentId.slice(7)); mkdirSync(root, { recursive: true, mode: 0o700 });
  if (!existsSync(target)) {
    const temporary = join(root, '.pending-' + randomUUID()); mkdirSync(temporary, { mode: 0o700 });
    try {
      const directories = new Set([temporary]);
      for (const file of files) {
        const destination = join(temporary, file); mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
        copyFileSync(join(source, file), destination); flush(destination); directories.add(dirname(destination));
      }
      if (identity(temporary, files) !== contentId) throw new Error('INVALID_CLIENT_CONTENT');
      writeFileSync(join(temporary, '_content-manifest.json'), JSON.stringify({ format: 1, contentId, files }), { mode: 0o600 });
      flush(join(temporary, '_content-manifest.json')); for (const directory of directories) flush(directory);
      try { renameSync(temporary, target); } catch (error) { if (!existsSync(target)) throw error; }
      flush(root);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  }
  return { contentId, directory: retainedClientDirectory(root, contentId) };
}
