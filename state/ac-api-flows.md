# AC -- Endpoints /api/flows y /api/stats (Flow 2 / 12)

Fecha: 2026-05-17
Spec maestro referencia: `2026-05-17-spec-ui-visor-orchestrator.md` (no encontrado en disco al momento de redactar este AC; criterios derivados del brief de la mision + schema real de `state/orchestrator.db`).

---

## Contexto / Schema real (verificado)

DB: `/home/angel/projects/autonomous-orchestrator/state/orchestrator.db`

Tabla `flows`:
- `id TEXT PK`
- `name TEXT NOT NULL`
- `version TEXT NOT NULL DEFAULT '1.0.0'`
- `status TEXT` IN (`queued`, `running`, `hibernated`, `completed`, `failed`, `cancelled`)
- `autonomy TEXT NOT NULL DEFAULT 'L3'`
- `created_at INTEGER NOT NULL` (epoch ms)
- `updated_at INTEGER NOT NULL` (epoch ms)
- `budget_json TEXT`

Tabla `tasks`:
- `id`, `flow_id (FK -> flows.id)`, `parent_task_id`, `stage`, `agent_id`
- `status` IN (`queued`, `ready`, `running`, `waiting-waiter`, `done`, `failed`, `cancelled`)
- `priority INTEGER NOT NULL DEFAULT 0`
- `business_value`, `estimated_minutes`, `tags_json`, `is_milestone`
- `created_at`, `updated_at`

**Discrepancias relevantes vs el brief de la mision** (a resolver durante implementacion):
1. `flows` NO tiene columna `priority`. `priority` existe solo en `tasks`. Decision a tomar: (a) omitir `priority` en el response, o (b) calcularlo como `MAX(tasks.priority) WHERE tasks.flow_id = flows.id`. **Default sugerido: (b)** -- ver AC8.
2. `flows.status` usa `completed`, no `done`. Sin embargo `tasks.status` SI tiene `done`. El campo `task_counts.done` se refiere a tasks, no a flows.
3. El filtro `?status=done` sobre `/api/flows` no matchea ningun flow real (no existe ese status). Ver AC4 -- se acepta tanto interpretacion literal (filtrar por valor exacto enviado) como alias `done -> completed`. **Default sugerido: filtrado literal sin alias** (mas testeable, menos magia).

---

## SECCION 1 -- Endpoint `GET /api/flows`

**Query params (todos opcionales):**
- `status` -- string. Filtra `flows.status = ?`.
- `autonomy` -- string. Filtra `flows.autonomy = ?`.
- `q` -- string. Aplica `flows.name LIKE '%' || ? || '%'` (case-insensitive recomendado: `LOWER(name) LIKE LOWER('%' || ? || '%')`).

Los tres filtros se combinan con `AND` cuando estan presentes.

**Response (200):**
```json
{
  "flows": [
    {
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
    }
  ]
}
```

**Notas de implementacion:**
- `task_counts` se obtiene mediante JOIN agregado o subquery correlacionada sobre `tasks` agrupada por `flow_id`. Implementacion recomendada: un solo query con `LEFT JOIN` + `GROUP BY flows.id` y `SUM(CASE WHEN tasks.status = ... THEN 1 ELSE 0 END)`.
- `priority` del flow: como flows no tiene columna `priority`, derivarlo via `COALESCE(MAX(tasks.priority), 0)` por flow (alineado con AC8). Si se decide omitir, documentarlo aqui.
- `created_at` / `updated_at` se devuelven como enteros epoch en milisegundos (tal como estan almacenados).
- Si la query no matchea ningun flow, retornar `{ "flows": [] }` con HTTP 200. NO devolver 404.
- Ningun parametro desconocido genera error: ignorar silenciosamente params no soportados.

---

## SECCION 2 -- Endpoint `GET /api/stats`

**Query params:** ninguno.

**Response (200):**
```json
{
  "flows": {
    "total":      0,
    "queued":     0,
    "running":    0,
    "done":       0,
    "failed":     0
  },
  "tasks": {
    "total":      0,
    "queued":     0,
    "running":    0,
    "done":       0,
    "failed":     0
  }
}
```

**Notas de implementacion:**
- Conteos globales sobre todas las filas de cada tabla, sin filtros.
- `flows.done` en el response: como `flows.status` no tiene valor `done`, mapear a `COUNT(*) WHERE status = 'completed'` para que el shape del response sea simetrico con `tasks`. Documentar esta decision en el codigo. (Alternativa: usar literal `'done'` y devolver siempre 0, lo cual es semanticamente incorrecto -- preferir el mapping a `completed`.)
- `total >= queued + running + done + failed`: puede haber otros statuses (`hibernated`, `cancelled`, `ready`, `waiting-waiter`) que aportan al total pero no estan desglosados.
- 2 queries `SELECT status, COUNT(*) ... GROUP BY status` (uno por tabla) son suficientes.

---

## SECCION 3 -- Criterios de aceptacion (testeables)

### AC1 -- /api/flows responde 200 con array
- `GET /api/flows`
- Esperado: HTTP 200; `body.flows` es `Array`; `Array.isArray(body.flows) === true`.

### AC2 -- Shape de cada Flow
- Para cualquier item `f` en `body.flows`:
  - `typeof f.id === 'string'` y no vacio
  - `typeof f.name === 'string'`
  - `f.status` ∈ `{queued, running, hibernated, completed, failed, cancelled}`
  - `typeof f.autonomy === 'string'`
  - `Number.isInteger(f.priority)` y `f.priority >= 0`
  - `Number.isInteger(f.created_at)` y `Number.isInteger(f.updated_at)` (epoch ms)
  - `f.task_counts` es objeto con keys `total, queued, running, done, failed`

### AC3 -- Coherencia de task_counts
- Para cualquier `f.task_counts`:
  - Cada valor es `Number.isInteger` y `>= 0`
  - `f.task_counts.total >= f.task_counts.queued + f.task_counts.running + f.task_counts.done + f.task_counts.failed` (el resto -- `ready`, `waiting-waiter`, `cancelled` -- queda en el delta)

### AC4 -- Filtro por status
- `GET /api/flows?status=done`
- Esperado: HTTP 200; cada `f` cumple `f.status === 'done'`. **Nota:** dado que `flows.status` no acepta `done`, el array esperado es vacio `[]`. La regla a verificar es: ningun flow con `status != 'done'` aparece en el response.
- Test complementario recomendado: `GET /api/flows?status=completed` -> todos los items tienen `f.status === 'completed'`.

### AC5 -- Filtro por substring en name
- Precondicion: existe al menos un flow con `name` que contenga la substring `visor` (case-insensitive).
- `GET /api/flows?q=visor`
- Esperado: HTTP 200; para cada `f` en el array, `f.name.toLowerCase().includes('visor') === true`.

### AC6 -- /api/stats responde 200 con shape correcto
- `GET /api/stats`
- Esperado: HTTP 200.
- `body.flows.total` y `body.tasks.total` son `Number.isInteger` y `>= 0`.
- Las claves `queued, running, done, failed` existen en ambos sub-objetos y son enteros `>= 0`.
- `body.flows.total >= body.flows.queued + body.flows.running + body.flows.done + body.flows.failed`.
- `body.tasks.total >= body.tasks.queued + body.tasks.running + body.tasks.done + body.tasks.failed`.

### AC7 -- Readonly
- Ningun request a `GET /api/flows` ni `GET /api/stats` modifica filas en `flows`, `tasks`, `events`, ni dispara INSERT/UPDATE/DELETE.
- Verificacion: snapshot `SELECT COUNT(*), MAX(updated_at) FROM flows; SELECT COUNT(*), MAX(updated_at) FROM tasks; SELECT COUNT(*) FROM events;` antes y despues de N requests; valores identicos.

### AC8 -- Derivacion de priority del flow
- Para cada `f` en `body.flows`:
  - `f.priority === MAX(tasks.priority WHERE tasks.flow_id = f.id)` o `0` si el flow no tiene tasks.
- (Si la implementacion decide omitir `priority`, este AC debe relajarse explicitamente y reflejarse en seccion 1.)

### AC9 -- Combinacion de filtros
- `GET /api/flows?status=running&autonomy=L3&q=foo`
- Esperado: HTTP 200; cada `f` cumple `f.status === 'running'` AND `f.autonomy === 'L3'` AND `f.name` contiene `foo` (case-insensitive).

### AC10 -- Params desconocidos no rompen
- `GET /api/flows?foo=bar&baz=qux`
- Esperado: HTTP 200; mismo response que `GET /api/flows` sin params.

---

## Fuera de alcance (no-AC)

- Paginacion / ordenamiento configurable -- el orden por defecto se asume `ORDER BY flows.updated_at DESC` pero no se testea en este AC.
- Auth / permisos -- asumido manejado upstream.
- Caching headers -- no requeridos en este flow.
- Endpoints POST/PUT/DELETE sobre `/api/flows` -- no existen en este alcance.
