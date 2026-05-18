import Database from 'better-sqlite3';
import { statSync } from 'node:fs';

const DEFAULT_DB_PATH = '/home/angel/projects/autonomous-orchestrator/state/orchestrator.db';

function resolveDbPath(): string {
  return process.env.ORCHESTRATOR_DB_PATH ?? DEFAULT_DB_PATH;
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db === null) {
    const dbPath = resolveDbPath();
    _db = new Database(dbPath, { readonly: true, fileMustExist: true });
  }
  return _db;
}

export function getDbInfo(): { dbPath: string; sizeKb: number; writable: boolean } {
  const dbPath = resolveDbPath();
  const sizeKb = statSync(dbPath).size / 1024;
  return { dbPath, sizeKb, writable: false };
}
