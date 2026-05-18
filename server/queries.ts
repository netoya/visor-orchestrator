import { getDb } from './db.js';
import { readConversationMessages } from './conversation.js';
import { listClaudeProcesses } from './processes.js';
import type {
  ClaudeProcess,
  ConversationMessage,
  ExecutionSummary,
  Flow,
  FlowDetail,
  FlowsListFilters,
  ListSessionsFilter,
  ListWaitersFilter,
  ProcessStatus,
  Session,
  SessionInfo,
  Stats,
  Task,
  TaskDetail,
  Waiter,
  WaiterActive,
  WaiterMode,
  WaiterPassive,
  WaiterStatus,
} from './types.js';

function safeParseJson(raw: string | null | undefined, fallback: unknown): unknown {
  if (raw === null || raw === undefined) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function extractSessionAction(parsedOutput: unknown): string | null {
  if (!parsedOutput || typeof parsedOutput !== 'object') return null;
  const meta = (parsedOutput as Record<string, unknown>)._meta;
  if (!meta || typeof meta !== 'object') return null;
  const action = (meta as Record<string, unknown>).session_action;
  return typeof action === 'string' ? action : null;
}

interface FlowRow {
  id: string;
  name: string;
  status: string;
  autonomy: string;
  priority: number | null;
  created_at: number;
  updated_at: number;
  task_total: number;
  task_queued: number;
  task_running: number;
  task_done: number;
  task_failed: number;
}

export function listFlows(filters: FlowsListFilters = {}): Flow[] {
  const db = getDb();
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters.status !== undefined) {
    where.push('f.status = @status');
    params.status = filters.status;
  }
  if (filters.autonomy !== undefined) {
    where.push('f.autonomy = @autonomy');
    params.autonomy = filters.autonomy;
  }
  if (filters.q !== undefined) {
    where.push('LOWER(f.name) LIKE LOWER(@q)');
    params.q = `%${filters.q}%`;
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const sql = `
    SELECT
      f.id,
      f.name,
      f.status,
      f.autonomy,
      f.created_at,
      f.updated_at,
      COALESCE(MAX(t.priority), 0) AS priority,
      COUNT(t.id) AS task_total,
      SUM(CASE WHEN t.status = 'queued'  THEN 1 ELSE 0 END) AS task_queued,
      SUM(CASE WHEN t.status = 'running' THEN 1 ELSE 0 END) AS task_running,
      SUM(CASE WHEN t.status = 'done'    THEN 1 ELSE 0 END) AS task_done,
      SUM(CASE WHEN t.status = 'failed'  THEN 1 ELSE 0 END) AS task_failed
    FROM flows f
    LEFT JOIN tasks t ON t.flow_id = f.id
    ${whereClause}
    GROUP BY f.id
    ORDER BY f.updated_at DESC
  `;

  const stmt = db.prepare(sql);
  const rows = (where.length > 0 ? stmt.all(params) : stmt.all()) as FlowRow[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    autonomy: r.autonomy,
    priority: r.priority ?? 0,
    created_at: r.created_at,
    updated_at: r.updated_at,
    task_counts: {
      total: r.task_total ?? 0,
      queued: r.task_queued ?? 0,
      running: r.task_running ?? 0,
      done: r.task_done ?? 0,
      failed: r.task_failed ?? 0,
    },
  })) as unknown as Flow[];
}

export function getFlowDetail(id: string): FlowDetail | null {
  const db = getDb();

  const flowSql = `
    SELECT
      f.id,
      f.name,
      f.status,
      f.autonomy,
      f.created_at,
      f.updated_at,
      COALESCE(MAX(t.priority), 0) AS priority,
      COUNT(t.id) AS task_total,
      SUM(CASE WHEN t.status = 'queued'  THEN 1 ELSE 0 END) AS task_queued,
      SUM(CASE WHEN t.status = 'running' THEN 1 ELSE 0 END) AS task_running,
      SUM(CASE WHEN t.status = 'done'    THEN 1 ELSE 0 END) AS task_done,
      SUM(CASE WHEN t.status = 'failed'  THEN 1 ELSE 0 END) AS task_failed
    FROM flows f
    LEFT JOIN tasks t ON t.flow_id = f.id
    WHERE f.id = @id
    GROUP BY f.id
  `;

  const row = db.prepare(flowSql).get({ id }) as FlowRow | undefined;
  if (!row) return null;

  const flow = {
    id: row.id,
    name: row.name,
    status: row.status,
    autonomy: row.autonomy,
    priority: row.priority ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
    task_counts: {
      total: row.task_total ?? 0,
      queued: row.task_queued ?? 0,
      running: row.task_running ?? 0,
      done: row.task_done ?? 0,
      failed: row.task_failed ?? 0,
    },
  } as unknown as Flow;

  const tasks = db
    .prepare(
      'SELECT * FROM tasks WHERE flow_id = @id ORDER BY priority DESC, created_at ASC',
    )
    .all({ id }) as unknown as Task[];

  return { ...flow, tasks };
}

interface StatusCountRow {
  status: string;
  n: number;
}

function sumValues(m: Map<string, number>): number {
  let total = 0;
  for (const v of m.values()) total += v;
  return total;
}

interface AgentCountRow {
  agent_id: string | null;
  n: number;
}

interface CountRow {
  n: number;
}

export async function getStats(): Promise<Stats> {
  const db = getDb();

  const flowRows = db
    .prepare('SELECT status, COUNT(*) AS n FROM flows GROUP BY status')
    .all() as StatusCountRow[];
  const taskRows = db
    .prepare('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status')
    .all() as StatusCountRow[];
  const waiterRows = db
    .prepare('SELECT status, COUNT(*) AS n FROM waiters GROUP BY status')
    .all() as StatusCountRow[];

  const flowMap = new Map(flowRows.map((r) => [r.status, r.n]));
  const taskMap = new Map(taskRows.map((r) => [r.status, r.n]));
  const waiterMap = new Map(waiterRows.map((r) => [r.status, r.n]));

  const flows_total = sumValues(flowMap);
  const tasks_total = sumValues(taskMap);
  const waiters_total = sumValues(waiterMap);

  const agentRows = db
    .prepare(
      `SELECT agent_id, COUNT(*) AS n
       FROM tasks
       WHERE agent_id IS NOT NULL AND agent_id <> ''
       GROUP BY agent_id`,
    )
    .all() as AgentCountRow[];

  const tasks_by_agent: Record<string, number> = {};
  for (const r of agentRows) {
    if (r.agent_id) tasks_by_agent[r.agent_id] = r.n;
  }

  // sessions: no hay columna status estatica en agent_sessions.
  // Reutilizamos listSessions() que computa process_status (alive/zombie/finished)
  // correlacionando procesos del SO. Para satisfacer INV-S4
  // (sessions_total == sessions_alive + sessions_zombie), agrupamos finished bajo zombie.
  let sessions_total = 0;
  let sessions_alive = 0;
  let sessions_zombie = 0;
  try {
    const sessions = await listSessions();
    sessions_total = sessions.length;
    sessions_alive = sessions.filter((s) => s.process_status === 'alive').length;
    sessions_zombie = sessions_total - sessions_alive;
  } catch (err) {
    console.warn('[queries.getStats] sessions enumeration failed:', (err as Error).message);
  }

  // last_24h: el esquema de tasks no tiene finished_at; usamos updated_at como proxy.
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  const flowsCreated24h = db
    .prepare('SELECT COUNT(*) AS n FROM flows WHERE created_at >= @cutoff')
    .get({ cutoff }) as CountRow | undefined;
  const tasksDone24h = db
    .prepare(
      "SELECT COUNT(*) AS n FROM tasks WHERE status = 'done' AND updated_at >= @cutoff",
    )
    .get({ cutoff }) as CountRow | undefined;
  const tasksFailed24h = db
    .prepare(
      "SELECT COUNT(*) AS n FROM tasks WHERE status = 'failed' AND updated_at >= @cutoff",
    )
    .get({ cutoff }) as CountRow | undefined;

  return {
    flows_total,
    flows_by_status: {
      queued: flowMap.get('queued') ?? 0,
      running: flowMap.get('running') ?? 0,
      completed: flowMap.get('completed') ?? 0,
      failed: flowMap.get('failed') ?? 0,
      cancelled: flowMap.get('cancelled') ?? 0,
    },
    tasks_total,
    tasks_by_status: {
      queued: taskMap.get('queued') ?? 0,
      ready: taskMap.get('ready') ?? 0,
      running: taskMap.get('running') ?? 0,
      'waiting-waiter': taskMap.get('waiting-waiter') ?? 0,
      done: taskMap.get('done') ?? 0,
      failed: taskMap.get('failed') ?? 0,
      cancelled: taskMap.get('cancelled') ?? 0,
    },
    tasks_by_agent,
    waiters_total,
    waiters_by_status: {
      waiting: waiterMap.get('waiting') ?? 0,
      fulfilled: waiterMap.get('fulfilled') ?? 0,
      rejected: waiterMap.get('rejected') ?? 0,
      timeout: waiterMap.get('timeout') ?? 0,
      invalid: waiterMap.get('invalid') ?? 0,
    },
    sessions_total,
    sessions_alive,
    sessions_zombie,
    last_24h: {
      flows_created: flowsCreated24h?.n ?? 0,
      tasks_done: tasksDone24h?.n ?? 0,
      tasks_failed: tasksFailed24h?.n ?? 0,
    },
    // Legacy shape (deprecated). Conservado para compat con consumidores viejos / WS.
    flows: {
      total: flows_total,
      queued: flowMap.get('queued') ?? 0,
      running: flowMap.get('running') ?? 0,
      done: flowMap.get('completed') ?? 0,
      failed: flowMap.get('failed') ?? 0,
    },
    tasks: {
      total: tasks_total,
      queued: taskMap.get('queued') ?? 0,
      running: taskMap.get('running') ?? 0,
      done: taskMap.get('done') ?? 0,
      failed: taskMap.get('failed') ?? 0,
    },
  };
}

interface TaskDetailRow {
  id: string;
  flow_id: string;
  flow_name: string | null;
  stage: string;
  agent_id: string;
  status: string;
  retries: number;
  idempotency_key: string;
  priority: number;
  created_at: number;
  updated_at: number;
  input_json: string | null;
  output_json: string | null;
  error: string | null;
  parent_task_id: string | null;
  tags_json: string | null;
  estimated_minutes: number | null;
}

interface ExecutionRow {
  id: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  tokens_input: number;
  tokens_output: number;
}

interface SessionRow {
  session_id: string;
  strategy: string;
  strategy_key: string;
  created_at: number;
  last_used_at: number;
  turn_count: number;
}

export function taskExists(taskId: string): boolean {
  const db = getDb();
  const row = db
    .prepare('SELECT 1 AS x FROM tasks WHERE id = @id LIMIT 1')
    .get({ id: taskId }) as { x: number } | undefined;
  return row !== undefined;
}

export function getTaskDetail(taskId: string): TaskDetail | null {
  const db = getDb();

  const row = db
    .prepare(
      `SELECT
         t.id,
         t.flow_id,
         f.name AS flow_name,
         t.stage,
         t.agent_id,
         t.status,
         t.retries,
         t.idempotency_key,
         t.priority,
         t.created_at,
         t.updated_at,
         t.input_json,
         t.output_json,
         t.error,
         t.parent_task_id,
         t.tags_json,
         t.estimated_minutes
       FROM tasks t
       LEFT JOIN flows f ON f.id = t.flow_id
       WHERE t.id = @id`,
    )
    .get({ id: taskId }) as TaskDetailRow | undefined;

  if (!row) return null;

  const inputParsed = safeParseJson(row.input_json, null);

  let outputParsed: unknown;
  if (row.output_json === null || row.output_json === undefined) {
    outputParsed = null;
  } else {
    outputParsed = safeParseJson(row.output_json, null);
  }

  const tagsParsed = safeParseJson(row.tags_json, []);
  const tags: unknown[] = Array.isArray(tagsParsed) ? tagsParsed : [];

  const executionRows = db
    .prepare(
      `SELECT id, started_at, finished_at, status, tokens_input, tokens_output
       FROM executions
       WHERE task_id = @id
       ORDER BY started_at ASC`,
    )
    .all({ id: taskId }) as ExecutionRow[];

  const executions: ExecutionSummary[] = executionRows.map((e) => ({
    id: e.id,
    started_at: e.started_at,
    finished_at: e.finished_at ?? null,
    status: e.status,
    tokens_input: e.tokens_input ?? 0,
    tokens_output: e.tokens_output ?? 0,
  }));

  const sessionRow = db
    .prepare(
      `SELECT session_id, strategy, strategy_key, created_at, last_used_at, turn_count
       FROM agent_sessions
       WHERE task_id = @id
       ORDER BY last_used_at DESC
       LIMIT 1`,
    )
    .get({ id: taskId }) as SessionRow | undefined;

  const session: SessionInfo | null = sessionRow
    ? {
        session_id: sessionRow.session_id,
        strategy: sessionRow.strategy,
        strategy_key: sessionRow.strategy_key,
        created_at: sessionRow.created_at,
        last_used_at: sessionRow.last_used_at,
        turn_count: sessionRow.turn_count,
      }
    : null;

  const session_action = extractSessionAction(outputParsed);

  return {
    id: row.id,
    flow_id: row.flow_id,
    flow_name: row.flow_name ?? '',
    stage: row.stage,
    agent_id: row.agent_id,
    status: row.status,
    retries: row.retries,
    idempotency_key: row.idempotency_key,
    priority: row.priority,
    created_at: row.created_at,
    updated_at: row.updated_at,
    input_json: inputParsed,
    output_json: outputParsed,
    error: row.error ?? null,
    parent_task_id: row.parent_task_id ?? null,
    tags_json: tags,
    estimated_minutes: row.estimated_minutes ?? null,
    executions,
    session,
    session_action,
  };
}

interface SessionListRow {
  session_id: string;
  agent_id: string;
  flow_id: string;
  task_id: string | null;
  turn_count: number;
  last_used_at: number;
  flow_name: string | null;
  task_status: string | null;
  task_stage: string | null;
}

function correlateProcess(
  procs: ClaudeProcess[],
  sessionId: string,
  taskId: string | null,
): boolean {
  const resumeNeedle = `--resume ${sessionId}`;
  for (const p of procs) {
    if (p.argv_string.includes(resumeNeedle)) return true;
    if (taskId && p.argv_string.includes(taskId)) return true;
  }
  return false;
}

export async function listSessions(
  filter: ListSessionsFilter = {},
): Promise<Session[]> {
  const db = getDb();
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (filter.agent_id !== undefined && filter.agent_id !== '') {
    where.push('a.agent_id = @agent_id');
    params.agent_id = filter.agent_id;
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const sql = `
    SELECT
      a.session_id,
      a.agent_id,
      a.flow_id,
      a.task_id,
      a.turn_count,
      a.last_used_at,
      f.name AS flow_name,
      t.status AS task_status,
      t.stage AS task_stage
    FROM agent_sessions a
    LEFT JOIN flows f ON f.id = a.flow_id
    LEFT JOIN tasks t ON t.id = a.task_id
    ${whereClause}
    ORDER BY a.last_used_at DESC
  `;

  const stmt = db.prepare(sql);
  const rows = (where.length > 0 ? stmt.all(params) : stmt.all()) as SessionListRow[];

  const hasRunning = rows.some((r) => r.task_status === 'running');
  let procs: ClaudeProcess[] = [];
  if (hasRunning) {
    try {
      procs = await listClaudeProcesses();
    } catch (err) {
      console.warn('[queries.listSessions] process scan failed:', (err as Error).message);
      procs = [];
    }
  }

  const sessions: Session[] = rows.map((r) => {
    let process_status: ProcessStatus;
    if (r.task_status === 'running') {
      process_status = correlateProcess(procs, r.session_id, r.task_id) ? 'alive' : 'zombie';
    } else {
      process_status = 'finished';
    }

    return {
      session_id: r.session_id,
      agent_id: r.agent_id,
      flow_id: r.flow_id,
      flow_name: r.flow_name ?? '',
      task_id: r.task_id ?? null,
      task_stage: r.task_stage ?? null,
      turn_count: r.turn_count,
      last_used_at: r.last_used_at,
      process_status,
    };
  });

  if (filter.process_status !== undefined) {
    return sessions.filter((s) => s.process_status === filter.process_status);
  }
  return sessions;
}

interface WaiterRow {
  id: string;
  flow_id: string;
  task_id: string;
  step_id: string;
  mode: string;
  kind: string;
  prompt: string;
  schema_json: string | null;
  timeout_ms: number;
  created_at: number;
  expires_at: number | null;
  status: string;
  value_json: string | null;
  attempts: number;
  last_attempt_at: number | null;
  fulfilled_by: string | null;
  fulfilled_at: number | null;
  condition_kind: string | null;
  condition_params_json: string | null;
  poll_interval_ms: number | null;
  poll_max_attempts: number | null;
  flow_name: string | null;
  task_stage: string | null;
}

function parseAvailableActions(schemaJson: string | null): {
  available_actions: string[] | null;
  schema_invalid: boolean;
} {
  if (schemaJson === null || schemaJson === undefined) {
    return { available_actions: null, schema_invalid: true };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(schemaJson);
  } catch {
    return { available_actions: null, schema_invalid: true };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { available_actions: null, schema_invalid: true };
  }
  const props = (parsed as Record<string, unknown>).properties;
  if (!props || typeof props !== 'object' || Array.isArray(props)) {
    return { available_actions: [], schema_invalid: false };
  }
  const action = (props as Record<string, unknown>).action;
  if (action && typeof action === 'object' && !Array.isArray(action)) {
    const enumVal = (action as Record<string, unknown>).enum;
    if (Array.isArray(enumVal) && enumVal.length > 0) {
      return {
        available_actions: enumVal.map((v) => String(v)),
        schema_invalid: false,
      };
    }
  }
  return {
    available_actions: Object.keys(props as Record<string, unknown>),
    schema_invalid: false,
  };
}

export function listWaiters(filter: ListWaitersFilter = {}): Waiter[] {
  const db = getDb();
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (filter.status !== undefined) {
    where.push('w.status = @status');
    params.status = filter.status;
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const sql = `
    SELECT
      w.id,
      w.flow_id,
      w.task_id,
      w.step_id,
      w.mode,
      w.kind,
      w.prompt,
      w.schema_json,
      w.timeout_ms,
      w.created_at,
      w.expires_at,
      w.status,
      w.value_json,
      w.attempts,
      w.last_attempt_at,
      w.fulfilled_by,
      w.fulfilled_at,
      w.condition_kind,
      w.condition_params_json,
      w.poll_interval_ms,
      w.poll_max_attempts,
      f.name AS flow_name,
      t.stage AS task_stage
    FROM waiters w
    LEFT JOIN tasks t ON w.task_id = t.id
    LEFT JOIN flows f ON w.flow_id = f.id
    ${whereClause}
    ORDER BY w.created_at DESC
  `;

  const stmt = db.prepare(sql);
  const rows = (where.length > 0 ? stmt.all(params) : stmt.all()) as WaiterRow[];

  const now = Date.now();

  return rows.map((r): Waiter => {
    const mode = (r.mode === 'active' ? 'active' : 'passive') as WaiterMode;
    const status = r.status as WaiterStatus;

    const expires_in_s =
      status === 'waiting' && r.expires_at !== null && r.expires_at !== undefined
        ? Math.floor((r.expires_at - now) / 1000)
        : null;

    let valueParsed: unknown = null;
    if (r.value_json !== null && r.value_json !== undefined) {
      try {
        valueParsed = JSON.parse(r.value_json);
      } catch {
        valueParsed = r.value_json;
      }
    }

    if (mode === 'passive') {
      const { available_actions, schema_invalid } = parseAvailableActions(r.schema_json);
      const passive: WaiterPassive = {
        id: r.id,
        flow_id: r.flow_id,
        flow_name: r.flow_name ?? null,
        task_id: r.task_id,
        task_stage: r.task_stage ?? null,
        step_id: r.step_id,
        mode: 'passive',
        kind: r.kind,
        prompt: r.prompt,
        status,
        value_json: valueParsed,
        timeout_ms: r.timeout_ms,
        created_at: r.created_at,
        expires_at: r.expires_at,
        expires_in_s,
        fulfilled_by: r.fulfilled_by ?? null,
        fulfilled_at: r.fulfilled_at ?? null,
        schema_json: r.schema_json ?? null,
        available_actions,
        schema_invalid,
      };
      return passive;
    }

    let conditionParams: unknown = null;
    if (r.condition_params_json !== null && r.condition_params_json !== undefined) {
      try {
        conditionParams = JSON.parse(r.condition_params_json);
      } catch {
        conditionParams = null;
      }
    }

    const active: WaiterActive = {
      id: r.id,
      flow_id: r.flow_id,
      flow_name: r.flow_name ?? null,
      task_id: r.task_id,
      task_stage: r.task_stage ?? null,
      step_id: r.step_id,
      mode: 'active',
      kind: r.kind,
      prompt: r.prompt,
      status,
      value_json: valueParsed,
      timeout_ms: r.timeout_ms,
      created_at: r.created_at,
      expires_at: r.expires_at,
      expires_in_s,
      fulfilled_by: r.fulfilled_by ?? null,
      fulfilled_at: r.fulfilled_at ?? null,
      condition_kind: r.condition_kind ?? null,
      condition_params: conditionParams,
      poll_interval_ms: r.poll_interval_ms ?? null,
      poll_max_attempts: r.poll_max_attempts ?? null,
      attempts: r.attempts ?? 0,
      last_attempt_at: r.last_attempt_at ?? null,
    };
    return active;
  });
}

export function getTaskConversation(taskId: string): ConversationMessage[] {
  const db = getDb();
  const sessionRow = db
    .prepare(
      `SELECT session_id
       FROM agent_sessions
       WHERE task_id = @id
       ORDER BY last_used_at DESC
       LIMIT 1`,
    )
    .get({ id: taskId }) as { session_id: string } | undefined;

  if (!sessionRow) return [];
  return readConversationMessages(sessionRow.session_id);
}
