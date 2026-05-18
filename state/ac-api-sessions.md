# AC -- Endpoint GET /api/sessions (Flow 5 / 12)

Fecha: 2026-05-17
PM: Camila
Spec maestro referencia: `2026-05-17-spec-ui-visor-orchestrator.md` -- US-4 "Sessions vivas".
ACs previos relacionados: `ac-bootstrap.md`, `ac-api-flows.md`, `ac-api-flow-detail.md`, `ac-task-detail.md`.

---

## Contexto / Schema real (verificado)

DB: `/home/angel/projects/autonomous-orchestrator/state/orchestrator.db` (readonly).

**Tabla `agent_sessions` (schema REAL, verificado con `.schema`):**

```sql
CREATE TABLE agent_sessions (
  strategy_key TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  flow_id      TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  agent_id     TEXT NOT NULL,
  task_id      TEXT,             -- nullable para futuros modos (flow-agent)
  strategy     TEXT NOT NULL,    -- 'flow-agent-task' | 'none'
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  turn_count   INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX agent_sessions_flow_idx ON agent_sessions(flow_id);
CREATE INDEX agent_sessions_task_idx ON agent_sessions(task_id) WHERE task_id IS NOT NULL;
```

**Observaciones clave del schema real:**
- La PK es `strategy_key`, **no** `session_id`. Un mismo `session_id` podria reaparecer (improbable pero no garantizado unique por DB).
- **NO existe columna `cwd`** -- esto difiere de lo asumido en `ac-task-detail.md`. La resolucion de `jsonl_path` debe hacerse escaneando el filesystem (ver seccion 4).
- El campo de timestamp es `last_used_at` (no `last_used`).
- `task_id` puede ser `NULL` para sessions con `strategy = 'none'` o `strategy = 'flow-agent'`.

**Tabla `tasks`** (recapitulando, ver `ac-task-detail.md`):
- Status posibles (CHECK constraint en DB): `queued|ready|running|waiting-waiter|done|failed|cancelled`.
- Para `process_status`, los terminales son: `done|failed|cancelled`.

**Tabla `flows`**: se accede para resolver `flow_name` (join por `agent_sessions.flow_id = flows.id`).

**Filesystem -- sesiones Claude (`.jsonl`):**
- Raiz: `<CLAUDE_SESSIONS_DIR>` -- env var. Default: `path.join(os.homedir(), '.claude/projects/')`.
- Estructura: `<CLAUDE_SESSIONS_DIR>/<cwd-slug>/<session_id>.jsonl`.
- Como no tenemos `cwd` en `agent_sessions`, la unica forma de localizar el archivo es escanear los subdirectorios de `<CLAUDE_SESSIONS_DIR>` buscando un archivo `<session_id>.jsonl` (ver seccion 4.4).

---

## SECCION 1 -- Endpoint `GET /api/sessions`

**Path:** `GET /api/sessions`.

**Query params (opcionales, combinables con AND):**

| Param | Tipo | Validacion | Descripcion |
|---|---|---|---|
| `agent` | string | trim, no vacio | Filtra por `agent_id` exacto (case-sensitive). |
| `status` | string | uno de `alive|zombie|finished` | Filtra por `process_status` calculado. Cualquier otro valor: 400. |

Si un query param viene vacio (`?agent=&status=`), tratarlo como **ausente** (no filtrar por el).

**Response (200 OK):**

```json
[
  {
    "session_id": "string",
    "agent_id": "string",
    "flow_id": "string",
    "flow_name": "string",
    "task_id": "string | null",
    "task_stage": "string | null",
    "turn_count": 0,
    "last_used_at": 1715900000000,
    "process_status": "alive|zombie|finished",
    "jsonl_path": "string (opcional)",
    "jsonl_size_kb": 0
  }
]
```

**Response (400 Bad Request) -- query param invalido:**

```json
{ "error": "invalid query param", "detail": "status must be one of alive|zombie|finished" }
```

**Response (500 Internal Server Error) -- DB inaccesible o error inesperado:**

```json
{ "error": "internal error", "detail": "<mensaje breve, opcional>" }
```

---

### 1.1 Shape de cada `Session`

| Campo | Tipo | Origen | Reglas |
|---|---|---|---|
| `session_id` | `string` | `agent_sessions.session_id` | Passthrough. No truncar en backend (el frontend trunca para mostrar). |
| `agent_id` | `string` | `agent_sessions.agent_id` | Passthrough. |
| `flow_id` | `string` | `agent_sessions.flow_id` | Passthrough. |
| `flow_name` | `string` | `flows.name` via JOIN `flows ON flows.id = agent_sessions.flow_id` | Si el flow no existe (anomalia): `""`. |
| `task_id` | `string \| null` | `agent_sessions.task_id` | `null` si la session es de strategy distinta a `flow-agent-task`. |
| `task_stage` | `string \| null` | `tasks.stage` via LEFT JOIN `tasks ON tasks.id = agent_sessions.task_id` | `null` si `task_id` es null o la task ya no existe. |
| `turn_count` | `number` (entero) | `agent_sessions.turn_count` | Passthrough. |
| `last_used_at` | `number` (epoch ms) | `agent_sessions.last_used_at` | Passthrough. |
| `process_status` | `'alive' \| 'zombie' \| 'finished'` | calculado (seccion 3) | Siempre presente. |
| `jsonl_path` | `string` (opcional) | scanner FS (seccion 4.4) | Solo presente si se encontro un archivo. **Ausente** (no `null`) si no se encontro. |
| `jsonl_size_kb` | `number` (opcional, entero) | `fs.statSync(jsonl_path).size / 1024` redondeado | Solo si `jsonl_path` esta presente. Redondeo: `Math.round(bytes / 1024)`. |

**Orden default:** `last_used_at DESC` (mas recientes primero). No es configurable por query param en MVP.

---

### 1.2 Codigos de respuesta

| Codigo | Cuando | Body |
|---|---|---|
| **200** | Query exitosa, incluso si el array resultante es `[]`. | Array de Session (puede ser vacio). |
| **400** | `status` con valor invalido. | `{ "error": "invalid query param", "detail": "..." }`. |
| **500** | Excepcion no controlada: DB cerrada / corrupta / lock irrecuperable, error fatal del scanner. | `{ "error": "internal error", "detail": "..." }`. |

**Reglas explicitas:**
- Filesystem error al resolver `jsonl_path` (ej: `EACCES` sobre un subdir) **NUNCA** debe causar 500. Capturar y omitir `jsonl_path`/`jsonl_size_kb` de esa session.
- Si el scanner de procesos falla (ej: `ps` no disponible): asumir lista vacia de procesos y devolver todas las sessions running como `zombie`. **NO** 500.
- Solo errores de DB no recuperables -> 500.

---

## SECCION 2 -- Filtros (query params)

### 2.1 Filtro `agent`
- Comparacion exacta case-sensitive contra `agent_id`.
- Se aplica **antes** del calculo de `process_status` (mas eficiente, reduce el set de procesos a correlacionar).
- Implementacion: agregar `WHERE agent_id = ?` al SELECT base.

### 2.2 Filtro `status`
- Valores aceptados: `alive`, `zombie`, `finished`. Cualquier otro -> 400.
- Se aplica **despues** del calculo de `process_status` (filtrado en memoria), porque depende de la correlacion con procesos vivos.

### 2.3 Combinacion
- Ambos params son combinables con AND.
- `GET /api/sessions?agent=mateo&status=zombie` -> sessions de Mateo cuyo `process_status === 'zombie'`.

---

## SECCION 3 -- Logica `process_status`

Calculo por session, en este orden:

1. **`finished`** si la task asociada NO esta `running`:
   - Si `agent_sessions.task_id IS NULL` -> `finished` (no hay task asociada para considerar viva).
   - Si la task existe y `tasks.status IN ('done', 'failed', 'cancelled')` -> `finished`.
   - Si la task existe y su status es cualquier otro estado terminal o pre-running (`queued`, `ready`, `waiting-waiter`) -> `finished` (no hay `claude -p` para esa task).
   - Si la task referenciada **no existe** en `tasks` (anomalia/orphan FK ya borrada) -> `finished`.

2. **`alive`** si la task asociada esta `running` Y existe un proceso `claude -p` correlacionado:
   - Condicion: `tasks.status === 'running'`.
   - Y existe algun proceso `p` en el snapshot del scanner tal que:
     - `p.argv_string` contiene la substring `--resume <session_id>` (match preferido), **O**
     - `p.argv_string` contiene el `task_id` (fallback: cuando el proceso no se inicio con `--resume` sino con un comando que mete el `task_id` en argv).

3. **`zombie`** si la task asociada esta `running` pero ningun proceso correlaciona:
   - `tasks.status === 'running'` y **NO** se cumple ninguna de las condiciones de match de (2).

**Match de `--resume`:** usar `String.includes('--resume ' + session_id)` para evitar falsos positivos cuando `session_id` aparece en otro flag.

**Match de `task_id`:** usar `String.includes(task_id)` directo. Acepta el riesgo de falso positivo (poco probable porque los `task_id` son UUID-like y no aparecen accidentalmente en argv).

**Determinismo:** el calculo es deterministico para una snapshot dado de procesos + DB state. Dos llamadas consecutivas pueden diferir si la snapshot del scanner se refresca (ver seccion 4.3) o si el dispatcher movio una task de `running` a `done`.

---

## SECCION 4 -- Scanner de procesos (`server/processes.ts`)

### 4.1 Comando base

```bash
ps -eo pid,rss,pcpu,etime,args --no-headers
```

**Por que ese formato:**
- `pid` -- PID del proceso.
- `rss` -- Resident Set Size en KB (la columna nativa de `ps`).
- `pcpu` -- % CPU instantaneo.
- `etime` -- tiempo desde que arranco (formato `[[DD-]HH:]MM:SS`).
- `args` -- linea completa de argv (incluye el ejecutable y todos los flags). **DEBE ir al final** porque puede contener espacios.

**Por que `--no-headers`:** evita parsear la primera linea de columnas.

### 4.2 Filtrado

Tras el output de `ps`, filtrar lineas cuyo `args` contenga la substring `claude -p`. Match exacto de la substring (no regex):

```ts
lines.filter(line => line.includes('claude -p'))
```

**Razon:** los procesos relevantes son invocaciones de `claude -p ...`. Cualquier otro proceso (incluido el propio visor, el dispatcher de Node, sqlite, etc.) se descarta aca.

### 4.3 Cache en memoria

- Snapshot completo cacheada en variable de modulo.
- TTL: `process.env.PROCESS_SCAN_CACHE_MS` parseado a entero; default `5000` (5s).
- Si la cache esta vigente (`Date.now() - cachedAt < TTL`), devolver la snapshot cacheada sin invocar `ps`.
- Si esta vencida o no existe: ejecutar `ps`, parsear, reemplazar la cache, devolver el resultado nuevo.
- La cache **NO** se invalida explicitamente desde otros modulos. El refresh ocurre solo por expiracion de TTL.

**Concurrencia:** si dos requests llegan simultaneos con cache vencida, ambos pueden disparar un `ps`. Aceptable en MVP (no se requiere lock).

### 4.4 Parseo de cada linea

Cada linea matcheada se parsea a un objeto:

```ts
interface ClaudeProcess {
  pid: number;
  etime: string;             // formato crudo de `ps`, ej "01:23" o "1-02:30:45"
  rss_mb: number;            // rss (KB) / 1024, redondeado a 1 decimal
  cpu_pct: number;           // pcpu parseado a float
  argv_string: string;       // args completo (puede tener espacios)
  resume_session_id?: string; // extraido de "--resume <id>" si existe
}
```

**Parseo robusto:** las primeras 4 columnas (`pid rss pcpu etime`) son fijas; el resto (`args`) se concatena. Usar `split(/\s+/)` con limite -- ej `line.trim().split(/\s+/, 4)` no funciona porque consume; usar manualmente: tomar primeros 4 tokens y el remainder.

**Extraccion de `resume_session_id`:**
- Buscar `--resume` en argv. Si existe, tomar el siguiente token como `session_id`.
- Si no aparece `--resume`: dejar el campo ausente (no `null`).

**`jsonl_path` opcional para la response del endpoint** (calculado **fuera** del scanner, en `getSessions()`):
- Por cada session a serializar, intentar resolver el archivo `.jsonl` en `<CLAUDE_SESSIONS_DIR>`:
  - Listar los subdirectorios de `CLAUDE_SESSIONS_DIR` (cache opcional, pero MVP puede releer).
  - Para cada subdir, chequear si existe `<subdir>/<session_id>.jsonl`.
  - Primer match gana. Si no hay match en ningun subdir: omitir `jsonl_path` y `jsonl_size_kb` del shape.
- Si `CLAUDE_SESSIONS_DIR` no existe o no es legible: omitir ambos campos para todas las sessions (no 500).

### 4.5 Salida del scanner

Funcion `getClaudeProcesses(): ClaudeProcess[]` exportada. Sincrona (usa `execSync`) o async (usa `execFile`); para MVP preferimos sincrona por simplicidad, dentro del handler.

**Tiempo limite:** `ps -eo ...` debe terminar en < 1s en condiciones normales. Si tarda mas: no agregar timeout artificial en MVP (`ps` no se cuelga en linux), pero loggear si la latencia del request > 100ms (ver acta Dante).

---

## SECCION 5 -- Funcion `getSessions` en `server/queries.ts`

### 5.1 Firma

```ts
function getSessions(filters: {
  agent?: string;
  status?: 'alive' | 'zombie' | 'finished';
}): Session[];
```

Sincrona (better-sqlite3 sync).

### 5.2 Logica

1. Construir SQL base:
   ```sql
   SELECT s.session_id, s.agent_id, s.flow_id, s.task_id, s.turn_count, s.last_used_at,
          f.name AS flow_name,
          t.status AS task_status, t.stage AS task_stage
   FROM agent_sessions s
   LEFT JOIN flows f ON f.id = s.flow_id
   LEFT JOIN tasks t ON t.id = s.task_id
   {WHERE agent_id = ?}
   ORDER BY s.last_used_at DESC
   ```
   El `WHERE agent_id = ?` se inyecta solo si `filters.agent` esta presente.

2. Para el set resultante, obtener snapshot de procesos: `procs = getClaudeProcesses()`.

3. Por cada row, calcular `process_status` aplicando la logica de seccion 3:
   - Si `task_status` (del JOIN) es `done|failed|cancelled` o `null` (no hay task) -> `finished`.
   - Si `task_status === 'running'`:
     - Buscar `p` en `procs` tal que `p.argv_string.includes('--resume ' + session_id)` o (si `task_id` no es null) `p.argv_string.includes(task_id)`.
     - Si lo hay -> `alive`. Si no -> `zombie`.
   - Cualquier otro status (`queued|ready|waiting-waiter`) -> `finished` (no hay proceso).

4. Por cada row, intentar resolver `jsonl_path` y `jsonl_size_kb` (seccion 4.4). Capturar errores filesystem por session (no propagar).

5. Aplicar filtro `status` en memoria si esta presente: `result.filter(s => s.process_status === filters.status)`.

6. Retornar el array final.

### 5.3 Helpers

- `getClaudeProcesses()` -- expuesta desde `server/processes.ts`, ver seccion 4.
- `resolveJsonlPath(sessionId: string): { path: string; size_kb: number } | null` -- expuesta desde `server/processes.ts` o `server/conversation.ts`. Devuelve `null` si no encuentra.

---

## SECCION 6 -- Tipos TypeScript (en `server/types.ts`)

```ts
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
```

---

## SECCION 7 -- Criterios de aceptacion testeables

### AC1 -- `/api/sessions` responde 200 con array
- **Precondicion:** existe al menos una session en `agent_sessions`.
- **Request:** `GET /api/sessions`.
- **Esperado:**
  - HTTP 200.
  - `Array.isArray(body) === true`.
  - `body.length >= 1`.
  - Cada item tiene las claves obligatorias: `session_id, agent_id, flow_id, flow_name, task_id, task_stage, turn_count, last_used_at, process_status`.

### AC2 -- `/api/sessions` con DB vacia retorna array vacio
- **Precondicion:** `agent_sessions` no tiene filas.
- **Esperado:** HTTP 200, `body === []` (NO 404, NO 500).

### AC3 -- Shape de campos primitivos
- Para cada session en el body:
  - `typeof session.session_id === 'string'` y no vacio.
  - `typeof session.agent_id === 'string'`.
  - `typeof session.flow_id === 'string'`.
  - `typeof session.flow_name === 'string'` (puede ser `""` si el flow fue borrado).
  - `session.task_id === null || typeof session.task_id === 'string'`.
  - `session.task_stage === null || typeof session.task_stage === 'string'`.
  - `Number.isInteger(session.turn_count)` y `>= 1`.
  - `Number.isInteger(session.last_used_at)`.
  - `session.process_status` ∈ `{alive, zombie, finished}`.

### AC4 -- `jsonl_path` y `jsonl_size_kb` son opcionales
- Si el archivo `.jsonl` no existe en ningun subdir de `CLAUDE_SESSIONS_DIR`:
  - **NO** existe la clave `jsonl_path` en el objeto (`'jsonl_path' in session === false`).
  - **NO** existe la clave `jsonl_size_kb`.
- Si el archivo existe:
  - `typeof session.jsonl_path === 'string'` y termina en `.jsonl`.
  - `Number.isInteger(session.jsonl_size_kb)` y `>= 0`.

### AC5 -- `process_status === 'finished'` cuando task es terminal
- **Precondicion:** session asociada a task con `status = 'done'` (idem para `failed`, `cancelled`).
- **Esperado:** `session.process_status === 'finished'` independiente de procesos en el host.

### AC6 -- `process_status === 'finished'` cuando session no tiene task
- **Precondicion:** session con `task_id IS NULL`.
- **Esperado:** `session.process_status === 'finished'`.

### AC7 -- `process_status === 'alive'` con match de `--resume <session_id>`
- **Precondicion:**
  - Task asociada con `status = 'running'`.
  - Existe en el host un proceso (puede ser de mentira para test) cuyo argv incluye `claude -p` Y la substring `--resume <session_id>`.
- **Esperado:** `session.process_status === 'alive'`.

### AC8 -- `process_status === 'alive'` con fallback de match por `task_id`
- **Precondicion:**
  - Task asociada con `status = 'running'`.
  - Existe proceso `claude -p` cuyo argv NO contiene `--resume <session_id>` pero SI contiene el `task_id`.
- **Esperado:** `session.process_status === 'alive'`.

### AC9 -- `process_status === 'zombie'` cuando task running sin proceso
- **Precondicion:**
  - Task asociada con `status = 'running'`.
  - NO existe ningun proceso `claude -p` con `--resume <session_id>` ni con `task_id` en argv.
- **Esperado:** `session.process_status === 'zombie'`.

### AC10 -- `process_status === 'finished'` para estados pre-running
- **Precondicion:** task con `status ∈ {queued, ready, waiting-waiter}`.
- **Esperado:** `session.process_status === 'finished'` (no hay `claude -p` corriendo para esa task).

### AC11 -- Orden default por `last_used_at DESC`
- **Precondicion:** 3 sessions con `last_used_at` distintos (`t1 < t2 < t3`).
- **Esperado:** el body devuelve las sessions en orden `t3, t2, t1`.

### AC12 -- Filtro `?agent=<id>`
- **Request:** `GET /api/sessions?agent=mateo`.
- **Esperado:**
  - Todas las sessions del body cumplen `session.agent_id === 'mateo'`.
  - Sessions de otros agentes no aparecen.

### AC13 -- Filtro `?agent=` (vacio) se ignora
- **Request:** `GET /api/sessions?agent=`.
- **Esperado:** mismo resultado que `GET /api/sessions` (param vacio = no filtrar).

### AC14 -- Filtro `?status=zombie`
- **Request:** `GET /api/sessions?status=zombie`.
- **Esperado:**
  - HTTP 200.
  - Todas las sessions del body cumplen `session.process_status === 'zombie'`.

### AC15 -- Filtro `?status=` (vacio) se ignora
- **Request:** `GET /api/sessions?status=`.
- **Esperado:** mismo resultado que sin el param.

### AC16 -- Combinacion de filtros `?agent=X&status=Y`
- **Request:** `GET /api/sessions?agent=mateo&status=alive`.
- **Esperado:**
  - Todas las sessions cumplen `agent_id === 'mateo'` Y `process_status === 'alive'` simultaneamente.

### AC17 -- `status` invalido devuelve 400
- **Request:** `GET /api/sessions?status=potato`.
- **Esperado:**
  - HTTP **400**.
  - `body.error === 'invalid query param'`.
  - `body.detail` contiene la lista de valores aceptados (`alive|zombie|finished`).

### AC18 -- Scanner cachea segun `PROCESS_SCAN_CACHE_MS`
- **Precondicion:** `process.env.PROCESS_SCAN_CACHE_MS = '60000'` antes de arrancar el server.
- **Setup:** primer request a `/api/sessions` -> dispara `ps`. Esperar 1s. Cambiar el estado real de procesos (matar un proceso de test). Segundo request a `/api/sessions`.
- **Esperado:**
  - Segundo request devuelve el mismo `process_status` que el primero para la session afectada (cache vigente).
  - Tras 60s, un tercer request refleja el cambio.

### AC19 -- Scanner usa default 5000ms si `PROCESS_SCAN_CACHE_MS` no esta
- **Precondicion:** env var ausente.
- **Esperado:** observable indirectamente: dos requests separados por < 5s comparten snapshot; uno separado por > 5s la refresca.

### AC20 -- `flow_name` resuelto via JOIN
- **Precondicion:** session con `flow_id = X`, flow `X` tiene `name = 'visor-api-sessions'`.
- **Esperado:** `session.flow_name === 'visor-api-sessions'`.

### AC21 -- `task_stage` resuelto via JOIN
- **Precondicion:** session con `task_id = T`, task `T` tiene `stage = 'implement'`.
- **Esperado:** `session.task_stage === 'implement'`.

### AC22 -- `task_id` y `task_stage` ambos null si la session no tiene task
- **Precondicion:** session con `task_id IS NULL` en la DB.
- **Esperado:** `session.task_id === null` y `session.task_stage === null`.

### AC23 -- Tolerancia a fallo del scanner de procesos
- **Precondicion (mockeable):** `getClaudeProcesses()` lanza excepcion (ej: `ps` retorna no-zero).
- **Esperado:**
  - HTTP **200** (NO 500).
  - Todas las sessions con `task_status === 'running'` aparecen como `zombie` (no se pudo correlacionar).
  - Las sessions con task terminal siguen como `finished`.

### AC24 -- Tolerancia a fallo de resolucion de `jsonl_path`
- **Precondicion:** `CLAUDE_SESSIONS_DIR` apunta a un directorio que no existe (`/no/existe/`).
- **Esperado:**
  - HTTP 200.
  - Ninguna session del body tiene `jsonl_path` ni `jsonl_size_kb` (claves ausentes).
  - `process_status` se sigue calculando correctamente.

### AC25 -- 500 cuando la DB es inaccesible
- **Precondicion (mockeable):** simular DB cerrada / `SQLITE_BUSY` irrecuperable.
- **Esperado:**
  - HTTP **500**.
  - `body.error === 'internal error'`.
  - `body.detail` puede estar presente con un mensaje breve.
  - El proceso del server NO crashea.

### AC26 -- Readonly enforcement
- **Request:** N invocaciones a `GET /api/sessions` con distintos filtros.
- **Esperado:**
  - `COUNT(*)` y `MAX(last_used_at)` en `agent_sessions`, `tasks`, `flows` identicos antes y despues.
  - Ningun INSERT/UPDATE/DELETE registrado.

### AC27 -- Match `--resume` no acepta substring parcial
- **Precondicion:** existe proceso con argv que contiene el `session_id` pero NO precedido de `--resume `.
  Ejemplo: `claude -p --some-flag abc123-session-id ...` (el sid aparece pero no como argumento de `--resume`).
- **Esperado:** si tampoco hay match por `task_id`, esa session se reporta `zombie` (el match exige el prefijo literal `--resume `).

### AC28 -- Idempotencia ante refresh de cache
- **Request:** dos `GET /api/sessions` consecutivos dentro de `PROCESS_SCAN_CACHE_MS`, sin cambios en DB ni procesos.
- **Esperado:** ambos bodies son **identicos byte-a-byte** (mismo orden, misma cantidad, mismos `process_status`).

---

## SECCION 8 -- Fuera de alcance (no-AC)

- **WebSocket / streaming en vivo de sessions:** NO. Endpoint es 100% pull-based. El polling lo hace el frontend cada 5s.
- **Kill de procesos zombie:** NO desde este endpoint. Es feature futura `POST /api/sessions/:id/kill` o `DELETE /api/processes/:pid` (ver US-7 y acta Dante; gated por env var `ENABLE_KILL_API`).
- **Auth / permisos:** NO en este flow.
- **Filtros adicionales** (`?flow=`, `?task=`, `?since=<epoch>`, `?limit=`, `?offset=`): NO. Solo `agent` y `status`.
- **Sort configurable:** NO. Orden fijo `last_used_at DESC`.
- **Agrupacion por `agent_id`:** NO en el backend. Esa transformacion la hace el frontend (Lucas pidio collapsible groups por agente en US-4, pero la API devuelve flat).
- **Paginacion:** NO. Se devuelven todas las sessions matched (esperable < 200 en operacion normal).
- **Lectura del contenido `.jsonl`:** NO. Para eso esta `GET /api/tasks/:id/conversation` (US-3, ya cubierto en `ac-task-detail.md`).
- **Detalle por session (`GET /api/sessions/:id`):** NO en MVP. Toda la info necesaria viene en el listado.
- **Match con regex avanzado en argv** (escape de PCRE, multi-flag, etc.): NO. `String.includes` es suficiente para el formato actual de invocacion del dispatcher.
- **Deteccion de procesos huerfanos del kernel (`<defunct>`):** NO. Si `ps` los lista, se cuentan; si no, se ignoran. No es responsabilidad de este endpoint diferenciar zombies del kernel de zombies del orchestrator.

---

## SECCION 9 -- Handoff

- **Backend (Mateo):**
  - Implementar `getSessions(filters)` en `server/queries.ts` segun seccion 5.
  - Implementar `getClaudeProcesses()` y `resolveJsonlPath(sessionId)` en `server/processes.ts` segun seccion 4.
  - Implementar el handler en `server/routes/sessions.ts` para `GET /api/sessions`:
    - Validar query params (400 si `status` invalido).
    - Envolver toda la logica en try/catch para garantizar AC25.
    - Capturar fallo del scanner por separado (AC23).
  - Agregar tipos en `server/types.ts` segun seccion 6.
  - Documentar la env var `PROCESS_SCAN_CACHE_MS` en el header del archivo `processes.ts`.

- **QA (Sofia):** implementar `tests/e2e/sessions-zombie.spec.ts` cubriendo como minimo AC1, AC5, AC7, AC9, AC12, AC14, AC16, AC17, AC23, AC25. Usar `scripts/seed-test-db.mjs` para fixtures de:
  - Una session con task `running` + proceso fake con `--resume` matching (alive esperado).
  - Una session con task `running` sin proceso (zombie esperado).
  - Una session con task `done` (finished esperado).
  - Una session con `task_id NULL` (finished esperado).
  - Sessions de 2 agentes distintos para filtros.
  - Para simular procesos: spawnear `bash -c 'exec -a "claude -p --resume <sid>" sleep 60'` o similar (proceso con argv falsificado pero que `ps` reporta).

- **Frontend (Valeria):** consumir `GET /api/sessions` para US-4. Implementar:
  - Refresh manual (boton) ademas del polling de 5s (acta Lucas).
  - Agrupacion por `agent_id` en la UI (collapsible).
  - Badges segun `process_status` con animacion pulse en `alive` y rojo solido en `zombie`.

- **DevOps (Dante):** documentar en el README operativo:
  - `PROCESS_SCAN_CACHE_MS` (default 5000).
  - `CLAUDE_SESSIONS_DIR` (default `~/.claude/projects/`).
  - Nota: el visor debe correr en el mismo host que el orchestrator para que `ps` vea los procesos.

- **PM (Camila):** validar que el shape de `Session` cubre la US-4 (columnas de tabla y badges). Si Lucas pide algun campo adicional (ej: `pid` para mostrar en hover), abrir refinamiento antes de implementar.

---

**Fin del AC.**
