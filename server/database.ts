import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { roomSchema } from '../shared/protocol.js';

/**
 * SQLite VACUUM INTO reads a consistent snapshot, including committed WAL data.
 * The destination must be new; restore must be run with the application stopped.
 */
export function snapshotDatabase(sourcePath: string, destinationPath: string) {
  const source = resolve(sourcePath);
  const destination = resolve(destinationPath);
  if (!existsSync(source)) throw new Error('Source database does not exist.');
  if ([destination, `${destination}-wal`, `${destination}-shm`].some(existsSync)) {
    throw new Error('Destination database or WAL files already exist. Use a new destination.');
  }
  mkdirSync(dirname(destination), { recursive: true });
  const db = new DatabaseSync(source, { readOnly: true });
  let created = false;
  try {
    db.exec('PRAGMA busy_timeout=5000;');
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (version !== 1) throw new Error('Unsupported database schema.');
    const integrity = db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('Database integrity check failed.');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database foreign key check failed.');
    for (const row of db.prepare('SELECT snapshot FROM rooms').all() as { snapshot: string }[]) {
      roomSchema.parse(JSON.parse(row.snapshot));
    }
    created = true;
    db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
  } catch (error) {
    if (created) rmSync(destination, { force: true });
    throw error;
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [operation, source, destination, ...extra] = process.argv.slice(2);
  if (!['backup', 'restore'].includes(operation) || !source || !destination || extra.length) {
    console.error('Usage: node build/server/database.js backup|restore SOURCE NEW_DESTINATION');
    process.exitCode = 1;
  } else {
    try {
      snapshotDatabase(source, destination);
      console.log(JSON.stringify({ event: operation === 'backup' ? 'backup_complete' : 'restore_complete' }));
    } catch {
      console.error(JSON.stringify({ event: 'database_snapshot_failed', message: 'Check source compatibility and permissions; destination must not exist. Stop the application before restore.' }));
      process.exitCode = 1;
    }
  }
}
