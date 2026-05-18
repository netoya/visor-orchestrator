import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import type Database from 'better-sqlite3';

export interface HealthExtras {
  dispatcher_heartbeat_age_s: number | null;
  db_wal_size_kb: number | null;
  active_waiters_count: number;
}

interface CountRow {
  c: number;
}

export async function getHealthExtras(
  db: Database.Database,
  dbPath: string,
): Promise<HealthExtras> {
  const heartbeatPath = join(dirname(dbPath), '.heartbeat');
  let dispatcher_heartbeat_age_s: number | null = null;
  try {
    const stat = await fs.stat(heartbeatPath);
    const ageS = Math.floor((Date.now() - stat.mtimeMs) / 1000);
    dispatcher_heartbeat_age_s = ageS < 0 ? 0 : ageS;
  } catch {
    dispatcher_heartbeat_age_s = null;
  }

  const walPath = dbPath + '-wal';
  let db_wal_size_kb: number | null = null;
  try {
    const stat = await fs.stat(walPath);
    db_wal_size_kb = Math.round(stat.size / 1024);
  } catch {
    db_wal_size_kb = null;
  }

  let active_waiters_count = 0;
  try {
    const row = db
      .prepare('SELECT COUNT(*) AS c FROM waiters WHERE status = ?')
      .get('waiting') as CountRow | undefined;
    active_waiters_count = row?.c ?? 0;
  } catch (err) {
    console.warn('[health.getHealthExtras] waiters count failed:', (err as Error).message);
    active_waiters_count = 0;
  }

  return { dispatcher_heartbeat_age_s, db_wal_size_kb, active_waiters_count };
}
