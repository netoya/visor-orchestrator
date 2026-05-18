import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { logger } from 'hono/logger';
import { getDb, getDbInfo } from './db.js';
import { getHealthExtras } from './health.js';
import {
  listFlows,
  getFlowDetail,
  getStats,
  getTaskDetail,
  getTaskConversation,
  listSessions,
  listWaiters,
  taskExists,
} from './queries.js';
import type {
  ListSessionsFilter,
  ListWaitersFilter,
  ProcessStatus,
  WaiterStatus,
} from './types.js';

const WAITER_STATUSES: readonly WaiterStatus[] = [
  'waiting',
  'fulfilled',
  'rejected',
  'timeout',
  'invalid',
];
// ws-stream cancelado (fuera de scope MVP, decision de Angel)

const START_TIME = Date.now();

getDb();

const app = new Hono();

app.use('*', logger());

app.get('/api/health', async (c) => {
  const uptime_s = Math.floor((Date.now() - START_TIME) / 1000);
  let dbPath = '';
  let dbSizeKb: number | null = 0;
  let ok = false;
  let extras = {
    dispatcher_heartbeat_age_s: null as number | null,
    db_wal_size_kb: null as number | null,
    active_waiters_count: 0,
  };

  try {
    const info = getDbInfo();
    dbPath = info.dbPath;
    dbSizeKb = info.sizeKb;
    const db = getDb();
    // Verifica que la DB responde (INV-H1).
    db.prepare('SELECT 1 AS x').get();
    ok = true;
    extras = await getHealthExtras(db, dbPath);
  } catch (err) {
    console.error('[GET /api/health] db check failed', err);
    ok = false;
  }

  return c.json({
    ok,
    db_path: dbPath,
    db_size_kb: dbSizeKb ?? 0,
    db_writable: false,
    uptime_s,
    node_version: process.version,
    build_hash: 'dev',
    dispatcher_heartbeat_age_s: extras.dispatcher_heartbeat_age_s,
    db_wal_size_kb: extras.db_wal_size_kb,
    active_waiters_count: extras.active_waiters_count,
  });
});

app.get('/api/flows', (c) => {
  const status = c.req.query('status');
  const autonomy = c.req.query('autonomy');
  const q = c.req.query('q');
  const flows = listFlows({ status, autonomy, q });
  return c.json({ flows });
});

app.get('/api/flows/:id/detail', (c) => {
  const id = c.req.param('id');
  const detail = getFlowDetail(id);
  if (!detail) return c.json({ error: 'flow not found' }, 404);
  return c.json(detail);
});

app.get('/api/stats', async (c) => {
  try {
    const stats = await getStats();
    return c.json(stats);
  } catch (err) {
    console.error('[GET /api/stats] internal error', err);
    return c.json({ error: 'internal error' }, 500);
  }
});

app.get('/api/tasks/:id', (c) => {
  const id = c.req.param('id');
  try {
    const task = getTaskDetail(id);
    if (!task) return c.json({ error: 'task not found' }, 404);
    return c.json(task);
  } catch (err) {
    console.error(`[GET /api/tasks/${id}] internal error`, err);
    return c.json({ error: 'internal error' }, 500);
  }
});

app.get('/api/sessions', async (c) => {
  try {
    const agent = c.req.query('agent')?.trim();
    const status = c.req.query('status')?.trim();

    const filter: ListSessionsFilter = {};
    if (agent) filter.agent_id = agent;
    if (status === 'alive' || status === 'zombie' || status === 'finished') {
      filter.process_status = status as ProcessStatus;
    }

    const sessions = await listSessions(filter);
    return c.json({ sessions });
  } catch (err) {
    console.error('[GET /api/sessions] internal error', err);
    return c.json({ error: (err as Error).message }, 500);
  }
});

app.get('/api/waiters', (c) => {
  try {
    const rawStatus = c.req.query('status')?.trim();
    const filter: ListWaitersFilter = {};
    if (rawStatus) {
      if (!WAITER_STATUSES.includes(rawStatus as WaiterStatus)) {
        return c.json({ error: 'invalid status' }, 400);
      }
      filter.status = rawStatus as WaiterStatus;
    }
    const waiters = listWaiters(filter);
    return c.json({ waiters });
  } catch (err) {
    console.error('[GET /api/waiters] internal error', err);
    return c.json({ error: 'internal error' }, 500);
  }
});

app.get('/api/tasks/:id/conversation', (c) => {
  const id = c.req.param('id');
  try {
    if (!taskExists(id)) return c.json({ error: 'task not found' }, 404);
    const messages = getTaskConversation(id);
    return c.json({ messages });
  } catch (err) {
    console.error(`[GET /api/tasks/${id}/conversation] internal error`, err);
    return c.json({ error: 'internal error' }, 500);
  }
});

serve({ fetch: app.fetch, port: 5176 });

console.log(`[visor-orchestrator] listening on http://localhost:5176 (db: ${getDbInfo().dbPath}, readonly)`);
