// Tipos inferidos de los handlers del servidor visor en
// /home/angel/projects/visor-orchestrator/server/index.ts y
// /home/angel/projects/visor-orchestrator/server/queries.ts (tipos canonicos en
// server/types.ts). El servidor expone /api en puerto 5176 y consume la DB
// SQLite del autonomous-orchestrator en modo readonly.
//
// Convencion de timestamps: el backend devuelve unix epoch en MILISEGUNDOS
// (number), no strings ISO. La UI debe humanizarlos en cliente.

// ---------------------------------------------------------------------------
// Enums / discriminadores
// ---------------------------------------------------------------------------

export type FlowStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'completed'
  | 'cancelled'
  | (string & {});

export type Autonomy = 'L0' | 'L1' | 'L2' | 'L3' | (string & {});

export type TaskStatus =
  | 'queued'
  | 'ready'
  | 'running'
  | 'waiting-waiter'
  | 'done'
  | 'failed'
  | 'cancelled'
  | (string & {});

export type ProcessStatus = 'alive' | 'zombie' | 'finished';

export type WaiterMode = 'passive' | 'active';

export type WaiterStatus =
  | 'waiting'
  | 'fulfilled'
  | 'rejected'
  | 'timeout'
  | 'invalid';

// ---------------------------------------------------------------------------
// GET /api/flows  ->  { flows: FlowSummary[] }
// ---------------------------------------------------------------------------

export interface TaskCounts {
  total: number;
  queued: number;
  running: number;
  done: number;
  failed: number;
}

// Nota: el backend usa `id` (no `flow_id`). created_at/updated_at son epoch ms.
export interface FlowSummary {
  id: string;
  name: string;
  status: FlowStatus;
  autonomy: Autonomy;
  priority: number;
  created_at: number;
  updated_at: number;
  task_counts: TaskCounts;
}

export interface FlowsListResponse {
  flows: FlowSummary[];
}

// ---------------------------------------------------------------------------
// GET /api/flows/:id/detail  ->  FlowDetail  (objeto plano, NO envuelto)
// ---------------------------------------------------------------------------

// Task tal como vuelve dentro de FlowDetail.tasks (SELECT * FROM tasks).
// Las columnas *_json se devuelven como string crudo en este endpoint
// (a diferencia de /api/tasks/:id que parsea); el cliente decide si parsea.
export interface FlowTask {
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
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
  error: string | null;
  priority: number;
  business_value: number | null;
  estimated_minutes: number | null;
  tags_json: string;
  is_milestone: number;
  depends_on: string | null;
  message: string | null;
}

export interface FlowDetail extends FlowSummary {
  tasks: FlowTask[];
}

// El handler responde 404 con { error: 'flow not found' } si no existe.

// ---------------------------------------------------------------------------
// GET /api/tasks/:id/conversation  ->  { messages: ConversationMessage[] }
// ---------------------------------------------------------------------------

// content puede ser string plano o array (formato Anthropic SDK con bloques
// text/tool_use/tool_result). La UI debe manejar ambos casos.
export interface ConversationMessage {
  role: string;
  content: unknown;
  timestamp?: number;
}

export interface TaskConversationResponse {
  messages: ConversationMessage[];
}

// ---------------------------------------------------------------------------
// GET /api/sessions  ->  { sessions: Session[] }
// ---------------------------------------------------------------------------

// El backend NO devuelve pid: process_status se computa correlacionando
// procesos del SO contra session_id/task_id. last_used_at es epoch ms y
// reemplaza al "started_at" mencionado en algunos AC.
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

export interface SessionsListResponse {
  sessions: Session[];
}

// ---------------------------------------------------------------------------
// GET /api/waiters?status=<WaiterStatus>  ->  { waiters: Waiter[] }
// ---------------------------------------------------------------------------

// value_json viene parseado por el server (unknown), no como string.
// expires_in_s solo es no-null cuando status === 'waiting'.
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
  value_json: unknown | null;
  timeout_ms: number;
  created_at: number;
  expires_at: number | null;
  expires_in_s: number | null;
  fulfilled_by: string | null;
  fulfilled_at: number | null;
}

// Waiter pasivo: schema_json se devuelve como string crudo + available_actions
// pre-parseados por el server desde properties.action.enum (o keys de
// properties). schema_invalid indica si el server no pudo parsear el schema.
export interface WaiterPassive extends WaiterBase {
  mode: 'passive';
  schema_json: string | null;
  available_actions: string[] | null;
  schema_invalid: boolean;
}

// Waiter activo: condition_params viene parseado (unknown).
export interface WaiterActive extends WaiterBase {
  mode: 'active';
  condition_kind: string | null;
  condition_params: unknown | null;
  poll_interval_ms: number | null;
  poll_max_attempts: number | null;
  attempts: number;
  last_attempt_at: number | null;
}

export type Waiter = WaiterPassive | WaiterActive;

export interface WaitersListResponse {
  waiters: Waiter[];
}

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

// Todos los endpoints devuelven { error: string } en status >= 400.
export interface ApiError {
  error: string;
}
