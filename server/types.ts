export type FlowStatus = 'queued' | 'running' | 'done' | 'failed' | string;
export type Autonomy = 'L0' | 'L1' | 'L2' | 'L3' | string;

export interface TaskCounts {
  total: number;
  queued: number;
  running: number;
  done: number;
  failed: number;
}

export interface Flow {
  id: string;
  name: string;
  status: FlowStatus;
  autonomy: Autonomy;
  priority: number;
  created_at: string;
  updated_at: string;
  task_counts: TaskCounts;
}

export interface FlowsListFilters {
  status?: string;
  autonomy?: string;
  q?: string;
}

export interface StatusCounts {
  total: number;
  queued: number;
  running: number;
  done: number;
  failed: number;
}

export interface Stats {
  flows_total: number;
  flows_by_status: {
    queued: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
  tasks_total: number;
  tasks_by_status: {
    queued: number;
    ready: number;
    running: number;
    'waiting-waiter': number;
    done: number;
    failed: number;
    cancelled: number;
  };
  tasks_by_agent: Record<string, number>;
  waiters_total: number;
  waiters_by_status: {
    waiting: number;
    fulfilled: number;
    rejected: number;
    timeout: number;
    invalid: number;
  };
  sessions_total: number;
  sessions_alive: number;
  sessions_zombie: number;
  last_24h: {
    flows_created: number;
    tasks_done: number;
    tasks_failed: number;
  };
  /** @deprecated legacy shape — kept opcional para compat con WS y consumidores viejos */
  flows?: StatusCounts;
  /** @deprecated legacy shape — kept opcional para compat con WS y consumidores viejos */
  tasks?: StatusCounts;
}

export interface Health {
  ok: boolean;
  db_path: string;
  db_size_kb: number;
  uptime_s: number;
  node_version: string;
  dispatcher_heartbeat_age_s: number | null;
  db_wal_size_kb: number | null;
  active_waiters_count: number;
}

export type TaskStatus =
  | 'queued'
  | 'ready'
  | 'running'
  | 'waiting-waiter'
  | 'done'
  | 'failed'
  | 'cancelled'
  | string;

export interface Task {
  id: string;
  flow_id: string;
  parent_task_id: string | null;
  stage: string;
  agent_id: string;
  status: TaskStatus;
  input_json: string;
  output_json: string | null;
  retries: number;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  priority: number;
  business_value: number | null;
  estimated_minutes: number | null;
  tags_json: string;
  is_milestone: number;
  depends_on: string | null;
  message: string | null;
}

export interface FlowDetail extends Flow {
  tasks: Task[];
}

export type WsEventHello = { type: 'hello'; ts: string };
export type WsEventStats = { type: 'stats'; payload: Stats };
export type WsEventFlowsChanged = { type: 'flows-changed'; payload: { added: string[]; updated: string[] } };
export type WsEvent = WsEventHello | WsEventStats | WsEventFlowsChanged;

/** executions ordenadas por started_at ASC */
export interface ExecutionSummary {
  id: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  tokens_input: number;
  tokens_output: number;
}

export interface SessionInfo {
  session_id: string;
  strategy: string;
  strategy_key: string;
  created_at: number;
  last_used_at: number;
  turn_count: number;
}

export interface TaskDetail {
  id: string;
  flow_id: string;
  flow_name: string;
  stage: string;
  agent_id: string;
  status: TaskStatus;
  retries: number;
  idempotency_key: string;
  priority: number;
  created_at: number;
  updated_at: number;
  /** output_json puede ser string crudo en tasks viejas; parsear con try/catch */
  input_json: unknown | null;
  /** output_json puede ser string crudo en tasks viejas; parsear con try/catch */
  output_json: unknown | null;
  error: string | null;
  parent_task_id: string | null;
  tags_json: unknown[] | null;
  estimated_minutes: number | null;
  executions: ExecutionSummary[];
  session: SessionInfo | null;
  /** session_action se extrae de output_json._meta.session_action si existe */
  session_action: string | null;
}

/** ConversationMessage.content puede ser string o array (formato Anthropic SDK) */
export interface ConversationMessage {
  role: string;
  content: unknown;
  timestamp?: number;
}

export type ProcessStatus = 'alive' | 'zombie' | 'finished';

export interface ClaudeProcess {
  pid: number;
  etime: string;
  rss_mb: number;
  cpu_pct: number;
  argv_string: string;
  resume_session_id?: string;
}

export interface Session {
  session_id: string;
  agent_id: string;
  flow_id: string;
  flow_name: string;
  task_id: string | null;
  task_stage: string | null;
  turn_count: number;
  last_used_at: number;
  process_status: ProcessStatus;
  jsonl_path?: string;
  jsonl_size_kb?: number;
}

export interface ListSessionsFilter {
  agent_id?: string;
  process_status?: ProcessStatus;
}

export type WaiterMode = 'passive' | 'active';

export type WaiterStatus =
  | 'waiting'
  | 'fulfilled'
  | 'rejected'
  | 'timeout'
  | 'invalid';

export interface WaiterBase {
  id: string;
  flow_id: string;
  flow_name: string | null;
  task_id: string;
  task_stage: string | null;
  step_id: string;
  mode: WaiterMode;
  kind: string;
  prompt: string;
  status: WaiterStatus;
  value_json: any | null;
  timeout_ms: number;
  created_at: number;
  expires_at: number | null;
  expires_in_s: number | null;
  fulfilled_by: string | null;
  fulfilled_at: number | null;
}

export interface WaiterPassive extends WaiterBase {
  mode: 'passive';
  schema_json: string | null;
  available_actions: string[] | null;
  schema_invalid: boolean;
}

export interface WaiterActive extends WaiterBase {
  mode: 'active';
  condition_kind: string | null;
  condition_params: any | null;
  poll_interval_ms: number | null;
  poll_max_attempts: number | null;
  attempts: number;
  last_attempt_at: number | null;
}

export type Waiter = WaiterPassive | WaiterActive;

export interface ListWaitersFilter {
  status?: WaiterStatus;
}

export interface PrepareRequest {
  idea: string;
  previousFlowId?: string;
  answers?: Record<string, unknown>;
  customResponse?: string;
}

export interface ConfirmRequest {
  prepareFlowId: string;
}

export interface FulfillWaiterRequest {
  value: Record<string, unknown>;
}

export type PrepareStateKind =
  | 'preparing'
  | 'proposal-ready'
  | 'blocked-by-waiter'
  | 'error';

export interface PrepareState {
  state: PrepareStateKind;
  proposalMarkdown?: string;
  waiter?: Waiter;
  errorMessage?: string;
}
