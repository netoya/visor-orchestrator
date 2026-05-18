# AC -- Endpoint GET /api/waiters (Flow 6 / 12)

Fecha: 2026-05-17
PM: Camila
Spec maestro referencia: `2026-05-17-spec-ui-visor-orchestrator.md` -- US-5 "Waiters con condiciones".
ACs previos relacionados: `ac-bootstrap.md`, `ac-api-flows.md`, `ac-api-flow-detail.md`, `ac-task-detail.md`, `ac-api-sessions.md`.

---

## Contexto / Schema real (verificado)

DB: `/home/angel/projects/autonomous-orchestrator/state/orchestrator.db` (readonly).

**Tabla `waiters` (schema REAL, verificado con `.schema`):**

```sql
CREATE TABLE waiters (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'passive' CHECK(mode IN ('passive','active')),
  kind TEXT NOT NULL,
  prompt TEXT NOT NULL,
  schema_json TEXT NOT NULL DEFAULT '{}',
  timeout_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK(status IN ('waiting','fulfilled','rejected','timeout','invalid')),
  value_json TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  fulfilled_by TEXT,
  fulfilled_at INTEGER,
  -- Columnas exclusivas de modo activo
  condition_kind TEXT,
  condition_params_json TEXT,
  poll_interval_ms INTEGER NOT NULL DEFAULT 60000,
  poll_max_attempts INTEGER NOT NULL DEFAULT 1440,
  ...
);
```

**Observaciones clave del schema real:**
- `mode` solo admite `passive | active` (CHECK constraint).
- `status` solo admite `waiting | fulfilled | rejected | timeout | invalid` (CHECK constraint).
- `expires_at` es `NOT NULL` -- siempre existe (no hay caso "sin expires_at" para waiters reales). El caso borde de `expires_at == null` queda como defensa por si la fila se lee de una DB en migracion (ver AC-12).
- `schema_json` es `NOT NULL DEFAULT '{}'` -- siempre hay un string, pero puede ser `'{}'` (vacio) o malformado.
- `condition_kind` y `condition_params_json` son `NULL`-able y aplican solo a `mode='active'`.
- `last_attempt_at` es `NULL` mientras `attempts = 0`.

**Tabla `tasks`:** se accede para resolver `task_stage` (join por `waiters.task_id = tasks.id`).
**Tabla `flows`:** se accede para resolver `flow_name` (join por `waiters.flow_id = flows.id`).

---

## SECCION 1 -- Endpoint `GET /api/waiters`

**Path:** `GET /api/waiters`.

**Query params (opcionales):**

| Param | Tipo | Validacion | Descripcion |
|---|---|---|---|
| `status` | string | uno de `waiting | fulfilled | rejected | timeout | invalid` | Filtra por `status` exacto. Cualquier otro valor: 400. |

Si `status` viene vacio (`?status=`), tratarlo como **ausente** (devolver todos).

**Status codes:**

| Code | Cuando |
|---|---|
| 200 | Query ejecutada con exito (puede devolver `[]`). |
| 400 | `status` presente pero con valor fuera del enum permitido. |
| 500 | Error de DB no manejado. La respuesta `{ "error": "internal_error" }`. |

---

## SECCION 2 -- Forma de la respuesta (200 OK)

La respuesta es **siempre un array JSON** (nunca un objeto envoltorio). Vacio = `[]`.

**Campos comunes a todo waiter:**

```json
{
  "id": "string",
  "flow_id": "string",
  "flow_name": "string",
  "task_id": "string",
  "task_stage": "string | null",
  "step_id": "string",
  "mode": "passive | active",
  "kind": "string",
  "prompt": "string",
  "status": "waiting | fulfilled | rejected | timeout | invalid",
  "created_at": 1715900000000,
  "expires_at": 1715903600000,
  "expires_in_s": 3540,
  "timeout_ms": 3600000,
  "attempts": 0,
  "last_attempt_at": null,
  "value_json": null,
  "fulfilled_by": null,
  "fulfilled_at": null,
  "schema_invalid": false,
  "available_actions": ["..."],
  "schema_properties": { "...": "..." }
}
```

**Campos extra solo si `mode == "active"`:**

```json
{
  "condition_kind": "string | null",
  "condition_params": { "...": "..." } | null,
  "condition_params_invalid": false,
  "poll_interval_ms": 60000,
  "poll_max_attempts": 1440
}
```

---

## SECCION 3 -- Criterios de aceptacion

### AC-1 -- Endpoint expuesto y registrado

- El handler vive en `server/routes/waiters.ts` y se monta en `server/index.ts` con `app.route('/api/waiters', waitersRoute)`.
- Responde a `GET /api/waiters` con `Content-Type: application/json; charset=utf-8`.
- **No** acepta otros verbos (POST, PUT, DELETE, PATCH) -- esos deben devolver 405 o lo que Hono entregue por default (acepto el default).

### AC-2 -- Filtro `status` con validacion estricta

- Sin query param `status` (o `?status=`): devuelve todos los waiters (cualquier estado).
- Con `status` igual a uno de los 5 valores del enum: filtra por ese estado exacto.
- Con `status` distinto a los 5 valores permitidos: **400** con body `{ "error": "invalid_status", "allowed": ["waiting","fulfilled","rejected","timeout","invalid"] }`.
- El filtro es case-sensitive (`?status=Waiting` => 400).

### AC-3 -- Orden estable

- Resultado ordenado por `created_at DESC, id ASC` (los mas recientes primero; `id` rompe empate de manera determinista para QA).

### AC-4 -- Join con `tasks` y `flows`

- Cada item incluye `flow_name` (de `flows.name`) y `task_stage` (de `tasks.stage`).
- Si por alguna razon el join no matchea (referential integrity rota), `flow_name` y/o `task_stage` pueden ser `null` -- **no** tirar 500 por esto. El endpoint es read-only y debe ser tolerante.

### AC-5 -- Parser de `schema_json` para `mode='passive'`

Comportamiento por defecto **aplica a ambos modos** (passive y active) porque `schema_json` existe en todos los waiters, pero la UI solo lo destaca para passive.

1. Intentar `JSON.parse(schema_json)`. Si **falla**:
   - `schema_invalid = true`
   - `available_actions = null`
   - `schema_properties = null`
2. Si parsea OK y es un objeto:
   - `schema_invalid = false`
   - Si existe `parsed.properties.action.enum` y es un array no vacio: `available_actions = parsed.properties.action.enum` (copia tal cual, en el orden del enum).
   - Si no existe ese path pero existe `parsed.properties` (objeto no vacio): `available_actions = Object.keys(parsed.properties)` (orden de declaracion en el JSON).
   - Si `parsed.properties` no existe o es vacio: `available_actions = null`.
   - `schema_properties` siempre se expone como `parsed.properties ?? null` para que la UI pueda render avanzado (tooltips con tipos).
3. Si parsea OK pero **no** es un objeto (e.g. `"foo"`, `42`, `null`, `[]`): tratarlo como malformado para este endpoint => `schema_invalid = true`, `available_actions = null`, `schema_properties = null`.

### AC-6 -- Campos extra para `mode='active'`

Cuando `mode == "active"`, el item incluye **adicionalmente**:

- `condition_kind`: copia textual de la columna (puede ser `null`).
- `condition_params`: resultado de `JSON.parse(condition_params_json)`. Si la columna es `NULL`, `''` o `'null'`: `condition_params = null`. Si parsea OK: el valor parseado. Si falla el parse: `condition_params = null` y `condition_params_invalid = true`.
- `condition_params_invalid`: boolean. `true` solo cuando hubo intento de parse y fallo. `false` cuando `condition_params_json` era `NULL` (no hay nada que parsear) o cuando parseo OK.
- `poll_interval_ms`: copia textual de la columna (siempre presente; default DB 60000).
- `poll_max_attempts`: copia textual de la columna (siempre presente; default DB 1440).

Cuando `mode == "passive"`, **no** incluir las claves `condition_kind`, `condition_params`, `condition_params_invalid`, `poll_interval_ms`, `poll_max_attempts` en el JSON (omitidas, no `null`). Mantiene el payload limpio para passive.

### AC-7 -- Calculo de `expires_in_s`

- Solo se calcula si `status == "waiting"` Y `expires_at != null`.
- Formula: `expires_in_s = Math.floor((expires_at - Date.now()) / 1000)`.
- Puede ser **negativo** si el waiter ya esta vencido pero el dispatcher aun no lo marco como `timeout` (caso real, no descartar). La UI muestra esto como "vencido hace Xs".
- Si `status != "waiting"`: `expires_in_s = null`.
- Si `expires_at == null` (caso borde defensivo, ver AC-12): `expires_in_s = null`.

### AC-8 -- Campos `attempts`, `last_attempt_at` siempre presentes

- `attempts` se devuelve siempre (default DB 0).
- `last_attempt_at` se devuelve siempre, con `null` si en DB es `NULL`.
- Validos tanto para passive como active (passive puede haber tenido intentos de fulfill rechazados que incrementaron `attempts`).

### AC-9 -- Performance

- Query unica con `LEFT JOIN` sobre `flows` y `tasks`. **No** N+1.
- Tiempo de respuesta < 100ms para una DB con <= 1000 waiters (rango actual y proyectado del orchestrator).

### AC-10 -- Read-only enforced

- La conexion sqlite usa flag readonly. Cualquier `INSERT/UPDATE/DELETE` al endpoint, aun como bug accidental, debe **fallar a nivel driver** (mejor que silencioso).
- Reflejado en healthcheck (`/api/health.db_writable == false`).

### AC-11 -- Sin paginacion en MVP

- El endpoint devuelve **todos** los matches sin `limit`/`offset`. Si en el futuro la tabla crece > 1000 filas, se agrega paginacion en un AC posterior.
- Acepto este riesgo porque el caso operativo real son < 20 waiters simultaneos.

### AC-12 -- Casos borde (ver SECCION 5)

Todos los casos borde de la SECCION 5 estan cubiertos por los tests de `waiters-schema.spec.ts` (responsabilidad de Sofia, no de este endpoint, pero documentados aqui como AC).

---

## SECCION 4 -- Ejemplos de respuesta

### 4.1 -- Waiter `passive` con `schema_json` valido y enum

```json
{
  "id": "waiter-01HMX9Y8...",
  "flow_id": "flow-01HMX9...",
  "flow_name": "chess-check-detection",
  "task_id": "task-01HMX9...",
  "task_stage": "review",
  "step_id": "step-approve-merge",
  "mode": "passive",
  "kind": "operator-decision",
  "prompt": "El analisis detecto un check forzado en 3 jugadas. Aprobar merge?",
  "status": "waiting",
  "created_at": 1715900000000,
  "expires_at": 1715903600000,
  "expires_in_s": 3540,
  "timeout_ms": 3600000,
  "attempts": 0,
  "last_attempt_at": null,
  "value_json": null,
  "fulfilled_by": null,
  "fulfilled_at": null,
  "schema_invalid": false,
  "available_actions": ["approve", "reject", "request_changes"],
  "schema_properties": {
    "action": {
      "type": "string",
      "enum": ["approve", "reject", "request_changes"]
    },
    "reason": {
      "type": "string"
    }
  }
}
```

### 4.2 -- Waiter `passive` con `schema_json` malformado

```json
{
  "id": "waiter-01HMXAB...",
  "flow_id": "flow-01HMXA...",
  "flow_name": "visor-bootstrap",
  "task_id": "task-01HMXA...",
  "task_stage": "scaffold",
  "step_id": "step-confirm-overwrite",
  "mode": "passive",
  "kind": "operator-confirmation",
  "prompt": "Sobreescribo package.json existente?",
  "status": "waiting",
  "created_at": 1715900500000,
  "expires_at": 1715904100000,
  "expires_in_s": 4040,
  "timeout_ms": 3600000,
  "attempts": 1,
  "last_attempt_at": 1715900900000,
  "value_json": null,
  "fulfilled_by": null,
  "fulfilled_at": null,
  "schema_invalid": true,
  "available_actions": null,
  "schema_properties": null
}
```

Nota: el `attempts: 1` ilustra un intento previo de fulfill que fue rechazado (status sigue siendo `waiting`).

### 4.3 -- Waiter `active`

```json
{
  "id": "waiter-01HMXCD...",
  "flow_id": "flow-01HMXC...",
  "flow_name": "deploy-staging",
  "task_id": "task-01HMXC...",
  "task_stage": "wait-ci",
  "step_id": "step-poll-ci-status",
  "mode": "active",
  "kind": "ci-status-poll",
  "prompt": "Esperando que el pipeline de CI termine.",
  "status": "waiting",
  "created_at": 1715900000000,
  "expires_at": 1715986400000,
  "expires_in_s": 82340,
  "timeout_ms": 86400000,
  "attempts": 7,
  "last_attempt_at": 1715901720000,
  "value_json": null,
  "fulfilled_by": null,
  "fulfilled_at": null,
  "schema_invalid": false,
  "available_actions": null,
  "schema_properties": null,
  "condition_kind": "http-status",
  "condition_params": {
    "url": "https://ci.internal/builds/9182",
    "expected_status": 200,
    "expected_body_match": "\"conclusion\":\"success\""
  },
  "condition_params_invalid": false,
  "poll_interval_ms": 60000,
  "poll_max_attempts": 1440
}
```

---

## SECCION 5 -- Casos borde

### CB-1 -- Waiter con `expires_at == null` (defensivo)

El schema dice `NOT NULL`, pero si por bug de migracion una fila tuviera `NULL`, el endpoint debe responder igual con `expires_in_s = null` en vez de tirar excepcion. No se inventa `expires_at` -- se devuelve `null` literal en el JSON.

### CB-2 -- `schema_json == null`

El schema dice `NOT NULL DEFAULT '{}'`, pero si llegase a leerse `NULL`: tratarlo igual que JSON malformado => `schema_invalid: true, available_actions: null, schema_properties: null`.

### CB-3 -- `schema_json == '{}'` (vacio valido)

- `schema_invalid: false`
- `available_actions: null` (no hay properties, no hay enum).
- `schema_properties: null` (porque `parsed.properties` no existe).

### CB-4 -- `schema_json` valido pero `properties` ausente

Ejemplo: `{"type":"object"}`. Mismo resultado que CB-3.

### CB-5 -- `properties.action` existe pero sin `enum`

Ejemplo: `{"properties": {"action": {"type":"string"}, "reason": {"type":"string"}}}`.

- `schema_invalid: false`
- `available_actions: ["action", "reason"]` (fallback a keys de properties).
- `schema_properties: { action: {...}, reason: {...} }`.

### CB-6 -- `properties.action.enum` es array vacio `[]`

Tratarlo como si no existiera el enum. Cae al fallback de keys de properties (igual que CB-5).

### CB-7 -- `condition_params_json` malformado en waiter activo

- `condition_params: null`
- `condition_params_invalid: true`
- Resto de campos del waiter normales (no tirar 500).

### CB-8 -- `condition_params_json` es `NULL` en waiter activo

- `condition_params: null`
- `condition_params_invalid: false` (no hubo intento de parse).

### CB-9 -- Waiter active sin `condition_kind`

Defensivo: devolver `condition_kind: null`. La UI lo mostrara como "sin condicion declarada".

### CB-10 -- Waiter con `status != "waiting"`

- `expires_in_s: null`.
- `fulfilled_by`, `fulfilled_at`, `value_json`: copiar tal cual de la DB (pueden ser no-null).
- Sigue incluyendo `available_actions`/`schema_properties` calculados (utiles para auditar a posteriori que opciones tuvo el operador).

### CB-11 -- Waiter cuyo `flow_id` o `task_id` no resuelve en el join

- `flow_name: null` y/o `task_stage: null`. No 500.

### CB-12 -- DB con 0 waiters

- 200 OK con body `[]`.

### CB-13 -- Caracteres de control / no-ASCII en `prompt`

- Devolver tal cual (UTF-8 preservado). No escapar mas alla de lo que hace `JSON.stringify` por default.

---

## SECCION 6 -- Definition of Done

- [ ] Endpoint registrado en `server/routes/waiters.ts` y montado en `server/index.ts`.
- [ ] AC-1 a AC-11 cumplidos.
- [ ] Todos los casos borde CB-1 a CB-13 cubiertos por el codigo (no necesariamente todos por tests E2E, eso lo decide Sofia, pero el codigo no debe romper en ninguno).
- [ ] El parser de `schema_json` esta extraido a una funcion pura testeable (Mateo: ya lo tiene como action item).
- [ ] `smoke-api-waiters.md` con `curl` de los 4 escenarios (passive valido, passive invalido, active, lista sin filtro).
- [ ] Mateo confirma performance < 100ms con seed de prueba.
- [ ] Roman aprueba el code review.

---

## Notas finales (PM)

- **No** se incluye fulfill desde la UI (regla de Roman, ya cubierta en US-5). Este AC es solo para **lectura**.
- El campo `schema_properties` lo expongo de manera generosa porque le da a la UI suficiente para que en el futuro un widget de form-builder pueda armarse sin pedir cambios al backend. Es una pequena concesion al YAGNI pero el costo marginal es 0 (ya estamos parseando el JSON).
- Si Roman/Mateo en revision deciden que `schema_properties` es scope creep, lo removemos -- el AC-5 sigue siendo valido sin esa key.
