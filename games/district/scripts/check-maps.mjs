import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateDistrictMapCatalog } from '../src/map-schema.ts';

const directory = new URL('../maps/', import.meta.url);
const files = readdirSync(directory).filter(name => name.endsWith('.json')).sort();
const maps = validateDistrictMapCatalog(files.map(name => JSON.parse(readFileSync(new URL(name, directory), 'utf8'))));
for (let i = 0; i < files.length; i++) {
  if (files[i] !== `${maps[i].id}.${maps[i].version}.json`) throw new Error(`Rename ${files[i]} to ${maps[i].id}.${maps[i].version}.json.`);
}
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--base' || !/^[A-Za-z0-9_./-]+$/.test(args[1]) || args[1].startsWith('-'))) throw new Error('Usage: check-maps.mjs [--base main]');
if (args.length) {
  const cwd = fileURLToPath(new URL('../../../', directory));
  const prefix = 'games/district/maps/';
  const olderFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', args[1], '--', prefix], { cwd, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  for (const path of olderFiles) {
    const previous = execFileSync('git', ['show', `${args[1]}:${path}`], { cwd, encoding: 'utf8' });
    const current = readFileSync(new URL(path.slice(prefix.length), directory), 'utf8');
    if (previous !== current) throw new Error(`${path} is already published. Add a new version instead of changing it.`);
  }
}
console.info(`Validated ${maps.length} District maps: ${maps.map(map => `${map.id}@${map.version}`).join(', ')}. Geometry checks are not balance evidence.`);
