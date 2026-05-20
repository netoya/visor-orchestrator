// src/api.js
// API client wrapper para el backend del visor (http://localhost:5176).
// Definiciones de tipos via JSDoc para evitar build de TS.
// Las firmas reflejan los endpoints definidos en server/index.ts y los
// tipos exportados desde server/types.ts.

/** Base URL del backend del visor.
 *  En el dev server (vite) las rutas /api/* las proxea el bundler hacia
 *  http://localhost:5176 (vite.config.js). Por eso usamos ruta relativa.
 */
export const API_BASE = '';

const BASE = API_BASE;

// ---------------------------------------------------------------------------
// Typedefs auxiliares
// ---------------------------------------------------------------------------

/**
 * Diccionario generico de conteos indexados por clave string.
 * Se usa para shapes como `tasks_by_agent` cuyas claves no son fijas.
 * @typedef {Object<string, number>} CountByKey
 */

/**
 * Conteos de tareas asociadas a un flow.
 * @typedef {Object} TaskCounts
 * @property {number} total
 * @property {number} queued
 * @property {number} running
 * @property {number} done
 * @property {number} failed
 */

/**
 * Estado de un flow. El backend acepta cualquier string, pero estos son los valores conocidos.
 * @typedef {'queued'|'running'|'done'|'failed'|string} FlowStatus
 */

/**
 * Nivel de autonomia.
 * @typedef {'L0'|'L1'|'L2'|'L3'|string} Autonomy
 */

/**
 * Estado de una task.
 * @typedef {'queued'|'ready'|'running'|'waiting-waiter'|'done'|'failed'|'cancelled'|string} TaskStatus
 */

/**
 * Estado de un waiter.
 * @typedef {'waiting'|'fulfilled'|'rejected'|'timeout'|'invalid'} WaiterStatus
 */

/**
 * Modo de un waiter.
 * @typedef {'passive'|'active'} WaiterMode
 */

/**
 * Estado del proceso asociado a una sesion Claude.
 * @typedef {'alive'|'zombie'|'finished'} ProcessStatus
 */

// ---------------------------------------------------------------------------
// Health — GET /api/health
// ---------------------------------------------------------------------------

/**
 * Respuesta de `GET /api/health`.
 * @typedef {Object} Health
 * @property {boolean} ok
 * @property {string} db_path
 * @property {number} db_size_kb
 * @property {number} uptime_s
 * @property {string} node_version
 * @property {number|null} dispatcher_heartbeat_age_s
 * @property {number|null} db_wal_size_kb
 * @property {number} active_waiters_count
 */

// ---------------------------------------------------------------------------
// Stats — GET /api/stats
// ---------------------------------------------------------------------------

/**
 * Conteos legacy (shape opcional retornado para compat WS).
 * @typedef {Object} StatusCounts
 * @property {number} total
 * @property {number} queued
 * @property {number} running
 * @property {number} done
 * @property {number} failed
 */

/**
 * Distribucion de flows por estado conocido.
 * @typedef {Object} FlowsByStatus
 * @property {number} queued
 * @property {number} running
 * @property {number} completed
 * @property {number} failed
 * @property {number} cancelled
 */

/**
 * Distribucion de tasks por estado conocido.
 * @typedef {Object} TasksByStatus
 * @property {number} queued
 * @property {number} ready
 * @property {number} running
 * @property {number} ['waiting-waiter']
 * @property {number} done
 * @property {number} failed
 * @property {number} cancelled
 */

/**
 * Distribucion de waiters por estado.
 * @typedef {Object} WaitersByStatus
 * @property {number} waiting
 * @property {number} fulfilled
 * @property {number} rejected
 * @property {number} timeout
 * @property {number} invalid
 */

/**
 * Resumen de actividad de las ultimas 24h.
 * @typedef {Object} Last24h
 * @property {number} flows_created
 * @property {number} tasks_done
 * @property {number} tasks_failed
 */

/**
 * Respuesta de `GET /api/stats`.
 * @typedef {Object} Stats
 * @property {number} flows_total
 * @property {FlowsByStatus} flows_by_status
 * @property {number} tasks_total
 * @property {TasksByStatus} tasks_by_status
 * @property {CountByKey} tasks_by_agent
 * @property {number} waiters_total
 * @property {WaitersByStatus} waiters_by_status
 * @property {number} sessions_total
 * @property {number} sessions_alive
 * @property {number} sessions_zombie
 * @property {Last24h} last_24h
 * @property {StatusCounts} [flows] - legacy shape, opcional
 * @property {StatusCounts} [tasks] - legacy shape, opcional
 */

// ---------------------------------------------------------------------------
// Flows — GET /api/flows, GET /api/flows/:id/detail
// ---------------------------------------------------------------------------

/**
 * Item de la lista de flows.
 * @typedef {Object} Flow
 * @property {string} id
 * @property {string} name
 * @property {FlowStatus} status
 * @property {Autonomy} autonomy
 * @property {number} priority
 * @property {string} created_at
 * @property {string} updated_at
 * @property {TaskCounts} task_counts
 */

/**
 * Filtros aceptados por `GET /api/flows`.
 * @typedef {Object} FlowsListFilters
 * @property {string} [status]
 * @property {string} [autonomy]
 * @property {string} [q]
 */

/**
 * Task tal como viene embebida dentro de un FlowDetail (shape crudo del DB).
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} flow_id
 * @property {string|null} parent_task_id
 * @property {string} stage
 * @property {string} agent_id
 * @property {TaskStatus} status
 * @property {string} input_json
 * @property {string|null} output_json
 * @property {number} retries
 * @property {string} idempotency_key
 * @property {string} created_at
 * @property {string} updated_at
 * @property {string|null} started_at
 * @property {string|null} finished_at
 * @property {string|null} error
 * @property {number} priority
 * @property {number|null} business_value
 * @property {number|null} estimated_minutes
 * @property {string} tags_json
 * @property {number} is_milestone
 * @property {string|null} depends_on
 * @property {string|null} message
 */

/**
 * Respuesta de `GET /api/flows/:id/detail`. Extiende Flow con sus tasks.
 * @typedef {Flow & { tasks: Task[] }} FlowDetail
 */

// ---------------------------------------------------------------------------
// TaskDetail — GET /api/tasks/:id
// ---------------------------------------------------------------------------

/**
 * Ejecucion (run) asociada a una task, ordenada por started_at ASC.
 * @typedef {Object} ExecutionSummary
 * @property {string} id
 * @property {number} started_at
 * @property {number|null} finished_at
 * @property {string} status
 * @property {number} tokens_input
 * @property {number} tokens_output
 */

/**
 * Info de la sesion Claude asociada a una task.
 * @typedef {Object} SessionInfo
 * @property {string} session_id
 * @property {string} strategy
 * @property {string} strategy_key
 * @property {number} created_at
 * @property {number} last_used_at
 * @property {number} turn_count
 */

/**
 * Respuesta de `GET /api/tasks/:id`. input_json/output_json vienen ya parseados
 * (pero en tasks viejas pueden quedar como string crudo).
 * @typedef {Object} TaskDetail
 * @property {string} id
 * @property {string} flow_id
 * @property {string} flow_name
 * @property {string} stage
 * @property {string} agent_id
 * @property {TaskStatus} status
 * @property {number} retries
 * @property {string} idempotency_key
 * @property {number} priority
 * @property {number} created_at
 * @property {number} updated_at
 * @property {unknown|null} input_json
 * @property {unknown|null} output_json
 * @property {string|null} error
 * @property {string|null} parent_task_id
 * @property {unknown[]|null} tags_json
 * @property {number|null} estimated_minutes
 * @property {ExecutionSummary[]} executions
 * @property {SessionInfo|null} session
 * @property {string|null} session_action - extraido de output_json._meta.session_action si existe
 */

// ---------------------------------------------------------------------------
// Conversation — GET /api/tasks/:id/conversation
// ---------------------------------------------------------------------------

/**
 * Mensaje de una conversacion. `content` puede ser string o array (formato Anthropic SDK).
 * @typedef {Object} ConversationMessage
 * @property {string} role
 * @property {unknown} content
 * @property {number} [timestamp]
 */

/**
 * Conversacion completa de una task: lista ordenada de mensajes.
 * @typedef {ConversationMessage[]} Conversation
 */

// ---------------------------------------------------------------------------
// Sessions — GET /api/sessions
// ---------------------------------------------------------------------------

/**
 * Sesion Claude activa o historica.
 * @typedef {Object} Session
 * @property {string} session_id
 * @property {string} agent_id
 * @property {string} flow_id
 * @property {string} flow_name
 * @property {string|null} task_id
 * @property {string|null} task_stage
 * @property {number} turn_count
 * @property {number} last_used_at
 * @property {ProcessStatus} process_status
 * @property {string} [jsonl_path]
 * @property {number} [jsonl_size_kb]
 */

// ---------------------------------------------------------------------------
// Waiters — GET /api/waiters
// ---------------------------------------------------------------------------

/**
 * Campos comunes a todos los waiters.
 * @typedef {Object} WaiterBase
 * @property {string} id
 * @property {string} flow_id
 * @property {string|null} flow_name
 * @property {string} task_id
 * @property {string|null} task_stage
 * @property {string} step_id
 * @property {WaiterMode} mode
 * @property {string} kind
 * @property {string} prompt
 * @property {WaiterStatus} status
 * @property {*} value_json
 * @property {number} timeout_ms
 * @property {number} created_at
 * @property {number|null} expires_at
 * @property {number|null} expires_in_s
 * @property {string|null} fulfilled_by
 * @property {number|null} fulfilled_at
 */

/**
 * Waiter en modo pasivo (espera input externo segun schema).
 * @typedef {WaiterBase & {
 *   mode: 'passive',
 *   schema_json: string|null,
 *   available_actions: string[]|null,
 *   schema_invalid: boolean
 * }} WaiterPassive
 */

/**
 * Waiter en modo activo (poll de una condicion).
 * @typedef {WaiterBase & {
 *   mode: 'active',
 *   condition_kind: string|null,
 *   condition_params: *,
 *   poll_interval_ms: number|null,
 *   poll_max_attempts: number|null,
 *   attempts: number,
 *   last_attempt_at: number|null
 * }} WaiterActive
 */

/**
 * Union discriminada por `mode`.
 * @typedef {WaiterPassive | WaiterActive} Waiter
 */

// ---------------------------------------------------------------------------
// Helper interno: GET con manejo de errores uniforme.
// Devuelve { error: string } en lugar de throw cuando algo falla.
// ---------------------------------------------------------------------------

async function getJson(path) {
  try {
    const res = await fetch(BASE + path);
    if (!res.ok) return { error: 'HTTP ' + res.status };
    return await res.json();
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

async function postJson(path, body) {
  try {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    let data = null;
    try { data = await res.json(); } catch (_e) { data = null; }
    if (!res.ok) {
      const msg = data && data.error ? data.error : 'HTTP ' + res.status;
      return { error: msg, status: res.status };
    }
    return data || {};
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

// ---------------------------------------------------------------------------
// Implementaciones
// ---------------------------------------------------------------------------

/**
 * Trae el snapshot actual de salud del orquestador.
 * Endpoint: `GET /api/health`.
 * @returns {Promise<Health | { error: string }>}
 */
export async function fetchHealth() {
  return getJson('/api/health');
}

/**
 * Trae las estadisticas agregadas (flows/tasks/waiters/sessions).
 * Endpoint: `GET /api/stats`.
 * @returns {Promise<Stats | { error: string }>}
 */
export async function fetchStats() {
  return getJson('/api/stats');
}

/**
 * Lista flows con filtros opcionales.
 * Endpoint: `GET /api/flows`. El backend responde `{ flows: Flow[] }`;
 * esta funcion devuelve solo el array.
 * @param {FlowsListFilters} [params]
 * @returns {Promise<Flow[] | { error: string }>}
 */
export async function fetchFlows(params) {
  const qs = new URLSearchParams();
  if (params && params.status) qs.set('status', params.status);
  if (params && params.autonomy) qs.set('autonomy', params.autonomy);
  if (params && params.q) qs.set('q', params.q);
  const suffix = qs.toString() ? '?' + qs.toString() : '';
  const data = await getJson('/api/flows' + suffix);
  if (data && data.error) return data;
  return Array.isArray(data && data.flows) ? data.flows : [];
}

/**
 * Trae el detalle de un flow (incluye sus tasks).
 * Endpoint: `GET /api/flows/:id/detail`.
 * @param {string} id
 * @returns {Promise<FlowDetail | { error: string }>}
 */
export async function fetchFlowDetail(id) {
  return getJson('/api/flows/' + encodeURIComponent(id) + '/detail');
}

/**
 * Trae el detalle de una task (executions, session, etc).
 * Endpoint: `GET /api/tasks/:id`.
 * @param {string} id
 * @returns {Promise<TaskDetail | { error: string }>}
 */
export async function fetchTask(id) {
  return getJson('/api/tasks/' + encodeURIComponent(id));
}

/**
 * Trae la conversacion completa de una task.
 * Endpoint: `GET /api/tasks/:id/conversation`. El backend responde
 * `{ messages: ConversationMessage[] }`; devuelve solo el array.
 * @param {string} id
 * @returns {Promise<Conversation | { error: string }>}
 */
export async function fetchTaskConversation(id) {
  const data = await getJson('/api/tasks/' + encodeURIComponent(id) + '/conversation');
  if (data && data.error) return data;
  return Array.isArray(data && data.messages) ? data.messages : [];
}

/**
 * Lista sesiones Claude (alive / zombie / finished).
 * Endpoint: `GET /api/sessions`. El backend responde `{ sessions: Session[] }`;
 * devuelve solo el array.
 * @returns {Promise<Session[] | { error: string }>}
 */
export async function fetchSessions() {
  const data = await getJson('/api/sessions');
  if (data && data.error) return data;
  return Array.isArray(data && data.sessions) ? data.sessions : [];
}

/**
 * Lista waiters (passive / active).
 * Endpoint: `GET /api/waiters`. El backend responde `{ waiters: Waiter[] }`;
 * devuelve solo el array.
 * @returns {Promise<Waiter[] | { error: string }>}
 */
export async function fetchWaiters() {
  const data = await getJson('/api/waiters');
  if (data && data.error) return data;
  return Array.isArray(data && data.waiters) ? data.waiters : [];
}

// ---------------------------------------------------------------------------
// Write operations (spec v1-write-operations.md)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PrepareRequest
 * @property {string} idea
 * @property {string} [previousFlowId]
 * @property {object} [answers]
 * @property {string} [customResponse]
 */

/**
 * @typedef {Object} PrepareResponse
 * @property {string} flowId
 * @property {string} plannerTaskId
 * @property {'preparing'} status
 */

/**
 * @typedef {Object} ConfirmResponse
 * @property {string} executeFlowId
 * @property {string} executeCoordinatorTaskId
 */

/**
 * @typedef {'preparing'|'proposal-ready'|'blocked-by-waiter'|'error'} PrepareStateKind
 */

/**
 * @typedef {Object} PrepareState
 * @property {PrepareStateKind} state
 * @property {string} [proposalMarkdown]
 * @property {Waiter} [waiter]
 * @property {string} [errorMessage]
 */

/**
 * Lanza un flow planner-mode (prepare).
 * Endpoint: `POST /api/flows/prepare`.
 * @param {PrepareRequest} body
 * @returns {Promise<PrepareResponse | { error: string, status?: number }>}
 */
export async function postPrepare(body) {
  return postJson('/api/flows/prepare', body || {});
}

/**
 * Confirma un prepare ya en estado PLAN_READY: spawnea el flow ejecutor.
 * Endpoint: `POST /api/flows/confirm`.
 * @param {string} prepareFlowId
 * @returns {Promise<ConfirmResponse | { error: string, status?: number }>}
 */
export async function postConfirm(prepareFlowId) {
  return postJson('/api/flows/confirm', { prepareFlowId });
}

/**
 * Resuelve un waiter pasivo via spawn del CLI.
 * Endpoint: `POST /api/waiters/:id/fulfill`.
 * @param {string} waiterId
 * @param {object} value
 * @returns {Promise<{ ok: true } | { error: string, status?: number }>}
 */
export async function postFulfillWaiter(waiterId, value) {
  return postJson('/api/waiters/' + encodeURIComponent(waiterId) + '/fulfill', { value });
}

/**
 * Estado actual del prepare flow (polling cada 2s desde CoordinateTab).
 * Endpoint: `GET /api/flows/:id/prepare-state`.
 * @param {string} flowId
 * @returns {Promise<PrepareState | { error: string }>}
 */
export async function fetchPrepareState(flowId) {
  return getJson('/api/flows/' + encodeURIComponent(flowId) + '/prepare-state');
}

/**
 * Fulfill un waiter pasivo enviando el `value` (objeto JSON) al backend, que
 * a su vez spawnea `npx orchestrator waiter fulfill <id> --json ...`.
 * Endpoint: `POST /api/waiters/:id/fulfill`.
 *
 * Errores mapeados:
 *   - 400 → value no es objeto JSON.
 *   - 409 → waiter no está en `waiting` (race con auto-fulfill u otro operador).
 *   - 500 → spawn-error / output inesperado del CLI.
 *
 * @param {string} id - waiter id
 * @param {object} value - payload de respuesta segun schema_json
 * @returns {Promise<{ok: true} | {error: string, status?: number}>}
 */
export async function fulfillWaiter(id, value) {
  try {
    const res = await fetch(
      BASE + '/api/waiters/' + encodeURIComponent(id) + '/fulfill',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: value }),
      },
    );
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try {
        const data = await res.json();
        if (data && data.error) msg = String(data.error);
      } catch (_) {
        // ignore body parse error
      }
      return { error: msg, status: res.status };
    }
    return await res.json();
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}
