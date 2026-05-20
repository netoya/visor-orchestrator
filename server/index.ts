import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { logger } from 'hono/logger';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import {
  launchPrepare,
  launchConfirm,
  checkCliReachable,
  fulfillWaiter,
} from './operations.js';
import type {
  ConfirmRequest,
  FulfillWaiterRequest,
  ListSessionsFilter,
  ListWaitersFilter,
  PrepareRequest,
  PrepareState,
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

  const orchestratorDir = process.env.ORCHESTRATOR_DIR ?? null;
  let cliReachable = false;
  if (orchestratorDir) {
    try {
      cliReachable = await checkCliReachable();
    } catch {
      cliReachable = false;
    }
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
    orchestrator: {
      dir: orchestratorDir,
      cliReachable,
    },
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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

app.post('/api/flows/prepare', async (c) => {
  let body: Partial<PrepareRequest>;
  try {
    body = await c.req.json<Partial<PrepareRequest>>();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  if (typeof body.idea !== 'string') {
    return c.json({ error: 'idea required (string)' }, 400);
  }
  if (body.idea.length < 20) return c.json({ error: 'idea too short (min 20 chars)' }, 400);
  if (body.idea.length > 8000) return c.json({ error: 'idea too long (max 8000 chars)' }, 400);

  if (body.previousFlowId !== undefined && typeof body.previousFlowId !== 'string') {
    return c.json({ error: 'previousFlowId must be a string' }, 400);
  }
  if (body.answers !== undefined && !isPlainObject(body.answers)) {
    return c.json({ error: 'answers must be a JSON object' }, 400);
  }
  if (body.customResponse !== undefined && typeof body.customResponse !== 'string') {
    return c.json({ error: 'customResponse must be a string' }, 400);
  }

  try {
    const result = await launchPrepare({
      idea: body.idea,
      previousFlowId: body.previousFlowId,
      answers: body.answers,
      customResponse: body.customResponse,
    });
    return c.json({ ...result, status: 'preparing' });
  } catch (err) {
    const msg = (err as Error).message;
    console.error('[POST /api/flows/prepare] spawn failed', msg);
    return c.json({ error: msg }, 500);
  }
});

app.post('/api/flows/confirm', async (c) => {
  let body: Partial<ConfirmRequest>;
  try {
    body = await c.req.json<Partial<ConfirmRequest>>();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  if (typeof body.prepareFlowId !== 'string' || body.prepareFlowId.length === 0) {
    return c.json({ error: 'prepareFlowId required (string)' }, 400);
  }

  try {
    const result = await launchConfirm({ prepareFlowId: body.prepareFlowId });
    return c.json(result);
  } catch (err) {
    const msg = (err as Error).message;
    console.error('[POST /api/flows/confirm] spawn failed', msg);
    return c.json({ error: msg }, 500);
  }
});

app.post('/api/waiters/:id/fulfill', async (c) => {
  const id = c.req.param('id');

  let body: Partial<FulfillWaiterRequest>;
  try {
    body = await c.req.json<Partial<FulfillWaiterRequest>>();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  if (!isPlainObject(body.value)) {
    return c.json({ error: 'value must be a JSON object' }, 400);
  }

  try {
    const result = await fulfillWaiter({ waiterId: id, value: body.value });
    return c.json(result);
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[POST /api/waiters/${id}/fulfill] failed`, msg);
    const low = msg.toLowerCase();
    if (
      low.includes('not found') ||
      low.includes('not waiting') ||
      low.includes('not in waiting') ||
      low.includes('already fulfilled') ||
      low.includes('already rejected')
    ) {
      return c.json({ error: msg }, 409);
    }
    return c.json({ error: msg }, 500);
  }
});

function readPlanFile(orchDir: string, name: 'PLAN-FINAL.md' | 'PLAN-PROPOSAL.md'): string | undefined {
  try {
    return readFileSync(join(orchDir, 'state/conversations', name), 'utf8');
  } catch {
    return undefined;
  }
}

app.get('/api/flows/:id/prepare-state', (c) => {
  const flowId = c.req.param('id');
  const orchDir = process.env.ORCHESTRATOR_DIR ?? null;

  // 1. Waiter pasivo `waiting` del flow → blocked-by-waiter.
  const flowWaiters = listWaiters({ status: 'waiting' }).filter(
    (w) => w.flow_id === flowId && w.mode === 'passive',
  );
  const proposalMd = orchDir ? readPlanFile(orchDir, 'PLAN-PROPOSAL.md') : undefined;
  const finalMd = orchDir ? readPlanFile(orchDir, 'PLAN-FINAL.md') : undefined;

  if (flowWaiters.length > 0) {
    const payload: PrepareState = {
      state: 'blocked-by-waiter',
      waiter: flowWaiters[0],
      proposalMarkdown: proposalMd ?? finalMd,
    };
    return c.json(payload);
  }

  // 2. Estado de la task planner-analyze del flow.
  const db = getDb();
  const taskRow = db
    .prepare(
      `SELECT status FROM tasks
       WHERE flow_id = @id AND stage = 'planner-analyze'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get({ id: flowId }) as { status: string } | undefined;

  if (!taskRow) {
    const payload: PrepareState = {
      state: 'error',
      errorMessage: 'planner-analyze task not found for flow',
    };
    return c.json(payload);
  }

  if (taskRow.status === 'failed' || taskRow.status === 'cancelled') {
    const payload: PrepareState = {
      state: 'error',
      errorMessage: `planner-analyze ${taskRow.status}`,
    };
    return c.json(payload);
  }

  if (taskRow.status === 'done') {
    const payload: PrepareState = {
      state: 'proposal-ready',
      proposalMarkdown: finalMd ?? proposalMd,
    };
    return c.json(payload);
  }

  // queued | ready | running | waiting-waiter (sin waiter pasivo activo)
  const payload: PrepareState = { state: 'preparing' };
  return c.json(payload);
});

serve({ fetch: app.fetch, port: 5176 });

console.log(`[visor-orchestrator] listening on http://localhost:5176 (db: ${getDbInfo().dbPath}, readonly)`);
