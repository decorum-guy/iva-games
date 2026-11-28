import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { retainClientContent, retainedClientDirectory } from '../src/content';
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
it('pins every client file and keeps its prior bytes after a new build', () => {
  const root = mkdtempSync(join(tmpdir(), 'iva-client-content-')); directories.push(root);
  const source = join(root, 'source'), archive = join(root, 'archive'); mkdirSync(join(source, 'assets'), { recursive: true });
  writeFileSync(join(source, 'index.html'), '<script src="./assets/game.js"></script>'); writeFileSync(join(source, 'assets/game.js'), '// client v1 fixture');
  const first = retainClientContent(source, archive); expect(retainClientContent(source, archive).contentId).toBe(first.contentId);
  writeFileSync(join(source, 'assets/game.js'), '// client v2 fixture'); const next = retainClientContent(source, archive);
  expect(next.contentId).not.toBe(first.contentId);
  expect(readFileSync(join(retainedClientDirectory(archive, first.contentId), 'assets/game.js'), 'utf8')).toBe('// client v1 fixture');
  expect(readFileSync(join(next.directory, 'assets/game.js'), 'utf8')).toBe('// client v2 fixture');
  expect(() => retainedClientDirectory(archive, '../outside')).toThrow('UNSUPPORTED_CLIENT_CONTENT');
});
