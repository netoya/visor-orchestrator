# AC -- Endpoints GET /api/tasks/:id y GET /api/tasks/:id/conversation (Flow 4 / 12)

Fecha: 2026-05-17
PM: Camila
Spec maestro referencia: `2026-05-17-spec-ui-visor-orchestrator.md` -- US-3 "Detalle de task".
ACs previos relacionados: `ac-bootstrap.md`, `ac-api-flows.md`, `ac-api-flow-detail.md`.

---

## Contexto / Schema real (verificado)

DB: `/home/angel/projects/autonomous-orchestrator/state/orchestrator.db`

**Tabla `tasks`** (recapitulando, ver `ac-api-flow-detail.md` para shape completo):
- `id`, `flow_id`, `parent_task_id`, `stage`, `agent_id`, `status`
- `input_json TEXT NOT NULL`, `output_json TEXT` (nullable)
- `retries`, `idempotency_key`, `priority`, `business_value`, `estimated_minutes`
- `tags_json TEXT NOT NULL DEFAULT '[]'`
- `is_milestone INTEGER`
- `error TEXT` (nullable)
- `created_at`, `updated_at` (epoch ms)

**Tabla `flows`**: se accede para resolver `flow_name` (join por `tasks.flow_id = flows.id`).

**Tabla `executions`** (esperada, una task puede tener N executions):
- `id TEXT PK`
- `task_id TEXT NOT NULL REFERENCES tasks(id)`
- `started_at INTEGER` (epoch ms, nullable hasta que arranca)
- `finished_at INTEGER` (epoch ms, nullable hasta que termina)
- `status TEXT` IN (`running`, `done`, `failed`, `cancelled`, etc.)
- `tokens_input INTEGER` (nullable)
- `tokens_output INTEGER` (nullable)

**Tabla `agent_sessions`** (esperada, 0..1 por task):
- `session_id TEXT PK`
- `task_id TEXT REFERENCES tasks(id)`
- `agent_id TEXT`
- `cwd TEXT` (working dir donde corrio `claude -p`)
- `turn_count INTEGER`
- `created_at INTEGER`, `last_used INTEGER`

**Filesystem -- sesiones Claude:**
- Ruta: `<CLAUDE_SESSIONS_DIR>/<cwd-slug>/<session_id>.jsonl`
- `CLAUDE_SESSIONS_DIR` -- env var. Default: `~/.claude/projects/` (expandir `~` a `os.homedir()`).
- `cwd-slug` -- transformacion del `cwd` de la session: reemplazar **todas** las `/` por `-` (ej: `/home/angel/projects/foo` -> `-home-angel-projects-foo`).
- Cada linea del `.jsonl` es un objeto JSON independiente con un mensaje del transcript.

---

## SECCION 1 -- Endpoint `GET /api/tasks/:id`

**Path param:**
- `id` -- string. Task ID a consultar. Obligatorio.

**Query params:** ninguno.

**Response (200 OK):**

```json
{
  "id": "string",
  "flow_id": "string",
  "flow_name": "string",
  "stage": "string",
  "agent_id": "string",
  "status": "queued|ready|running|waiting-waiter|done|failed|cancelled",
  "retries": 0,
  "idempotency_key": "string",
  "priority": 0,
  "created_at": 1715900000000,
  "updated_at": 1715900000000,
  "input_json": { "...": "objeto parseado, no string" },
  "output_json": { "...": "objeto parseado o null" },
  "error": "string | null",
  "parent_task_id": "string | null",
  "tags_json": ["array", "parseado"],
  "estimated_minutes": 0,
  "executions": [
    {
      "id": "string",
      "started_at": 1715900000000,
      "finished_at": 1715900000000,
      "status": "string",
      "tokens_input": 0,
      "tokens_output": 0
    }
  ],
  "session": {
    "session_id": "string",
    "agent_id": "string",
    "cwd": "string",
    "turn_count": 0,
    "created_at": 1715900000000,
    "last_used": 1715900000000
  },
  "session_action": "string | null"
}
```

**Response (404 Not Found):**

```json
{ "error": "task not found" }
```

**Response (500 Internal Server Error):**

```json
{ "error": "internal error", "detail": "<mensaje breve, opcional>" }
```

---

### 1.1 Resolucion campo por campo

| Campo | Origen | Regla |
|---|---|---|
| `id`, `flow_id`, `stage`, `agent_id`, `status`, `retries`, `idempotency_key`, `priority`, `created_at`, `updated_at`, `error`, `parent_task_id` | columna literal de `tasks` | passthrough; `error` y `parent_task_id` pueden ser `null`. |
| `flow_name` | `flows.name` via JOIN `flows ON flows.id = tasks.flow_id` | string. Si el flow no existe (anomalia), devolver `""`. |
| `input_json` | `tasks.input_json` parseado con `JSON.parse` | Si el parseo falla: devolver el string crudo como `{ "_raw": "<texto>" }` y NO devolver 500. |
| `output_json` | `tasks.output_json` parseado con `JSON.parse` | Si la columna es `NULL`: `null`. Si el parseo falla: `{ "_raw": "<texto>" }`. Tasks viejas pueden tener strings no JSON; **NO** romper la respuesta. |
| `tags_json` | `tasks.tags_json` parseado con `JSON.parse` | Default DB es `'[]'`. Si el parseo falla: `[]`. Garantizar siempre un array. |
| `estimated_minutes` | columna literal | `Number.isInteger` o `null`. |
| `executions` | `SELECT id, started_at, finished_at, status, tokens_input, tokens_output FROM executions WHERE task_id = ? ORDER BY started_at ASC NULLS LAST` | Array, puede ser `[]` si no hay executions. |
| `session` | `SELECT * FROM agent_sessions WHERE task_id = ? LIMIT 1` | `null` si la task no tiene session. Si existe, objeto con los 6 campos listados. |
| `session_action` | derivado de `output_json` | `output_json?._meta?.session_action ?? null`. Solo despues del parse exitoso; si parse fallo, `null`. |

**Decision intencional:** a diferencia de `/api/flows/:id/detail`, aqui los JSON embebidos (`input_json`, `output_json`, `tags_json`) **se devuelven parseados**. La vista de detalle de task necesita acceso estructurado para tabs Input/Output, copy buttons, y derivar `session_action`. El frontend NO debe parsear de nuevo.

---

### 1.2 Diferencia con `flow-detail.tasks[]`

| Concepto | `/api/flows/:id/detail` -> `tasks[]` | `/api/tasks/:id` (este endpoint) |
|---|---|---|
| `input_json` / `output_json` / `tags_json` | string literal de la DB | parseados como JSON |
| `executions` | NO incluido | incluido |
| `session` | NO incluido | incluido |
| `session_action` | NO incluido | incluido |
| `flow_name` | NO (esta en el header del flow) | si (para mostrar link a US-2) |
| `is_milestone`, `business_value` | incluidos | NO se incluyen (no estan en el shape de la US-3) |

---

### 1.3 Codigos de respuesta

| Codigo | Cuando | Body |
|---|---|---|
| **200** | Task encontrada y serializada (incluye casos donde executions/session estan vacios o JSON malformado fue capturado). | TaskDetail completo. |
| **404** | `SELECT * FROM tasks WHERE id = ?` no retorna fila. | `{ "error": "task not found" }`. |
| **500** | Excepcion no controlada (ej: DB lock, falla al leer filesystem). El handler debe envolver toda la logica en try/catch y devolver este shape. | `{ "error": "internal error", "detail": "..." }`. |

**Reglas explicitas:**
- JSON malformado en `input_json` / `output_json` / `tags_json` **NUNCA** debe causar 500. Capturar y degradar al shape documentado en 1.1.
- Filesystem error al leer la session (caso conversation) **NUNCA** debe afectar a `/api/tasks/:id`. Este endpoint NO toca el filesystem; solo lee la DB.
- Solo errores de DB no recuperables -> 500.

---

## SECCION 2 -- Endpoint `GET /api/tasks/:id/conversation`

**Path param:**
- `id` -- string. Task ID. Obligatorio.

**Query params:** ninguno.

**Response (200 OK):**

```json
{
  "messages": [
    {
      "role": "user|assistant|system|tool",
      "content": "string | <objeto pasado tal cual desde el jsonl>",
      "timestamp": 1715900000000
    }
  ]
}
```

**Response (404 Not Found):**

```json
{ "error": "task not found" }
```

**Response (500 Internal Server Error):**

```json
{ "error": "internal error", "detail": "<mensaje breve, opcional>" }
```

---

### 2.1 Logica de resolucion

1. `SELECT id FROM tasks WHERE id = ?`. Si no existe -> **404** con `{ "error": "task not found" }`.
2. `SELECT session_id, cwd FROM agent_sessions WHERE task_id = ? LIMIT 1`.
   - Si no hay session asociada: **200** con `{ "messages": [] }`. **NO** 404.
3. Construir `cwd-slug`: tomar `agent_sessions.cwd` y **reemplazar todas las `/` por `-`** (no recortar leading slash; `/home/angel` -> `-home-angel`).
4. Construir ruta del archivo: `<CLAUDE_SESSIONS_DIR>/<cwd-slug>/<session_id>.jsonl`.
   - `CLAUDE_SESSIONS_DIR` = `process.env.CLAUDE_SESSIONS_DIR ?? path.join(os.homedir(), '.claude/projects/')`.
   - Resolver `~` y trailing slash de forma defensiva (`path.resolve`).
5. Si el archivo **NO existe** (`ENOENT`): **200** con `{ "messages": [] }`. **NO** 404 ni 500.
6. Si el archivo existe: leerlo linea por linea, parsear cada linea como JSON, descartar lineas vacias.
   - Si **una linea individual** no parsea como JSON: skipear silenciosamente esa linea (log warning en stdout opcional); **continuar** con el resto. NO abortar la respuesta entera por una linea corrupta.
7. Devolver `{ "messages": [<array de objetos JSON parseados>] }`.

---

### 2.2 Shape `ConversationMessage`

Cada item del array `messages` es el **objeto JSON literal** parseado del `.jsonl`, sin transformaciones.

**Campos garantizados** (si presentes en la linea original):
- `role` -- string. Tipicamente uno de `user|assistant|system|tool`. Passthrough sin validacion.
- `content` -- variable. Puede ser string, array de bloques (`[{type: "text", text: "..."}, {type: "tool_use", ...}]`), u otro objeto. Passthrough sin transformar.
- `timestamp` -- number (epoch ms) **si esta presente en la linea**; ausente del objeto si el `.jsonl` no lo trae.

**Campos adicionales:** si la linea original contiene otros campos (`tool_use_id`, `model`, `usage`, etc.), **se incluyen tal cual**. NO filtrar campos.

**Compromiso de contrato:** este endpoint es un "pass-through" del `.jsonl`. El frontend asume que cada item tiene al menos un `role` interpretable.

---

### 2.3 Codigos de respuesta

| Codigo | Cuando | Body |
|---|---|---|
| **200** | Task existe (con o sin session, con o sin archivo, con o sin lineas). | `{ "messages": [...] }`. Vacio si no hay session o archivo no existe. |
| **404** | Task no existe en la DB. | `{ "error": "task not found" }`. |
| **500** | Error de filesystem distinto a `ENOENT` (ej: `EACCES`), o error de DB. | `{ "error": "internal error", "detail": "..." }`. |

**Reglas explicitas:**
- Archivo no existe -> **200 con messages vacios**, no 500.
- Sesion no asociada a la task -> **200 con messages vacios**, no 404.
- Solo errores de permisos / DB / IO no `ENOENT` -> 500.

---

## SECCION 3 -- Funciones en `server/queries.ts`

### 3.1 `getTaskDetail(taskId: string): TaskDetail | null`

**Firma:** sincrona (better-sqlite3 es sync).

**Logica:**
1. `SELECT t.*, f.name AS flow_name FROM tasks t LEFT JOIN flows f ON f.id = t.flow_id WHERE t.id = ?`.
2. Si no hay fila -> retornar `null` (el handler HTTP convierte a 404).
3. `SELECT id, started_at, finished_at, status, tokens_input, tokens_output FROM executions WHERE task_id = ? ORDER BY started_at ASC` -> array.
4. `SELECT session_id, agent_id, cwd, turn_count, created_at, last_used FROM agent_sessions WHERE task_id = ? LIMIT 1` -> objeto o `null`.
5. Parseo seguro de `input_json`, `output_json`, `tags_json` via helper `safeParseJson(raw, fallback)` que devuelve `JSON.parse(raw)` o `fallback` o `{ _raw: raw }` segun el caso documentado en 1.1.
6. Calcular `session_action`: `parsedOutput?._meta?.session_action ?? null`. Solo si el parse fue exitoso (no si quedo `{_raw: ...}`).
7. Construir y retornar el objeto `TaskDetail` con todos los campos de la seccion 1.

### 3.2 `getTaskConversation(taskId: string): ConversationMessage[]`

**Firma:** sincrona. Lee filesystem con `fs.readFileSync` (esperable < 1 MB para sessions tipicas; aceptable bloquear el event loop a esta escala).

**Logica:**
1. Helper `getTaskSession(taskId)` (puede compartirse con 3.1): `SELECT session_id, cwd FROM agent_sessions WHERE task_id = ? LIMIT 1`.
2. Si no hay session -> retornar `[]`.
3. Computar `cwdSlug = session.cwd.replace(/\//g, '-')`.
4. Computar `filePath = path.join(CLAUDE_SESSIONS_DIR, cwdSlug, session.session_id + '.jsonl')`.
5. `if (!fs.existsSync(filePath)) return [];`
6. Leer archivo, split por `\n`, filtrar lineas vacias.
7. Por cada linea: `try { return JSON.parse(line); } catch { return null; }` -> filtrar `null`s.
8. Retornar el array resultante.

**NO** propagar errores de "task no existe" desde esta funcion -- esa verificacion es responsabilidad del handler HTTP (que llama primero a `SELECT FROM tasks` para decidir 404).

---

## SECCION 4 -- Tipos TypeScript (en `server/types.ts`)

```ts
export interface ExecutionSummary {
  id: string;
  started_at: number | null;
  finished_at: number | null;
  status: string;
  tokens_input: number | null;
  tokens_output: number | null;
}

export interface AgentSession {
  session_id: string;
  agent_id: string;
  cwd: string;
  turn_count: number;
  created_at: number;
  last_used: number;
}

export interface TaskDetail {
  id: string;
  flow_id: string;
  flow_name: string;
  stage: string;
  agent_id: string;
  status: string;
  retries: number;
  idempotency_key: string;
  priority: number;
  created_at: number;
  updated_at: number;
  input_json: unknown;          // parsed
  output_json: unknown | null;  // parsed o null
  error: string | null;
  parent_task_id: string | null;
  tags_json: unknown[];         // parsed; siempre array
  estimated_minutes: number | null;
  executions: ExecutionSummary[];
  session: AgentSession | null;
  session_action: string | null;
}

export interface ConversationMessage {
  role: string;
  content: unknown;
  timestamp?: number;
  [extra: string]: unknown;
}
```

---

## SECCION 5 -- Criterios de aceptacion testeables

### AC1 -- `/api/tasks/:id` responde 200 con shape valido
- **Precondicion:** existe al menos una task en la DB con ID conocido.
- **Request:** `GET /api/tasks/{known_task_id}`.
- **Esperado:**
  - HTTP 200.
  - Body es un objeto (no array) con TODAS las claves listadas en seccion 1: `id, flow_id, flow_name, stage, agent_id, status, retries, idempotency_key, priority, created_at, updated_at, input_json, output_json, error, parent_task_id, tags_json, estimated_minutes, executions, session, session_action`.
  - Ninguna clave faltante (incluso si su valor es `null`).

### AC2 -- Shape de campos primitivos
- Para el body retornado:
  - `typeof body.id === 'string'` y no vacio.
  - `typeof body.flow_id === 'string'`.
  - `typeof body.flow_name === 'string'`.
  - `typeof body.stage === 'string'`.
  - `typeof body.agent_id === 'string'`.
  - `body.status` ∈ `{queued, ready, running, waiting-waiter, done, failed, cancelled}`.
  - `Number.isInteger(body.retries)` y `>= 0`.
  - `typeof body.idempotency_key === 'string'`.
  - `Number.isInteger(body.priority)`.
  - `Number.isInteger(body.created_at)` y `Number.isInteger(body.updated_at)`.
  - `body.error === null || typeof body.error === 'string'`.
  - `body.parent_task_id === null || typeof body.parent_task_id === 'string'`.
  - `body.estimated_minutes === null || Number.isInteger(body.estimated_minutes)`.
  - `body.session_action === null || typeof body.session_action === 'string'`.

### AC3 -- `input_json`, `output_json`, `tags_json` vienen parseados
- **Precondicion:** task tiene `input_json = '{"foo":"bar"}'`, `output_json = '{"baz":1}'`, `tags_json = '["x","y"]'` en la DB.
- **Esperado:**
  - `body.input_json` es un **objeto** (no string), `body.input_json.foo === 'bar'`.
  - `body.output_json` es un **objeto**, `body.output_json.baz === 1`.
  - `body.tags_json` es un **array**, `body.tags_json.length === 2`.
- **Contraste:** llamar al mismo task via `/api/flows/:flow_id/detail` retorna estos campos como **string** (preservando el contrato de ese endpoint).

### AC4 -- Parse seguro de `output_json` malformado
- **Precondicion:** existe una task vieja con `output_json = 'no soy json valido'` (string crudo).
- **Esperado:**
  - HTTP **200** (NO 500).
  - `body.output_json` equivale a `{ "_raw": "no soy json valido" }`.
  - `body.session_action === null` (porque el parse fallo).

### AC5 -- `output_json = NULL` en DB
- **Precondicion:** task con `output_json IS NULL`.
- **Esperado:**
  - `body.output_json === null`.
  - `body.session_action === null`.

### AC6 -- `session_action` extraido de `_meta`
- **Precondicion:** task con `output_json = '{"result":"ok","_meta":{"session_action":"resume"}}'`.
- **Esperado:**
  - `body.session_action === 'resume'`.
  - `body.output_json._meta.session_action === 'resume'` (el campo sigue accesible en el output parseado).

### AC7 -- `executions` array
- **Precondicion:** task tiene 2 executions en la tabla `executions`.
- **Esperado:**
  - `Array.isArray(body.executions) === true`.
  - `body.executions.length === 2`.
  - Cada item cumple `ExecutionSummary`: claves `id, started_at, finished_at, status, tokens_input, tokens_output` presentes.
  - `started_at`, `finished_at`, `tokens_input`, `tokens_output` pueden ser `null` o `Number.isInteger`.
  - Orden: `started_at ASC` (mas antiguo primero), tolerando `null`.

### AC8 -- `executions` vacio si no hay registros
- **Precondicion:** task sin executions.
- **Esperado:** `body.executions === []` (array vacio, no `null`).

### AC9 -- `session` cuando existe
- **Precondicion:** task tiene una fila en `agent_sessions`.
- **Esperado:**
  - `body.session` es un objeto con claves `session_id, agent_id, cwd, turn_count, created_at, last_used`.
  - `typeof body.session.session_id === 'string'`, `typeof body.session.cwd === 'string'`.
  - `Number.isInteger(body.session.turn_count)`.

### AC10 -- `session === null` cuando no hay session
- **Precondicion:** task sin fila en `agent_sessions`.
- **Esperado:** `body.session === null` (NO objeto vacio, NO `undefined`).

### AC11 -- 404 cuando la task no existe
- **Request:** `GET /api/tasks/nonexistent-task-id-xyz`.
- **Esperado:**
  - HTTP **404**.
  - `body.error === 'task not found'`.
  - No hay claves `id`, `flow_id`, etc. en el body.

### AC12 -- `flow_name` resuelto correctamente
- **Precondicion:** task con `flow_id` que apunta a un flow con `name = 'visor-bootstrap'`.
- **Esperado:** `body.flow_name === 'visor-bootstrap'`.

### AC13 -- `/api/tasks/:id/conversation` con session valida
- **Precondicion:** task tiene session, archivo `.jsonl` existe con N lineas validas.
- **Request:** `GET /api/tasks/{task_id}/conversation`.
- **Esperado:**
  - HTTP 200.
  - `Array.isArray(body.messages) === true`.
  - `body.messages.length === N`.
  - Cada item tiene al menos `role` (string).
  - El primer item refleja el contenido literal de la primera linea del `.jsonl`.

### AC14 -- `/api/tasks/:id/conversation` sin session
- **Precondicion:** task existe, pero no tiene fila en `agent_sessions`.
- **Esperado:**
  - HTTP **200** (NO 404).
  - `body.messages === []`.

### AC15 -- `/api/tasks/:id/conversation` con archivo `.jsonl` inexistente
- **Precondicion:** task tiene session, pero el archivo `<CLAUDE_SESSIONS_DIR>/<cwd-slug>/<session_id>.jsonl` no existe en disco.
- **Esperado:**
  - HTTP **200**.
  - `body.messages === []`.

### AC16 -- Construccion de `cwd-slug`
- **Precondicion:** `agent_sessions.cwd = '/home/angel/projects/visor-orchestrator'`.
- **Esperado:** la ruta del archivo construida es `<CLAUDE_SESSIONS_DIR>/-home-angel-projects-visor-orchestrator/<session_id>.jsonl` (todas las `/` reemplazadas por `-`, incluyendo el leading).

### AC17 -- `CLAUDE_SESSIONS_DIR` env var
- **Precondicion:** `process.env.CLAUDE_SESSIONS_DIR = '/tmp/test-claude-sessions/'`.
- **Esperado:** la lectura del `.jsonl` se hace bajo `/tmp/test-claude-sessions/<cwd-slug>/...`, NO bajo `~/.claude/projects/`.

### AC18 -- Linea corrupta en `.jsonl` no rompe la respuesta
- **Precondicion:** archivo con 3 lineas: linea 1 valida, linea 2 `no es json {{{`, linea 3 valida.
- **Esperado:**
  - HTTP 200.
  - `body.messages.length === 2` (solo las dos lineas validas).
  - Las lineas validas corresponden a las lineas 1 y 3 originales.

### AC19 -- 404 en conversation cuando la task no existe
- **Request:** `GET /api/tasks/nonexistent/conversation`.
- **Esperado:**
  - HTTP **404**.
  - `body.error === 'task not found'`.

### AC20 -- 500 en error interno
- **Precondicion (artificial / mockeable):** simular excepcion lanzada por `getTaskDetail` (ej: DB cerrada).
- **Esperado:**
  - HTTP **500**.
  - Body matches `{ "error": "internal error", "detail": ... }` (la clave `detail` es opcional).
  - El proceso del server NO crashea; siguientes requests siguen respondiendo.

### AC21 -- Readonly enforcement
- **Request:** N invocaciones a `GET /api/tasks/:id` y `GET /api/tasks/:id/conversation`.
- **Esperado:**
  - `COUNT(*)` y `MAX(updated_at)` en `tasks`, `flows`, `executions`, `agent_sessions` son identicos antes y despues.
  - Ningun INSERT/UPDATE/DELETE registrado.

### AC22 -- Coherencia con flow detail
- **Precondicion:** task `T` aparece en `GET /api/flows/{T.flow_id}/detail`.
- **Esperado:**
  - `GET /api/tasks/{T.id}.id === T.id`.
  - `GET /api/tasks/{T.id}.flow_id === T.flow_id`.
  - `GET /api/tasks/{T.id}.status` === el status reportado por flow detail para la misma task.
  - Los campos comunes (status, retries, priority, created_at, updated_at, parent_task_id, error, estimated_minutes) coinciden exactamente.

---

## SECCION 6 -- Fuera de alcance (no-AC)

- **WebSocket / streaming en vivo de la conversation**: NO. Endpoint es 100% pull-based.
- **Streaming chunked del JSONL**: NO. Se lee y devuelve todo en una respuesta JSON.
- **Auth / permisos**: NO en este flow.
- **Filtros sobre messages** (`?role=user`, `?limit=20`): NO. Siempre se devuelve todo.
- **Paginacion de executions**: NO. Si una task tiene 100 executions, se devuelven las 100.
- **Costo en USD por execution**: NO. El spec menciona "cost si lo tenemos" pero la columna no esta confirmada; queda para fase futura.
- **DAG de dependencias de la task**: NO. `parent_task_id` es el unico campo de jerarquia; no se resuelven children ni siblings.
- **Render del contenido**: NO. El backend devuelve los messages crudos; el frontend (US-3, tab Conversation) se encarga de mostrar `tool_use`/`tool_result` colapsables.
- **Edicion / fulfill / kill desde este endpoint**: NO. Read-only estricto.

---

## SECCION 7 -- Handoff

- **Backend (Mateo):**
  - Implementar `getTaskDetail(taskId)` y `getTaskConversation(taskId)` en `server/queries.ts` segun seccion 3.
  - Implementar helpers en `server/queries.ts` o `server/conversation.ts`:
    - `safeParseJson(raw: string | null, fallback: unknown): unknown` (con fallback `{ _raw: raw }` si raw no es null y no parsea).
    - `getTaskSession(taskId)` reutilizable entre los dos endpoints.
  - Implementar handlers en `server/routes/tasks.ts` (o `server/index.ts` segun convencion del proyecto) para `GET /api/tasks/:id` y `GET /api/tasks/:id/conversation`. Envolver en try/catch para garantizar AC20.
  - Agregar tipos en `server/types.ts` segun seccion 4.
- **QA (Sofia):** implementar `tests/e2e/task-detail.spec.ts` cubriendo AC1, AC3, AC4, AC6, AC10, AC11, AC13, AC14, AC15, AC18, AC19 como minimo. Usar `scripts/seed-test-db.mjs` para crear fixtures de:
  - Una task con `output_json` JSON valido y `_meta.session_action`.
  - Una task con `output_json` crudo (no JSON).
  - Una task con session + archivo `.jsonl` valido de 3 lineas.
  - Una task con session pero sin archivo `.jsonl` en disco.
  - Una task sin session.
- **Frontend (Valeria):** consumir `/api/tasks/:id` para llenar la US-3 (header + metadata + tabs). El tab Conversation hace fetch lazy a `/api/tasks/:id/conversation` solo cuando se activa el tab.
- **DevOps (Dante):** documentar la env var `CLAUDE_SESSIONS_DIR` en el README operativo (default `~/.claude/projects/`).
- **PM (Camila):** validar que el shape de `TaskDetail` cubre la totalidad de la US-3 de la spec maestra; si Lucas pide algun campo adicional al revisar mocks, abrir refinamiento antes de implementar.

---

**Fin del AC.**
