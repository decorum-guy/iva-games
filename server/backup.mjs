import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const source = resolve(process.env.DATABASE_PATH ?? 'data/remorse.sqlite');
const target = process.argv[2] && resolve(process.argv[2]);
if (!target || target === source || existsSync(target)) {
  throw new Error('Pass a new backup filename, different from the live database. Existing files are never overwritten.');
}
const database = new Database(source, { readonly: true, fileMustExist: true });
try {
  await database.backup(target);
  console.log('SQLite backup created: ' + target);
} finally { database.close(); }
