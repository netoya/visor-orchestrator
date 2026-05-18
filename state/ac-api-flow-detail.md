# AC -- Endpoint GET /api/flows/:id/detail (Flow 3 / 12)

Fecha: 2026-05-17
PM: Camila
Spec maestro referencia: `2026-05-17-spec-ui-visor-orchestrator.md` (no encontrado en disco al momento de redactar este AC; criterios derivados del brief de la mision + schema real de `state/orchestrator.db`).

---

## Contexto / Schema real (verificado)

DB: `/home/angel/projects/autonomous-orchestrator/state/orchestrator.db`

**Tabla `flows`:**
- `id TEXT PK`
- `name TEXT NOT NULL`
- `version TEXT NOT NULL DEFAULT '1.0.0'`
- `status TEXT` CHECK IN (`queued`, `running`, `hibernated`, `completed`, `failed`, `cancelled`)
- `autonomy TEXT NOT NULL DEFAULT 'L3'`
- `created_at INTEGER NOT NULL` (epoch ms)
- `updated_at INTEGER NOT NULL` (epoch ms)
- `budget_json TEXT NOT NULL DEFAULT '{}'`

**Tabla `tasks`:**
- `id TEXT PRIMARY KEY`
- `flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE`
- `parent_task_id TEXT` (nullable)
- `stage TEXT NOT NULL`
- `agent_id TEXT NOT NULL`
- `status TEXT NOT NULL DEFAULT 'queued'` CHECK IN (`queued`, `ready`, `running`, `waiting-waiter`, `done`, `failed`, `cancelled`)
- `input_json TEXT NOT NULL`
- `output_json TEXT` (nullable)
- `retries INTEGER NOT NULL DEFAULT 0`
- `idempotency_key TEXT NOT NULL` (unique index)
- `created_at INTEGER NOT NULL` (epoch ms)
- `updated_at INTEGER NOT NULL` (epoch ms)
- `error TEXT` (nullable)
- `priority INTEGER NOT NULL DEFAULT 0`
- `business_value INTEGER` (nullable)
- `estimated_minutes INTEGER` (nullable)
- `tags_json TEXT NOT NULL DEFAULT '[]'`
- `is_milestone INTEGER NOT NULL DEFAULT 0` (boolean: 0 o 1)

**Tabla `task_dependencies` (no incluida en el response de este endpoint):**
- Existe una tabla separada para dependencias entre tasks. No se incluye en esta fase del visor.

---

## SECCION 1 -- Endpoint `GET /api/flows/:id/detail`

**Path param:**
- `id` -- string. Flow ID a consultar. Obligatorio.

**Query params:**
- Ninguno en esta fase.

**Response (200 OK):**
```json
{
  "flow": {
    "id": "string",
    "name": "string",
    "status": "queued|running|hibernated|completed|failed|cancelled",
    "autonomy": "L0|L1|L2|L3|L4",
    "priority": 0,
    "created_at": 1715900000000,
    "updated_at": 1715900000000,
    "task_counts": {
      "total":   0,
      "queued":  0,
      "running": 0,
      "done":    0,
      "failed":  0
    }
  },
  "tasks": [
    {
      "id": "string",
      "flow_id": "string",
      "parent_task_id": "string | null",
      "stage": "string",
      "agent_id": "string",
      "status": "queued|ready|running|waiting-waiter|done|failed|cancelled",
      "input_json": "string",
      "output_json": "string | null",
      "retries": 0,
      "idempotency_key": "string",
      "created_at": 1715900000000,
      "updated_at": 1715900000000,
      "error": "string | null",
      "priority": 0,
      "business_value": 0,
      "estimated_minutes": 0,
      "tags_json": "string",
      "is_milestone": 0
    }
  ]
}
```

**Response (404 Not Found):**
```json
{
  "error": "flow not found"
}
```

**Notas de implementacion:**

1. **Flow lookup**: 
   - Consultar primero si existe el flow con `SELECT * FROM flows WHERE id = ?`.
   - Si no existe: retornar `{ "error": "flow not found" }` con HTTP 404.
   - Si existe: construir el objeto `flow` con la misma estructura que `/api/flows` (reusar la logica de `task_counts` y `priority` derivada).

2. **Tasks query**:
   - `SELECT * FROM tasks WHERE flow_id = ? ORDER BY priority DESC, created_at ASC`.
   - Retornar todas las columnas de la tabla tasks en el response. NO omitir campos aunque sean null.
   - Los valores `null` de la DB se serializan como `null` en JSON (no como string `"null"`).

3. **Orden de tasks**:
   - **Criterio primario**: `priority DESC` (mayor prioridad primero).
   - **Criterio secundario**: `created_at ASC` (mas antiguas primero dentro del mismo nivel de prioridad).
   - Este orden permite al UI visualizar el dag de ejecucion con prioridades claras.

4. **Campos JSON embebidos**:
   - `input_json`, `output_json`, `tags_json` se retornan como **strings** (tal como estan almacenados en la DB). El frontend sera responsable de parsearlos si necesita acceder a su contenido.
   - NO intentar parsear ni reformatear estos campos en el backend. Devolver el valor literal de la columna.

5. **Campo `is_milestone`**:
   - Es un INTEGER (0 o 1) en SQLite. Devolver el valor entero literal, NO convertir a boolean.

6. **Coherencia referencial**:
   - Cada `task.flow_id` en el array `tasks` **DEBE** ser igual al `flow.id` del objeto `flow`.
   - Si por algun bug en la query esto no se cumple, el QA debe rechazar la implementacion.

---

## SECCION 2 -- Criterios de aceptacion (testeables)

### AC1 -- Respuesta 200 con flow y tasks validos
- **Precondicion**: Existe al menos un flow en la DB con ID conocido (ej: obtenido via `GET /api/flows`).
- **Request**: `GET /api/flows/{known_flow_id}/detail`
- **Esperado**: 
  - HTTP 200
  - `body.flow` es objeto con shape identico al definido en `/api/flows` (seccion 1 de `ac-api-flows.md`).
  - `body.tasks` es array (puede estar vacio si el flow no tiene tasks).
  - `Array.isArray(body.tasks) === true`.

### AC2 -- Shape completo de cada Task
- Para cada `t` en `body.tasks`:
  - `typeof t.id === 'string'` y no vacio
  - `typeof t.flow_id === 'string'` y `t.flow_id === body.flow.id`
  - `t.parent_task_id === null || typeof t.parent_task_id === 'string'`
  - `typeof t.stage === 'string'`
  - `typeof t.agent_id === 'string'`
  - `t.status` ∈ `{queued, ready, running, waiting-waiter, done, failed, cancelled}`
  - `typeof t.input_json === 'string'`
  - `t.output_json === null || typeof t.output_json === 'string'`
  - `Number.isInteger(t.retries)` y `t.retries >= 0`
  - `typeof t.idempotency_key === 'string'`
  - `Number.isInteger(t.created_at)` y `Number.isInteger(t.updated_at)` (epoch ms)
  - `t.error === null || typeof t.error === 'string'`
  - `Number.isInteger(t.priority)`
  - `t.business_value === null || Number.isInteger(t.business_value)`
  - `t.estimated_minutes === null || Number.isInteger(t.estimated_minutes)`
  - `typeof t.tags_json === 'string'`
  - `Number.isInteger(t.is_milestone)` y `t.is_milestone` ∈ `{0, 1}`

### AC3 -- Orden de tasks
- **Precondicion**: Flow tiene al menos 3 tasks con diferentes valores de `priority` y `created_at`.
- **Request**: `GET /api/flows/{flow_id}/detail`
- **Esperado**:
  - Para cada par consecutivo `(tasks[i], tasks[i+1])`:
    - Si `tasks[i].priority > tasks[i+1].priority` → OK (prioridad descendente).
    - Si `tasks[i].priority === tasks[i+1].priority` → `tasks[i].created_at <= tasks[i+1].created_at` (created_at ascendente dentro del mismo nivel de prioridad).
  - **Regla simplificada**: el array esta ordenado por `ORDER BY priority DESC, created_at ASC`.

### AC4 -- 404 cuando el flow no existe
- **Request**: `GET /api/flows/nonexistent-flow-id-xyz/detail`
- **Esperado**:
  - HTTP 404
  - `body.error === 'flow not found'`
  - NO debe haber clave `body.flow` ni `body.tasks` en el response.

### AC5 -- Integridad referencial flow_id
- **Precondicion**: Flow tiene al menos 1 task.
- **Request**: `GET /api/flows/{flow_id}/detail`
- **Esperado**:
  - Para TODAS las tasks en `body.tasks`: `task.flow_id === body.flow.id`.
  - Ningun task de otro flow debe aparecer en el array.

### AC6 -- Tasks vacio si el flow no tiene tasks
- **Precondicion**: Flow existe pero no tiene tasks asociadas (posible en flows recien creados).
- **Request**: `GET /api/flows/{empty_flow_id}/detail`
- **Esperado**:
  - HTTP 200
  - `body.flow` presente con `task_counts.total === 0`.
  - `body.tasks === []` (array vacio).

### AC7 -- Campos JSON como strings literales
- **Precondicion**: Existe task con `input_json` y `tags_json` no vacios.
- **Request**: `GET /api/flows/{flow_id}/detail`
- **Esperado**:
  - `typeof task.input_json === 'string'`
  - `typeof task.tags_json === 'string'`
  - El contenido es el valor literal de la columna SQL, NO parseado.
  - Ejemplo: si la DB tiene `tags_json = '["foo","bar"]'`, el response debe tener exactamente esa string, NO un array `["foo","bar"]`.

### AC8 -- Campos nullable correctos
- **Precondicion**: Existe task con `parent_task_id = NULL`, `output_json = NULL`, `error = NULL`, `business_value = NULL`, `estimated_minutes = NULL`.
- **Request**: `GET /api/flows/{flow_id}/detail`
- **Esperado**:
  - Los campos nullable se serializan como `null` (JSON), NO como `undefined` ni string `"null"`.
  - Ejemplo: `{ "parent_task_id": null, "output_json": null, "error": null, "business_value": null, "estimated_minutes": null }`

### AC9 -- Readonly
- **Request**: Cualquier `GET /api/flows/:id/detail`.
- **Esperado**: 
  - Ningun INSERT/UPDATE/DELETE en flows, tasks, events.
  - Verificacion: snapshot `SELECT COUNT(*), MAX(updated_at) FROM flows; SELECT COUNT(*), MAX(updated_at) FROM tasks;` antes y despues; valores identicos.

### AC10 -- Coherencia task_counts vs tasks reales
- **Precondicion**: Flow tiene 5 tasks: 2 done, 1 running, 1 queued, 1 failed.
- **Request**: `GET /api/flows/{flow_id}/detail`
- **Esperado**:
  - `body.flow.task_counts.total === 5`
  - `body.flow.task_counts.done === 2`
  - `body.flow.task_counts.running === 1`
  - `body.flow.task_counts.queued === 1`
  - `body.flow.task_counts.failed === 1`
  - `body.tasks.length === 5`
  - Contar manualmente en el array `body.tasks`: el numero de tasks con cada status debe coincidir con `task_counts`.

---

## SECCION 3 -- Fuera de alcance (no-AC)

- **Dependencias entre tasks**: La tabla `task_dependencies` existe pero NO se incluye en el response de este endpoint. Futuras fases pueden agregar un campo `dependencies: []` en cada task.
- **Parseo de JSON fields**: Los campos `input_json`, `output_json`, `tags_json` se devuelven como strings. El frontend decide si parsearlos.
- **Filtrado de tasks**: No hay query params para filtrar por status, stage, agent_id. Siempre se retornan todas las tasks del flow.
- **Paginacion de tasks**: Si un flow tiene 1000+ tasks, todas se retornan. Futuras fases pueden agregar `?limit=` / `?offset=`.
- **Agregaciones adicionales**: No se calculan metricas como "tiempo promedio de ejecucion" o "tasa de exito". Solo datos crudos.
- **Expansions**: No hay `?expand=dependencies` ni `?expand=executions`. Solo el detalle basico de flow + tasks.

---

## SECCION 4 -- Handoff

- **Backend (Mateo)**: Implementar en `server/index.ts` el handler `app.get('/api/flows/:id/detail', ...)` y en `server/queries.ts` la funcion `getFlowDetail(flowId: string): FlowDetail | null`. Devolver 404 si el flow no existe. Usar el mismo patron de JOIN + agregacion que `listFlows()` para calcular `task_counts` y `priority` del flow.
- **Backend (Mateo)**: Agregar a `server/types.ts` las interfaces:
  ```ts
  export interface Task {
    id: string;
    flow_id: string;
    parent_task_id: string | null;
    stage: string;
    agent_id: string;
    status: string;
    input_json: string;
    output_json: string | null;
    retries: number;
    idempotency_key: string;
    created_at: number;
    updated_at: number;
    error: string | null;
    priority: number;
    business_value: number | null;
    estimated_minutes: number | null;
    tags_json: string;
    is_milestone: number;
  }

  export interface FlowDetail {
    flow: Flow;
    tasks: Task[];
  }
  ```
- **QA (Sofia)**: Implementar `tests/e2e/flow-detail.spec.ts` con al menos los AC1, AC2, AC3, AC4, AC5, AC10. Usar flows y tasks reales de la DB de desarrollo. Validar que los 10 ACs pasen en verde antes de marcar como DONE.
- **Frontend (Valeria)**: Consumir este endpoint para renderizar la vista detallada de un flow. Parsear `input_json`, `output_json`, `tags_json` en el cliente cuando se necesite mostrar su contenido. El endpoint ya esta listo para integracion.
- **PM (Camila)**: Validar que el response contiene TODA la informacion necesaria para construir la UI de detalle del flow (ver mockups de Lucas). Si falta algun campo, abrir refinamiento antes de que Mateo implemente.

---

## SECCION 5 -- Notas de integracion con frontend

El objeto `FlowDetail` retornado por este endpoint es autosuficiente para renderizar:

1. **Header del flow**: `flow.name`, `flow.status`, `flow.autonomy`, `flow.priority`, timestamps.
2. **Metricas agregadas**: `flow.task_counts` permite mostrar progress bars sin recalcular.
3. **Lista de tasks**: `tasks[]` permite renderizar tabla o grafo de tasks con todas sus propiedades.
4. **Relaciones jerarquicas**: `task.parent_task_id` permite construir un arbol (aunque no es un dag completo, solo el parent directo).
5. **Estado de ejecucion**: `task.status`, `task.retries`, `task.error` permiten mostrar indicadores de salud.
6. **Contexto de negocio**: `task.business_value`, `task.estimated_minutes`, `task.is_milestone` permiten priorizar visualmente tasks criticas.

**Ejemplo de uso en el frontend**:
```ts
const res = await fetch(`/api/flows/${flowId}/detail`);
if (!res.ok) {
  if (res.status === 404) {
    showError('Flow no encontrado');
  }
  return;
}
const data: FlowDetail = await res.json();

// Renderizar header
renderFlowHeader(data.flow);

// Renderizar tasks table
data.tasks.forEach(task => {
  const input = JSON.parse(task.input_json);
  const tags = JSON.parse(task.tags_json);
  renderTaskRow(task, input, tags);
});
```

---

## SECCION 6 -- Consideraciones de performance

- **Query N+1**: NO hacer un SELECT por cada task. Usar un solo `SELECT * FROM tasks WHERE flow_id = ? ORDER BY ...` para obtener todas las tasks en una sola query.
- **Tamano del response**: Si un flow tiene 1000 tasks, el JSON puede ser grande (varios MB). En fases futuras considerar paginacion o compresion gzip. En esta fase, aceptable retornar todo.
- **Indice existente**: La DB ya tiene indice `tasks_flow_idx ON tasks(flow_id, status)` que acelera el filtrado por `flow_id`. La query sera rapida incluso con miles de tasks.
- **Caching**: No implementar cache en esta fase. El servidor debe leer siempre datos frescos de la DB readonly. Futuras fases pueden agregar `Cache-Control` headers si es necesario.

---

**Fin del AC.**
