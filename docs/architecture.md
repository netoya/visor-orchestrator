# Arquitectura de visor-orchestrator

`visor-orchestrator` es un dashboard de solo lectura para inspeccionar el estado del `autonomous-orchestrator`. Lee directamente la base SQLite del orquestador y expone una API HTTP minima sobre la que un frontend de Vanilla JS construye vistas de flows, tasks, sessions, waiters y stats.

## Componentes

El sistema esta dividido en tres componentes principales y un servicio auxiliar (process scanner). Todos viven en el mismo host.

- Server (Hono): backend HTTP definido en `server/index.ts`, escucha en el puerto 5176. Expone los endpoints `/api/*`. Opera en modo readonly: nunca escribe en la base.
- Frontend (Vanilla JS + Vite): UI estatica en `src/` (entrypoint `src/main.js`), servida por Vite en dev en el puerto 5173 (config en `vite.config.js`). Build de produccion a `dist/public/`, servido por el propio Hono.
- Database (SQLite readonly): archivo `orchestrator.db` que pertenece al `autonomous-orchestrator`. Se abre con `better-sqlite3` en modo `readonly: true, fileMustExist: true` (ver `server/db.ts`). No hay API intermedia: el visor lee la misma DB que escribe el orquestador.
- Process scanner: utilidad invocada desde `server/queries.ts` (`listClaudeProcesses`) que enumera procesos del SO para correlacionar `session_id` con un PID vivo. Sirve para clasificar sesiones en `alive` / `zombie` / `finished`.

### Diagrama de componentes

```
+-----------------------+        +------------------------+        +-------------------------+
|       Browser         |        |   Vite Dev (5173)      |        |     Hono Server         |
|                       |        |                        |        |     server/index.ts     |
|  Vanilla JS UI        | <----> |  - sirve src/*         | <----> |     puerto 5176         |
|  src/main.js          |  HTTP  |  - proxy /api ->       |  HTTP  |                         |
|  src/api.js           |        |    http://localhost    |        |  /api/health            |
|  tabs / drawers       |        |    :5176               |        |  /api/flows             |
+-----------+-----------+        +------------------------+        |  /api/flows/:id/detail  |
            |                                                      |  /api/tasks/:id         |
            | (en prod)                                            |  /api/tasks/:id/convers |
            | sirve dist/public                                    |  /api/sessions          |
            +----------------------------------------------------> |  /api/waiters           |
                                                                   |  /api/stats             |
                                                                   +------------+------------+
                                                                                |
                                                  +-----------------------------+
                                                  |                             |
                                                  v                             v
                                       +---------------------+      +------------------------+
                                       |  SQLite readonly    |      |  Process scanner       |
                                       |  orchestrator.db    |      |  listClaudeProcesses   |
                                       |  (better-sqlite3)   |      |  (ps / argv match)     |
                                       |                     |      |                        |
                                       |  tablas:            |      |  Correlaciona          |
                                       |   - flows           |      |  session_id <-> PID    |
                                       |   - tasks           |      |  para liveness         |
                                       |   - executions      |      |                        |
                                       |   - agent_sessions  |      +------------------------+
                                       |   - waiters         |
                                       |   - conversation_*  |
                                       +---------------------+
```

El flujo de capas es siempre el mismo:

```
Browser  ->  Vite Dev / Static (dist/public)  ->  Hono /api  ->  SQLite readonly  ->  (opcional) Process scanner
```

## Data flow

El recorrido generico de una peticion:

1. El `Browser` ejecuta `fetch('/api/<endpoint>')` desde `src/api.js`.
2. En desarrollo, `vite.config.js` proxea `/api/*` a `http://localhost:5176`. En produccion, Hono sirve el `dist/public/` y responde el mismo origen.
3. Hono recibe la request en `server/index.ts` y la rutea al handler correspondiente.
4. El handler invoca una funcion de `server/queries.ts` que abre la DB via `getDb()` (`server/db.ts`) en modo readonly.
5. Se ejecutan uno o varios `SELECT` (a veces complementados con un scan de procesos del SO).
6. La respuesta JSON viaja al browser y el modulo de tab/drawer en `src/components/` actualiza el DOM.

A continuacion, el flujo concreto para cada endpoint principal.

### GET /api/health

Health check del visor y de la DB. Sirve para alimentar el header de la UI.

1. Handler abre la DB (si no esta abierta ya) via `getDb()`.
2. Hace un `SELECT` ligero (ping) y consulta el tamano del archivo via `getDbInfo()`.
3. Lee metricas auxiliares: `dispatcher_heartbeat_age_s`, `db_wal_size_kb`, `active_waiters_count`, `uptime_s`.
4. La UI (`src/main.js`, funcion `tickHealth`) hace polling cada `getPollMs()` ms y renderiza el header.

### GET /api/flows

Lista de flows con conteos agregados por estado de sus tasks.

1. `listFlows(filters)` en `server/queries.ts`.
2. Acepta filtros opcionales: `status`, `autonomy`, `q` (busqueda por nombre).
3. SQL:

```sql
SELECT
  f.id, f.name, f.status, f.autonomy,
  f.created_at, f.updated_at,
  COALESCE(MAX(t.priority), 0) AS priority,
  COUNT(t.id) AS task_total,
  SUM(CASE WHEN t.status='queued'  THEN 1 ELSE 0 END) AS task_queued,
  SUM(CASE WHEN t.status='running' THEN 1 ELSE 0 END) AS task_running,
  SUM(CASE WHEN t.status='done'    THEN 1 ELSE 0 END) AS task_done,
  SUM(CASE WHEN t.status='failed'  THEN 1 ELSE 0 END) AS task_failed
FROM flows f
LEFT JOIN tasks t ON t.flow_id = f.id
[WHERE ...]
GROUP BY f.id
ORDER BY f.updated_at DESC
```

4. Respuesta: `{ flows: Flow[] }`.

### GET /api/flows/:id/detail

Detalle de un flow + sus tasks.

1. `getFlowDetail(id)` en `server/queries.ts`.
2. Primer query: el mismo agregado que en `/api/flows` pero filtrado por `f.id = @id`.
3. Segundo query: `SELECT * FROM tasks WHERE flow_id = @id ORDER BY priority DESC, created_at ASC`.
4. Respuesta: `Flow & { tasks: Task[] }`.

### GET /api/tasks/:id

Detalle completo de una task: incluye executions y session.

1. `getTaskDetail(taskId)` en `server/queries.ts`.
2. JOIN entre `tasks` y `flows` para resolver `flow_name`.
3. Subqueries adicionales:
   - `executions` (filtrado por `task_id`, ordenado por `started_at` ASC).
   - `agent_sessions` (la mas reciente por `last_used_at`).
4. Parseo seguro de `input_json`, `output_json`, `tags_json` (con fallback a string crudo si el JSON esta corrupto).
5. Extrae `session_action` de `output_json._meta.session_action` si existe.

### GET /api/tasks/:id/conversation

Mensajes de la conversacion Claude asociada a la task.

1. `getTaskConversation(taskId)` en `server/queries.ts`.
2. Resuelve el `session_id` mas reciente para la task en `agent_sessions`.
3. Llama a `readConversationMessages(session_id)` que lee el JSONL del transcript Claude (no es DB; es archivo de disco).
4. Respuesta: `{ messages: ConversationMessage[] }`.

### GET /api/sessions

Lista de sesiones Claude con liveness derivada de procesos del SO.

1. `listSessions(filter)` en `server/queries.ts`.
2. SQL: JOIN `agent_sessions` con `flows` y `tasks` para enriquecer cada fila con `flow_name`, `task_status`, `task_stage`.
3. Si alguna sesion tiene `task_status = 'running'`, se invoca `listClaudeProcesses()` (process scanner) una sola vez por request.
4. Cada sesion se clasifica:
   - `task_status != 'running'` -> `finished`.
   - `task_status == 'running'` y existe un proceso cuyo argv contiene `--resume <session_id>` (o el `task_id`) -> `alive`.
   - `task_status == 'running'` sin proceso correlacionado -> `zombie`.
5. Filtro opcional por `process_status` en memoria.

### GET /api/waiters

Lista de waiters (passive / active) con campos derivados.

1. `listWaiters(filter)` en `server/queries.ts`.
2. JOIN de `waiters` con `flows` y `tasks` para `flow_name` y `task_stage`.
3. Por cada fila:
   - Calcula `expires_in_s` cuando `status='waiting'` y hay `expires_at`.
   - Si `mode='passive'`: parsea `schema_json` y extrae `available_actions` (preferentemente `properties.action.enum`, sino `Object.keys(properties)`); marca `schema_invalid` si el JSON es invalido o no es objeto.
   - Si `mode='active'`: parsea `condition_params_json` y expone `poll_interval_ms`, `poll_max_attempts`, `attempts`, `last_attempt_at`.

### GET /api/stats

Agregados globales para la pestania Stats.

1. `getStats()` en `server/queries.ts` (async).
2. Tres `GROUP BY status` independientes contra `flows`, `tasks`, `waiters`.
3. `GROUP BY agent_id` sobre `tasks` para `tasks_by_agent`.
4. Reutiliza `listSessions()` para obtener `sessions_total`, `sessions_alive`, `sessions_zombie` (cumple la invariante INV-S4: `total = alive + zombie`).
5. Ventana de 24h: conteos de `flows.created_at >= cutoff` y `tasks` `done`/`failed` con `updated_at >= cutoff` (no hay `finished_at` en el esquema; se usa `updated_at` como proxy).
6. Conserva una sombra `flows` / `tasks` con la forma legacy para compat con consumidores antiguos.

## Decisiones

Decisiones de diseno y su justificacion.

### Vanilla JS (no React)

- Bundle pequeno y arranque inmediato sin runtime de framework. El visor es un dashboard sin estado complejo: tabs, listas, drawers.
- Sin pipeline de build pesado: Vite sirve modulos ES nativos en dev y produce un bundle minimo en prod.
- Sin curva de aprendizaje extra para un proyecto interno; el codigo en `src/components/tabs/*` es DOM directo + plantillas literal-string.
- Tipos via JSDoc en `src/api.js` para tener autocompletado sin compilar TypeScript en el cliente.

### Hono (no Express)

- API moderna basada en `Request` / `Response` web-standard; tipado fuerte de rutas y middlewares.
- Mucho mas liviano que Express; mejor performance bajo carga sostenida de polling.
- Edge-ready: si en el futuro hace falta mover el visor a un runtime como Workers o Deno Deploy, el codigo es portable.
- Buen ergonomia para una API minima como esta (8 endpoints).

### SQLite readonly (no API intermedia hacia el orchestrator)

- Latencia minima: leemos del archivo que el orquestador ya escribe, sin saltos de red ni colas.
- Sin sincronizacion: no hay un estado duplicado que pueda diverger del autoritativo.
- Zero-config: solo necesita `ORCHESTRATOR_DB_PATH`. El driver `better-sqlite3` embebe el binario.
- Aislamiento: con `readonly: true` no podemos corromper la DB del orquestador por error.

### Process scanning para liveness

- El esquema de `agent_sessions` no tiene un flag de proceso vivo; el orquestador no actualiza un heartbeat por sesion.
- Escanear `ps` y matchear `--resume <session_id>` (o el `task_id`) en `argv` permite detectar si el runner sigue corriendo sin tocar nada del orquestador.
- El scan se hace solo cuando hay al menos una task en `running` (ver `listSessions`), evitando trabajo innecesario.

## Limitaciones

Limitaciones conocidas del diseno actual.

- Sin autenticacion. El visor asume que escucha en `localhost` o detras de un reverse proxy con auth. No hay tokens, login ni rate limiting.
- Single-process. Una unica instancia de Hono; no esta pensado para escalar horizontalmente (la conexion a SQLite es local y readonly).
- Polling, no websockets. El frontend re-fetchea con intervalos configurables (`getPollMs()`) o ante interaccion del usuario; no hay push desde el server. Implica un pequeno desfase y trafico recurrente, a cambio de simplicidad.
- Readonly estricto. No se puede mutar nada desde el visor: ni cancelar flows, ni reintentar tasks, ni resolver waiters. Cualquier accion debe hacerse contra el orquestador directamente.
- Liveness aproximada. El process scan correlaciona por substring en `argv`; si un runner cambia el formato del argv o el match colisiona con otro proceso, la clasificacion `alive` / `zombie` puede equivocarse en casos extremos.
- Ventanas temporales por proxy. `tasks_done` y `tasks_failed` en `last_24h` se basan en `updated_at` (no hay `finished_at` en el esquema), lo que sobrecuenta tasks que sufrieron updates posteriores al cierre.
