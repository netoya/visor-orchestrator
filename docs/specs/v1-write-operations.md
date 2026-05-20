# Spec v1 — Visor write operations

> **Estado**: borrador para revisión.
> **Autor**: orquestador autónomo (sesión Claude Code 2026-05-19).
> **Objetivo**: dotar al visor de 2 capacidades de escritura **respetando el principio "visor readonly sobre la DB"**: crear flows nuevos y resolver waiters pasivos pendientes.

---

## 1. Contexto

El visor hoy es **diagnóstico puro**: backend Hono :5176 que lee `orchestrator.db` con `readonly: true, fileMustExist: true` y frontend Vanilla + Vite :5173 con tabs Flows / Sessions / Waiters / Stats.

El feedback del operador (Angel) revela 2 gaps operativos:

1. **Para lanzar un flow, hoy hay que salir del visor y hacer `npx orchestrator coordinate "<idea>"` en terminal.** Romper el contexto del visor cuesta tiempo y obliga a recordar el comando.
2. **Cuando un flow llega a un waiter pasivo (espera input humano), el flow se para y no hay señal natural en el visor para resolverlo.** Hoy hay que correr `npx orchestrator waiter list --pending` y `npx orchestrator waiter fulfill <id> --json '...'` desde terminal.

Este spec define cómo añadir esas 2 capacidades al visor.

---

## 2. Principio arquitectural — **no negociable**

> **El visor sigue abriendo la DB en modo `readonly: true`.** Toda escritura va por **spawn del CLI del orchestrator**, nunca directa a SQLite.

Razones:
- Garantiza que el orchestrator es el único punto de control de su DB (eventos JSONL, leases, integridad transaccional).
- Si el visor escribiera SQLite directo, tendría que duplicar la lógica de `fulfillWaiter()` (que es una transacción atómica que también emite `waiter.fulfilled` en `events.jsonl`) y eso es campo minado.
- Mantiene la propiedad "el visor mira, no toca" del README original.

**Consecuencia operativa**: el backend del visor necesita saber dónde está el orchestrator. Nueva env var:
```
ORCHESTRATOR_DIR=/home/angel/projects/autonomous-orchestrator
```
(default actual asume layout WSL; en mac dev sería `/Users/macbookpro/project/autonomous-orchestrator`).

---

## 3. Capacidad A — "Crear flow" (patrón prepare → confirm)

> **Validado en CLI el 2026-05-20** con un experimento que demostró el circuito completo: planner detectó 4 ambigüedades, creó waiter pasivo `clarification`, fulfill desde CLI con JSON básico, re-coordinate con respuestas, plan firme producido. Evidencia: `state/conversations/EXPERIMENT-PLAN-{PROPOSAL,FINAL}.md` del autonomous-orchestrator.

### 3.1 Flujo conceptual

```
usuario escribe idea
   ↓
[POST /api/flows/prepare]   ← spawn coordinate planner-mode
   ↓
agente Roman (planner) lee codebase
   ↓
   ┌─ caso A: SIN ambigüedad
   │   → escribe PLAN-PROPOSAL.md con status="PLAN_READY"
   │   → UI muestra resumen + botón "Confirmar"
   │   → click → [POST /api/flows/confirm] → coordinate ejecutor
   │
   └─ caso B: CON ambigüedad
       → crea UN waiter pasivo (kind=clarification) con schema_json = preguntas
       → escribe PLAN-PROPOSAL.md con status="BLOCKED-BY-WAITER" + lista NL de las preguntas
       → UI detecta el waiter del flow y renderiza form dinámico (ver §4)
       → usuario responde → [POST /api/waiters/:id/fulfill]
       → UI llama [POST /api/flows/prepare] DE NUEVO con la idea original + respuestas como contexto
       → planner re-corre, ahora sin ambigüedad → produce PLAN_READY → loop
```

Lo importante: el visor orquesta el ciclo iterativo. El usuario no toca terminal en ningún momento.

### 3.1.1 ASCII del flujo de pantallas

```
═══════════════════════════════════════════════════════════════════════
  ① IDLE                                                  (state=idle)
═══════════════════════════════════════════════════════════════════════
  ┌─────────────────────────────────────────────────────────────────┐
  │ Tab: Coordinate                                                  │
  │                                                                  │
  │   New flow (planner-assisted)                                    │
  │   Describe the idea. The planner will draft a plan and ask       │
  │   for clarifications if anything is ambiguous.                   │
  │                                                                  │
  │   ╔══════════════════════════════════════════════════════════╗  │
  │   ║ [textarea, 12 rows, monospace, autofocus]                ║  │
  │   ║ "Crear un comando CLI para ver el estado del flow..."    ║  │
  │   ║                                                          ║  │
  │   ╚══════════════════════════════════════════════════════════╝  │
  │                                                                  │
  │              [ Prepare ]        [ Clear ]                        │
  │                                                                  │
  │   ─── Recent prepares (from localStorage) ───                    │
  │   • 01KS2G8W... — "Crear comando CLI..."   (proposal-ready)      │
  │   • 01KS2GEB... — "Renombrar header..."    (executing)           │
  └─────────────────────────────────────────────────────────────────┘
                            │
                            │ click "Prepare"
                            │ POST /api/flows/prepare
                            │   { idea, previousFlowId?, answers? }
                            ▼
═══════════════════════════════════════════════════════════════════════
  ② PREPARING                                       (state=preparing)
═══════════════════════════════════════════════════════════════════════
  ┌─────────────────────────────────────────────────────────────────┐
  │   ⠹  Roman is analyzing your idea...                             │
  │                                                                  │
  │   Flow:    01KS2G8W4G9D0GTQT4GSVNAN9Y                            │
  │   Elapsed: 0:23                                                  │
  │                                                                  │
  │   (polling /api/flows/:id/prepare-state every 2s)                │
  │                                                                  │
  │                          [ Cancel ]                              │
  └─────────────────────────────────────────────────────────────────┘
                            │
                            │ poll detects state change
                            │
                ┌───────────┴───────────┐
                │                       │
        (no ambiguity)          (ambiguity detected)
        proposal-ready          blocked-by-waiter
                │                       │
                ▼                       ▼
═══════════════════════════════════════════════════════════════════════
  ③ᴬ PROPOSAL READY                       ③ᴮ BLOCKED BY WAITER
  (state=proposal-ready)                  (state=blocked-by-waiter)
═══════════════════════════════════════════════════════════════════════
  ┌──────────────────────────────┐      ┌──────────────────────────────┐
  │  Plan ready — review         │      │  Clarifications needed       │
  │                              │      │                              │
  │ ┌──────────────────────────┐ │      │  The planner needs you to    │
  │ │ # Plan firme...          │ │      │  resolve these before        │
  │ │                          │ │      │  drafting a firm plan:       │
  │ │ ## Decisiones            │ │      │                              │
  │ │ | repo | autonomous-or...│ │      │   1. ¿En qué repo va el      │
  │ │ | format | table         │ │      │      comando?                │
  │ │ ...                      │ │      │   2. ¿Forma del comando?     │
  │ │                          │ │      │   3. ¿Formato de salida?     │
  │ │ ## Archivos              │ │      │   4. ¿Qué entidades incluir? │
  │ │ - src/cli/flow-status.ts │ │      │                              │
  │ │ ...                      │ │      │  ┌────────────────────────┐  │
  │ │                          │ │      │  │ repo:                  │  │
  │ │ ## Próximo paso          │ │      │  │ [▼ autonomous-orchest] │  │
  │ │ PLAN_READY               │ │      │  │                        │  │
  │ └──────────────────────────┘ │      │  │ format:                │  │
  │                              │      │  │ [▼ table             ] │  │
  │ ┌──────────────────────────┐ │      │  │                        │  │
  │ │ [ Confirm and execute ]  │ │      │  │ include:               │  │
  │ │ [ Edit idea ]            │ │      │  │ [▼ tasks-and-waiters ] │  │
  │ └──────────────────────────┘ │      │  └────────────────────────┘  │
  └──────────────────────────────┘      │                              │
                │                       │   [ Submit answers ]         │
                │                       │   [ Respond differently ] ←  │
                │                       │   [ Cancel ]                 │
                │ click Confirm         │                              │
                │ POST /api/flows/      │   (click "Respond            │
                │  confirm              │    differently" → estado     │
                │                       │    siguiente abajo)          │
                │                       └──────────────────────────────┘
                ▼                                     │
═══════════════════════════════════════════════════                   │
  ④ CONFIRMING            (state=confirming)        │
═══════════════════════════════════════════════════                   │
  ┌──────────────────────────────────────┐         │ click Submit
  │   ⠹  Launching execution coordinator │         │
  │      based on PLAN-FINAL.md...        │         │ ① POST /api/waiters
  │                                       │         │   /:id/fulfill
  │   Prepare flow:  01KS2G8W...          │         │ ② POST /api/flows
  │   Execute flow:  01KS2GZ... (creating)│         │   /prepare con
  └──────────────────────────────────────┘         │   {idea original,
                │                                    │    previousFlowId,
                │ backend OK                         │    answers}
                ▼                                    ▼
═══════════════════════════════════════════════════════════════════════
  ⑤ EXECUTING                          (back to ② PREPARING, loop)
═══════════════════════════════════════════════════════════════════════
   Redirect to tab "Flows"             (max 3 iteraciones por linaje
   with drawer open on                  según §9.7; tras 3, banner
   the execute flow.                    "no convergencia, edita idea")


═══════════════════════════════════════════════════════════════════════
  ③ᴮ' RESPOND DIFFERENTLY        (sub-estado de blocked-by-waiter)
  (operador descarta las preguntas y reinterpreta la idea original;
   las preguntas se mantienen visibles arriba como contexto fijo)
═══════════════════════════════════════════════════════════════════════
  ┌─────────────────────────────────────────────────────────────────┐
  │  Respond differently                                             │
  │                                                                  │
  │  ┌─── The planner asked (for reference) ────────────────────┐   │
  │  │ 1. ¿En qué repo va el comando?                           │   │
  │  │    — autonomous-orchestrator / visor-orchestrator        │   │
  │  │ 2. ¿Forma del comando?                                   │   │
  │  │    — status-with-flow-id / flow-status-subcommand        │   │
  │  │ 3. ¿Formato de salida?                                   │   │
  │  │    — table / json / jsonl                                │   │
  │  │ 4. ¿Qué entidades incluir?                               │   │
  │  │    — tasks / tasks-and-waiters / all                     │   │
  │  └──────────────────────────────────────────────────────────┘   │
  │                                                                  │
  │  None of these captures what you want?                           │
  │  Describe what you actually want — this overrides the            │
  │  original idea.                                                  │
  │                                                                  │
  │  ╔═══════════════════════════════════════════════════════════╗  │
  │  ║ [textarea, 8 rows, autofocus, monospace]                  ║  │
  │  ║ "En realidad no quiero un CLI nuevo en orchestrator,      ║  │
  │  ║  quiero un endpoint HTTP en visor que devuelva JSON       ║  │
  │  ║  con el estado del flow para consumirlo desde scripts."   ║  │
  │  ╚═══════════════════════════════════════════════════════════╝  │
  │                                                                  │
  │   [ Send custom response ]  [ Back to questions ]  [ Cancel ]    │
  │                                                                  │
  │  Note: el waiter actual quedará huérfano hasta su timeout.       │
  └─────────────────────────────────────────────────────────────────┘
                            │
                            │ click "Send custom response"
                            │ POST /api/flows/prepare con
                            │   { idea, previousFlowId, customResponse }
                            │ (NO se fulfill del waiter actual)
                            ▼
                    (vuelve a ② PREPARING con el nuevo flowId)


═══════════════════════════════════════════════════════════════════════
  ⓔ ERROR                                             (state=error)
═══════════════════════════════════════════════════════════════════════
  ┌─────────────────────────────────────────────────────────────────┐
  │  ✗  Something went wrong                                         │
  │                                                                  │
  │  prepare exit=1: PrismaClientInitialization...                   │
  │                                                                  │
  │              [ Retry ]      [ Edit idea ]                        │
  └─────────────────────────────────────────────────────────────────┘
```

**Leyenda**:
- ① / ② / ³ᴬ / ³ᴮ / ³ᴮ' / ⁴ / ⁵ / ⓔ = estados de la state machine (§3.2).
- Las flechas verticales son transiciones; las horizontales con `┴` son bifurcaciones según resultado del planner.
- El bucle ³ᴮ → ② (o ³ᴮ' → ② vía custom response) son las iterativas del flujo (max 3 vueltas por §9.7).
- ³ᴮ' es alternativa a ³ᴮ: en lugar de responder el form, el operador descarta y escribe libre. Misma transición destino (② PREPARING).
- El estado ⓔ es alcanzable desde cualquier otro (timeout, exit code distinto de 0 del spawn, etc.). Las acciones `Retry` o `Edit idea` reinician la state machine.



**Nueva tab "Coordinate"** en la barra de tabs (junto a Flows / Sessions / Waiters / Stats).

**Estado de la pantalla (state machine):**

| Estado | Qué se muestra | Acciones disponibles |
|---|---|---|
| `idle` | Textarea + botón `Prepare` | Pegar idea, click Prepare |
| `preparing` | Spinner + última idea readonly | (esperar) |
| `proposal-ready` | Renderiza `PLAN-PROPOSAL.md` (caso A) | Botón `Confirm and execute`, botón `Edit idea` |
| `blocked-by-waiter` | Renderiza preguntas del waiter + form dinámico | Submit answers, `Respond differently`, Cancel |
| `respond-differently` | Sub-estado: textarea grande para reinterpretar la idea | Send custom response, Back to questions, Cancel |
| `confirming` | Spinner + diff resumen | (esperar) |
| `executing` | Redirige a tab `Flows` con drawer del flow ejecutor | — |
| `error` | Banner rojo + stderr | Reintentar, editar |

**Layout vertical de la tab (estado `idle`):**
- Header: `New flow (planner-assisted)` + texto secundario `"Describe the idea. The planner agent will draft a plan and ask for clarifications if anything is ambiguous."`.
- Textarea grande (rows=12, monospace, autofocus) con placeholder + ejemplo.
- Botón primario `Prepare` (disabled si textarea < 20 chars).
- Botón secundario `Clear`.

**Layout en estado `proposal-ready`:**
- Header: `Plan ready — review`.
- Renderiza el markdown de `PLAN-PROPOSAL.md` con sintáxis (mismo renderer que usa el visor para drawers existentes).
- Sticky footer: botón primario `Confirm and execute` + botón `Edit idea` (vuelve a `idle`).

**Layout en estado `blocked-by-waiter`:**
- Header: `Clarifications needed`.
- Renderiza el bloque `Ambigüedades detectadas` de `PLAN-PROPOSAL.md` en lenguaje natural.
- **Form dinámico** generado desde el `schema_json` del waiter (ver §4.2 para el renderer compartido).
- Botón primario `Submit answers`, botón secundario `Cancel`.

**Recent launches**: bajo el formulario, lista de los últimos 5 flows lanzados desde esta tab (basado en `localStorage` que guarda el `flowId` de cada `Prepare`).

### 3.3 Backend

**DOS endpoints distintos:**

```
POST /api/flows/prepare
Body: { idea: string, previousFlowId?: string, answers?: object }
Returns: {
  flowId: string,
  plannerTaskId: string,
  status: 'preparing'    // status del planner — se chequea con polling al endpoint /api/flows/:id
}

POST /api/flows/confirm
Body: { prepareFlowId: string }
Returns: {
  executeFlowId: string,
  executeCoordinatorTaskId: string
}
```

**Validación:**
- `idea` requerido, min 20 chars, max 8000 chars.
- `previousFlowId` opcional — para iteraciones tras fulfill de waiter; el planner incorpora las respuestas anteriores leyendo el `value_json` del waiter del flow previo.
- `answers` opcional — alternativa: el frontend pasa directamente las respuestas en lugar de hacer que el planner las relea del waiter.

**Implementación `launchPrepare` (server/operations.ts):**

```ts
import { spawn } from 'node:child_process'

export async function launchPrepare(opts: {
  idea: string
  previousFlowId?: string
  answers?: Record<string, unknown>
}) {
  const orchDir = process.env.ORCHESTRATOR_DIR
  if (!orchDir) throw new Error('ORCHESTRATOR_DIR not configured')

  // El prompt al coordinator es plantilla planner-mode:
  // - Si hay answers, las inyectamos como "Decisiones ya resueltas".
  // - Si no, planner-mode normal con la idea cruda.
  const plannerPrompt = buildPlannerPrompt(opts.idea, opts.answers, opts.previousFlowId)

  return new Promise<{ flowId: string; plannerTaskId: string }>((resolve, reject) => {
    const proc = spawn('npx', ['orchestrator', 'coordinate', plannerPrompt], {
      cwd: orchDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    })

    let stdout = ''; let stderr = ''
    proc.stdout.on('data', (c) => (stdout += c.toString()))
    proc.stderr.on('data', (c) => (stderr += c.toString()))
    proc.on('error', (e) => reject(new Error(`spawn-error: ${e.message}`)))
    proc.on('close', (exit) => {
      if (exit !== 0) return reject(new Error(`prepare exit=${exit}: ${stderr}`))
      const m1 = stdout.match(/Flow created:\s*([A-Z0-9]+)/)
      const m2 = stdout.match(/Coordinator task:\s*([A-Z0-9]+)/)
      if (!m1 || !m2) return reject(new Error(`unexpected output: ${stdout}`))
      resolve({ flowId: m1[1], plannerTaskId: m2[1] })
    })
  })
}

function buildPlannerPrompt(idea: string, answers?: Record<string, unknown>, prevFlow?: string): string {
  const answersBlock = answers
    ? `\n\nDECISIONES YA RESUELTAS POR EL OPERADOR:\n${JSON.stringify(answers, null, 2)}\n` +
      (prevFlow ? `\nFlow de prepare anterior (contexto): ${prevFlow}\n` : '')
    : ''

  return `EXPERIMENTO planner-mode${answersBlock ? ' (re-plan tras clarificaciones)' : ''}.

REGLAS CRITICAS:
- NO crees tasks de impl/test/verify.
- Crea EXACTAMENTE 1 task: slug planner-analyze, agente softwarefactory_roman.
- Esa task hace TODO el planner-work: lee codebase, escribe doc, crea waiter si hace falta.
- Tras crear la task, emite <<COORDINATOR_DONE: planner-analyze task created>>.

IDEA del operador:
"${idea}"
${answersBlock}
---

DESCOMPON en 1 task. Slug literal: planner-analyze. Agente: softwarefactory_roman.

[PROMPT de la task — ver detalle en autonomous-orchestrator/docs/planner-mode.md una vez se documente como feature oficial. Por ahora, replicar el prompt validado en /tmp/experiment-planner-mode-prompt.txt del experimento del 2026-05-20.]`
}
```

**Implementación `launchConfirm`:**

```ts
export async function launchConfirm(opts: { prepareFlowId: string }) {
  // 1. Leer .coord-notes/PLAN-PROPOSAL.md o PLAN-FINAL.md del prepare flow.
  //    Validar que status === 'PLAN_READY'. Si no, error 409.
  // 2. Spawn `npx orchestrator coordinate` con prompt:
  //    "Ejecuta el plan firme documentado en state/conversations/EXPERIMENT-PLAN-FINAL.md
  //     del flow <prepareFlowId>. Descompon en tasks ejecutivas y arranca."
  // ... resto similar a launchPrepare.
}
```

**Endpoint `server/index.ts`:**

```ts
app.post('/api/flows/prepare', async (c) => {
  const body = await c.req.json<{ idea?: string; previousFlowId?: string; answers?: Record<string, unknown> }>()
  if (!body.idea || body.idea.length < 20) return c.json({ error: 'idea too short' }, 400)
  if (body.idea.length > 8000) return c.json({ error: 'idea too long' }, 400)
  try {
    const result = await launchPrepare(body)
    return c.json({ ...result, status: 'preparing' })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

app.post('/api/flows/confirm', async (c) => {
  const body = await c.req.json<{ prepareFlowId?: string }>()
  if (!body.prepareFlowId) return c.json({ error: 'prepareFlowId required' }, 400)
  try {
    const result = await launchConfirm({ prepareFlowId: body.prepareFlowId })
    return c.json(result)
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})
```

### 3.4 Detección de estado del prepare flow (frontend polling)

Tras llamar `POST /api/flows/prepare`, el frontend obtiene `flowId`. Hace polling cada 2s a un nuevo endpoint:

```
GET /api/flows/:id/prepare-state
Returns: {
  state: 'preparing' | 'proposal-ready' | 'blocked-by-waiter' | 'error',
  proposalMarkdown?: string,       // contenido de PLAN-PROPOSAL.md o PLAN-FINAL.md
  waiter?: WaiterRow,              // si state === 'blocked-by-waiter'
  errorMessage?: string,
}
```

**Lógica del endpoint** (lee de la DB readonly + del filesystem):

```ts
app.get('/api/flows/:id/prepare-state', async (c) => {
  const flowId = c.req.param('id')
  // 1. Buscar waiter pasivo waiting del flow → si hay, state='blocked-by-waiter' + waiter row + leer PLAN-PROPOSAL.md.
  // 2. Si no hay waiter pendiente y existe PLAN-FINAL.md o PLAN-PROPOSAL.md con PLAN_READY → state='proposal-ready'.
  // 3. Si planner-analyze task aún corre → state='preparing'.
  // 4. Si planner-analyze failed → state='error'.
})
```

### 3.5 Iteración (caso B: hay waiter)

1. Frontend detecta `state='blocked-by-waiter'`.
2. Renderiza form dinámico desde `waiter.schema_json` (ver §4.2).
3. Operador rellena + click `Submit answers`.
4. Frontend hace `POST /api/waiters/:waiterId/fulfill` con el value (ver §4).
5. Tras 200 OK del fulfill, frontend invoca `POST /api/flows/prepare` con `{ idea, previousFlowId: <flowId del prepare anterior>, answers: <value submitted> }`.
6. Nuevo `prepareFlowId` → polling al endpoint state → eventualmente `proposal-ready`.
7. Loop hasta `PLAN_READY` o que el operador cancele.

### 3.6 Riesgos identificados

- **Argv length**: `idea` + answers serializadas pasan por línea de comando. macOS/Linux límite ~256KB; safe.
- **Planner prompt no documentado**: el prompt validado vive en `/tmp/experiment-planner-mode-prompt.txt`. **Acción**: portar a `autonomous-orchestrator/docs/planner-mode.md` y referenciar desde `buildPlannerPrompt` (parte de la implementación, no del spec).
- **Iteración infinita**: si el planner crea waiter, fulfill, re-planner, vuelve a crear otro waiter, etc. — riesgo de loop. Mitigación: límite hard de 3 iteraciones por idea; tras 3 fulfills, forzar `PLAN_READY` o devolver error.
- **CLI no disponible**: si `ORCHESTRATOR_DIR` no existe → 500.
- **PLAN-PROPOSAL.md no aparece**: si el agente Roman muere antes de escribirlo, polling se queda en `preparing` indefinidamente. Mitigación: timeout en frontend (90s sin cambio de estado → mostrar error con botón Reintentar).

### 3.5 Health check

Extender `/api/health`:
```ts
{
  db: { ok: true, path, sizeKb },
  orchestrator: {
    dir: process.env.ORCHESTRATOR_DIR,
    cliReachable: boolean,  // probar `npx orchestrator --help` con timeout 3s
  }
}
```

---

## 4. Capacidad B — "Resolver waiter pasivo"

### 4.1 Frontend

**Extender tab Waiters (ya existe)**:
- Filtros: agregar chip `Status: waiting` (default activado) + `kind: <any>`.
- Cada fila de waiter `status='waiting'`:
  - Click sobre la fila → **drawer derecho** se abre (patrón ya existente en visor).
  - En el drawer, además de los datos read-only actuales (id, flow, task, kind, prompt, created_at, expires_at):
    - **Bloque `Prompt`** destacado (texto, monoespaciado si necesario).
    - **Bloque `Schema`** con `schema_json` formateado.
    - **Form dinámico** que renderiza inputs según el `schema_json` (ver §4.2 abajo).
    - **Botones**:
      - `Approve` (color primario) — envía el form rellenado al backend.
      - `Reject with reason` — abre sub-form con textarea `reason` + envía.
      - `Cancel` (cierra drawer sin acción).

### 4.2 Generación dinámica del form desde `schema_json`

El `schema_json` del waiter es un JSON Schema básico. Ejemplos reales del codebase:

```json
{
  "type": "object",
  "properties": {
    "decision": { "type": "string", "enum": ["approved", "rejected"] },
    "comments": { "type": "string" },
    "reviewed_by": { "type": "string" }
  },
  "required": ["decision", "reviewed_by"]
}
```

```json
{
  "type": "object",
  "properties": {
    "action": { "type": "string" },
    "reason": { "type": "string" }
  },
  "required": ["action", "reason"]
}
```

**Renderer mínimo** (no se necesita una lib pesada de JSON Schema):
- `type: "string"` con `enum` → `<select>`.
- `type: "string"` sin enum → `<input type=text>` o `<textarea>` si la prop se llama `comments`/`reason`/`description`/`notes`.
- `type: "boolean"` → toggle.
- `type: "number"` → `<input type=number>`.
- `required: [...]` → marca fields como obligatorios.

### 4.2.1 Escape hatch global: "Respond differently"

**Motivación**: a veces el planner produce un set de preguntas que **no captura** la visión real del operador. Las opciones que ofrece pueden ser todas incorrectas, o las preguntas mismas pueden estar mal planteadas. Forzar al operador a responder con valores del schema cuando "no es eso lo que quiero" degrada el plan resultante.

**Solución**: un botón global `Respond differently` debajo del form, junto a `Submit answers`/`Cancel`. Al activarlo, el form structured se reemplaza por una **textarea grande** donde el operador escribe libremente lo que quiere — efectivamente reinterpretando la idea original.

**Comportamiento UI**:
- Estado A (default): se muestra el form structured derivado del `schema_json`.
- Click en `Respond differently` → estado B:
  - **Bloque "The planner asked (for reference)" en la parte superior**: lista read-only de las preguntas + opciones que el planner había generado. Se mantiene visible para que el operador NUNCA pierda contexto de qué se estaba preguntando mientras escribe su respuesta libre. Renderizado como sección colapsable opcional (default: expandida).
  - Debajo de las preguntas: textarea (rows=8, autofocus, monospace) con placeholder *"Describe what you actually want — this overrides the original idea."*
  - Botones: `Send custom response` (primario), `Back to questions` (secundario, restaura el form structured A), `Cancel` (terciario).
- Click `Send custom response`:
  - El waiter actual **NO se fulfill**. Queda en `waiting` (huella muerta hasta su timeout — ver "Deuda técnica" abajo).
  - El visor llama `POST /api/flows/prepare` con body:
    ```json
    {
      "idea": "<idea original del prepare anterior>",
      "previousFlowId": "<flowId del prepare con el waiter superado>",
      "customResponse": "<texto libre del operador>"
    }
    ```
  - `buildPlannerPrompt` incluye un bloque adicional:
    ```
    REINTERPRETACIÓN DEL OPERADOR:
    El operador descartó las preguntas anteriores y aclara:
    "<customResponse>"
    
    Considera esto como sobrescritura/clarificación de la idea original.
    ```
  - El planner re-corre con todo el contexto (idea original + customResponse) y produce un nuevo `PLAN-PROPOSAL.md` o un nuevo waiter más alineado.

**Por qué NO fulfill del waiter anterior**:
- El `schema_json` del waiter define lo que el callback `onValid` de la task del planner espera. Enviar un payload tipo `{_userRedirect: "texto"}` requeriría que el callback supiera interpretar ese campo extra, lo cual contamina la API del waiter.
- El waiter "superseded" queda en `waiting` hasta su `timeout_ms` (24h por defecto) o hasta que algún cron de limpieza lo marque `timeout` o `cancelled`.

**Deuda técnica conocida**:
- Waiters supersedidos viven en `waiting` hasta su timeout. No afectan funcionalmente al sistema (el flow del prepare anterior queda muerto, no se vuelve a procesar). Pero contaminan la tab `Waiters` del visor.
- **Mitigación v1**: el visor filtra de la tab `Waiters` aquellos cuyo `flow_id` esté marcado como "superseded" en `localStorage`.
- **Fix v1.1**: añadir `npx orchestrator waiter reject <id> --reason "superseded by user redirect"` al CLI del orchestrator + invocarlo desde el `customResponse` flow para cerrar limpiamente.

**Cuando `Respond differently` aparece**:
- Siempre que el form derive de un `schema_json` con `properties` no triviales (≥1 field). Es decir, en todos los waiters de tipo `clarification` típicos.
- Para waiters de "decisión pura" (`{decision: enum[approved,rejected]}`) podría considerarse opcional, pero por consistencia v1 lo muestra siempre — el operador simplemente lo ignora.

**Visual de "Approve" vs "Reject"**:
- Si el schema tiene una prop `decision` o `action` con enum incluyendo `"approved"`/`"rejected"`, el botón `Approve` pre-rellena `decision="approved"` antes de submit; `Reject with reason` (condicional por §9.6) pre-rellena `decision="rejected"` y obliga `reason`/`comments`.
- Si el schema no encaja en ese patrón, mostrar solo `Submit answers` genérico.
- `Respond differently` es ortogonal — convive con cualquiera de los anteriores.

### 4.3 Backend

**Nuevo endpoint:**

```
POST /api/waiters/:id/fulfill
Body: { value: object }  // el JSON que va a fulfill --json
```

**Validación:**
- Path `:id` debe existir, ser de `status='waiting'`, `mode='passive'`. Si no → 409 Conflict.
- `value` requerido, objeto JSON (rechazar arrays, strings, etc).
- (Opcional, defensa en profundidad) validar `value` contra el `schema_json` del waiter con un validator JSON Schema básico. Si falla → 400 con detalle. Esto evita pasar JSON inválido al CLI.

**Implementación:**

```ts
// server/operations.ts (continuación)
export async function fulfillWaiter(opts: { waiterId: string; value: unknown }) {
  const orchDir = process.env.ORCHESTRATOR_DIR
  if (!orchDir) throw new Error('ORCHESTRATOR_DIR not configured')

  const jsonStr = JSON.stringify(opts.value)

  return new Promise<{ ok: true }>((resolve, reject) => {
    const proc = spawn(
      'npx',
      ['orchestrator', 'waiter', 'fulfill', opts.waiterId, '--json', jsonStr],
      { cwd: orchDir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 }
    )
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (c) => (stdout += c.toString()))
    proc.stderr.on('data', (c) => (stderr += c.toString()))
    proc.on('error', (e) => reject(new Error(`spawn-error: ${e.message}`)))
    proc.on('close', (exit) => {
      if (exit !== 0) return reject(new Error(`fulfill exit=${exit}: ${stderr}`))
      // CLI: "Waiter <id> fulfilled"
      if (!stdout.includes('fulfilled')) return reject(new Error(`unexpected fulfill output: ${stdout}`))
      resolve({ ok: true })
    })
  })
}
```

**Endpoint en `server/index.ts`:**

```ts
app.post('/api/waiters/:id/fulfill', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ value?: unknown }>()
  if (!body.value || typeof body.value !== 'object' || Array.isArray(body.value)) {
    return c.json({ error: 'value must be a JSON object' }, 400)
  }
  // (Opcional) validar contra schema_json del waiter — lookup en DB readonly.
  try {
    const result = await fulfillWaiter({ waiterId: id, value: body.value })
    return c.json(result)
  } catch (err: any) {
    const msg = String(err.message)
    if (msg.includes('not waiting') || msg.includes('not found')) return c.json({ error: msg }, 409)
    return c.json({ error: msg }, 500)
  }
})
```

**Sobre "reject"**: el CLI del orchestrator hoy **NO tiene un subcomando `reject`**. La forma de rechazar es **expresarlo en el JSON del fulfill** (ej. `{"decision":"rejected","reason":"..."}`). El callback `onValid` del waiter en el código de la task decide qué hacer con eso. Esto es **un detalle importante** que la UI debe respetar: aunque el botón se llame "Reject", por debajo es un fulfill con un payload distinto.

Si en el futuro se añade `npx orchestrator waiter reject <id> --reason ...` al CLI del orchestrator, este spec lo asume; por ahora, no.

### 4.4 Riesgos identificados

- **Schema_json inválido del waiter**: el creador del waiter puede haber escrito un schema mal formado. El renderer debe degradar a textarea `value as JSON` para que el operador pueda escribir el payload a mano.
- **Race con auto-fulfill**: si dos operadores intentan fulfill el mismo waiter al mismo tiempo, el segundo recibirá un error del CLI ("waiter not in waiting state"). El backend retorna 409 → frontend refresca la lista.
- **Authz**: el `authz_json` del waiter puede declarar roles permitidos. El visor hoy no tiene sesión de usuario — fuera de scope para v1. Documentar como gap. v2 podría añadir auth header `x-operator-id` y validar.

### 4.5 Live notification (opcional pero alto valor)

El visor ya tiene `ws` (websockets) en `package.json`. **Implementación recomendada**:
- Backend: watcher de la tabla `waiters` (polling cada 2s o vía un trigger SQLite con un event handler) que emite por WebSocket cuando aparece un waiter nuevo con `status='waiting'`.
- Frontend: badge contador en la tab Waiters + sonido opcional + toast si la tab no está activa.

Esto cierra el loop "humano-en-medio": cuando un flow se detiene esperando aprobación, el operador se entera al instante en lugar de tener que ir a chequear.

---

## 5. Cambios de configuración

### 5.1 Env vars nuevas

```
ORCHESTRATOR_DIR=/Users/macbookpro/project/autonomous-orchestrator
```

Default en `server/db.ts` y `server/operations.ts` debe usar `path.dirname(ORCHESTRATOR_DB_PATH)/..` como fallback inteligente.

### 5.2 README

Sección nueva `## Operaciones (v1)` explicando:
- Cómo lanzar un flow desde la UI.
- Cómo resolver un waiter desde la UI.
- Diferencia entre "visor lee la DB" y "visor invoca el CLI" (la escritura siempre va por canales formales).

---

## 6. Plan de implementación (resumen)

> Pre-requisito en el repo `autonomous-orchestrator`: documentar el prompt planner-mode como feature oficial (`docs/planner-mode.md`) basándose en el experimento validado (`/tmp/experiment-planner-mode-prompt.txt`). Sin esto, el visor depende de un prompt no commiteado.

| Task | Agente | Archivos | Estimado |
|---|---|---|---|
| plan-visor-write | roman (TL) — revisar este spec, aprobar o ajustar | docs/specs/v1-*.md | 15 min |
| **pre: planner-mode-doc** (autonomous-orchestrator) | roman | autonomous-orchestrator/docs/planner-mode.md + ejemplo prompt | 30 min |
| impl-backend-prepare-confirm | mateo (BE) | server/operations.ts (`launchPrepare`, `launchConfirm`, `buildPlannerPrompt`), server/index.ts (3 endpoints: `/api/flows/prepare`, `/api/flows/confirm`, `/api/flows/:id/prepare-state`), server/db.ts, server/types.ts | 90 min |
| impl-backend-fulfill | mateo (BE) | server/operations.ts (`fulfillWaiter`), server/index.ts (`/api/waiters/:id/fulfill`) | 30 min |
| impl-frontend-coordinate-tab | valeria (FE) | src/components/tabs/CoordinateTab.{js,css} con state machine (idle/preparing/proposal-ready/blocked-by-waiter/confirming/error), src/api.js, src/main.js (registro) | 90 min |
| impl-frontend-schema-form | valeria (FE) | src/components/forms/SchemaForm.js (compartido entre CoordinateTab y WaiterDrawer — renderiza form dinámico desde JSON Schema) | 60 min |
| impl-frontend-waiter-drawer | valeria (FE) | src/components/drawers/WaiterDrawer.js (extender) — usa SchemaForm | 45 min |
| impl-ws-notification (opcional) | mateo + valeria | server/ws.ts, src/lib/ws-client.js | 60 min |
| update-tests | sofia (QA) | playwright tests: (a) prepare con idea ambigua → waiter → fulfill → re-prepare → confirm; (b) fulfill waiter directo desde tab Waiters | 60 min |
| verify + repair (bucle 3 vueltas) | sofia | — | 45 min |
| final-report | dante | docs/specs/v1-final.md | 10 min |

**Total estimado**: ~8h de trabajo del orchestrator (con paralelismo backend/frontend ~5h reales).

---

## 7. Test plan E2E

### Test 1 — Prepare → Confirm (caso A: sin ambigüedad)
1. Arrancar dev server visor + orchestrator dispatcher con `AGENT_RUNNER=claude`.
2. Navegar a tab `Coordinate`.
3. Pegar idea bien definida (ej: "Renombrar el header 'User' a 'User ID' en src/components/admin/AdminUsersClient.tsx").
4. Click `Prepare` → state `preparing` (polling cada 2s).
5. Esperar transición a `proposal-ready` → renderiza `PLAN-PROPOSAL.md` con `Status: PLAN_READY`.
6. Click `Confirm and execute` → state `confirming` → redirect a tab `Flows` con drawer del flow ejecutor.

### Test 2 — Prepare con ambigüedad (caso B: waiter intermedio)
1. Pegar idea ambigua (ej: "Crear un comando CLI para ver el estado del flow actual" — sin especificar repo, formato, scope).
2. Click `Prepare`.
3. Esperar transición a `blocked-by-waiter` → renderiza preguntas en NL + form dinámico desde `schema_json`.
4. Rellenar respuestas en el form (ej: `{repo: "autonomous-orchestrator", format: "table", include: "tasks-and-waiters"}`).
5. Click `Submit answers` → POST fulfill → POST prepare con `previousFlowId` + `answers`.
6. Esperar transición a `proposal-ready` con `PLAN-FINAL.md`.
7. Click `Confirm and execute` → flow ejecutor lanzado.

### Test 3 — Fulfill waiter directo desde tab Waiters
1. (Setup) Lanzar un flow conocido que cree un waiter pasivo `approve-architecture` y dejarlo en `waiting`.
2. Navegar a tab `Waiters`.
3. Verificar que aparece con badge `waiting`.
4. Click → drawer abre con SchemaForm dinámico.
5. Rellenar `{decision: "approved", reviewed_by: "test"}`.
6. Click `Approve` → backend POST fulfill → status `fulfilled` en la lista (refetch).
7. Verificar que la task asociada reanuda (status `waiting-waiter` → `ready`).

### Test 2 — Fulfill waiter
1. (Setup) Crear un waiter pasivo de prueba via CLI: lanzar un flow conocido que cree `approve-architecture` y dejarlo en `waiting`.
2. Navegar a tab `Waiters`.
3. Verificar que aparece con badge `waiting`.
4. Click → drawer abre.
5. Verificar que el form renderiza correctamente según el `schema_json`.
6. Rellenar `{decision: "approved", reviewed_by: "test"}`.
7. Click `Approve`.
8. Verificar `{ok: true}` del backend.
9. Verificar que el waiter pasa a `fulfilled` en la lista (refetch).
10. Verificar que la task asociada al waiter reanuda (status pasa de `waiting-waiter` a `ready`).

### Test 3 — Reject (vía fulfill con payload de rechazo)
Similar al Test 2 pero con `{decision: "rejected", reason: "test reject"}`.

---

## 8. Lo que **no** entra en v1

- Edición/cancelación de flows en curso.
- Pausa/resume manual.
- Modificación de waiters activos (los que pollean condiciones — solo se cancelan).
- Sistema de usuarios/auth (`authz_json` se ignora en v1).
- Crear waiters manualmente desde la UI (solo se resuelven los existentes).
- Editar el `events.jsonl`.

---

## 9. Decisiones tomadas (MVP)

1. ✅ Principio "visor readonly sobre la DB + spawn CLI para escribir": **aceptado**.
2. ✅ Env var `ORCHESTRATOR_DIR`: **aceptado**.
3. ✅ Patrón prepare → confirm: **validado en CLI el 2026-05-20** (3 fases: planner detecta ambigüedad → waiter pasivo → fulfill → re-planner produce PLAN_READY). Evidencia: `EXPERIMENT-PLAN-{PROPOSAL,FINAL}.md` en `state/conversations/`.
4. ✅ **WS live-notification de waiters → v1.1, NO entra en MVP**. v1 usa polling 2s al endpoint `/api/flows/:id/prepare-state` + refetch manual de la tab Waiters.
5. ✅ **JSON Schema validation backend: best-effort**. v1 valida solo que `value` sea object (no array, no primitivo). NO valida contra `schema_json` del waiter — eso lo decide el callback `onValid` de la task en el orchestrator (es donde realmente importa). El frontend hace validación cliente del form contra el schema (required, enums); el backend solo es un passthrough JSON al CLI.
6. ✅ **Botón Reject condicional**: solo se renderiza cuando el `schema_json` tiene un campo con enum que incluya `rejected` o `decline`. Si el schema no lo soporta, solo se muestra `Submit`. Razón: muchos waiters son puro "input" (clarifications, etc.) sin concepto de aprobar/rechazar — forzar Reject confunde.
7. ✅ **Límite iteraciones planner ↔ waiter: hard cap 3**. Tras 3 fulfills consecutivos del mismo "linaje" (mismo `idea`, encadenados por `previousFlowId`), el visor muestra banner: *"El planner no está convergiendo después de 3 rondas de clarificación. Edita la idea original para reformular, o cancela."*  
   El conteo vive en `localStorage` del cliente (no en backend); reset al editar la idea o cancelar.
8. ✅ **`planner-mode.md` se documenta primero en `autonomous-orchestrator`**: pre-task obligatoria del plan de §6. Sin esto el visor consume un prompt que solo existe en `/tmp/`.

---

## 10. Anexo — Evidencia del experimento (2026-05-20)

Validación end-to-end del circuito prepare→waiter→fulfill→re-prepare en CLI puro, sin tocar el orchestrator core. Se usó coordinate con prompt planner-mode (1 task `planner-analyze` con roman) sobre una idea intencionalmente ambigua.

**Idea de prueba**: "Crear un comando CLI nuevo en algún repo para ver el estado del flow actual: tasks con status, waiters pendientes, duración total."

**Fase 1 — `coordinate` con prompt planner-mode**
- Flow `01KS2G8W4G9D0GTQT4GSVNAN9Y` creado.
- Roman detectó 4 ambigüedades: `repo`, `command_shape`, `format`, `include`.
- Creó waiter pasivo `clarification` `01KS2GAH0V11YK3SSHSZK48MJX` con `schema_json` enumerando las 4 preguntas.
- Escribió `state/conversations/EXPERIMENT-PLAN-PROPOSAL.md` con `Status: BLOCKED-BY-WAITER`.

**Fase 2 — fulfill via CLI**
```bash
npx orchestrator waiter fulfill 01KS2GAH0V11YK3SSHSZK48MJX --json '{
  "repo": "autonomous-orchestrator",
  "command_shape": "flow-status-subcommand",
  "format": "table",
  "include": "tasks-and-waiters"
}'
# → Waiter 01KS2GAH0V11YK3SSHSZK48MJX fulfilled
```

**Fase 3 — re-`coordinate` con respuestas inyectadas**
- Flow `01KS2GEBV1KDRPV3ZS1D76CN64` creado.
- Roman incorporó las 4 decisiones, leyó codebase del orchestrator CLI.
- Escribió `state/conversations/EXPERIMENT-PLAN-FINAL.md` con `Status: PLAN_READY`: archivos exactos, esqueleto TypeScript, tests, riesgos.

**Tiempo total del circuito**: ~5 minutos (30s + <1s fulfill + 45s re-plan). Coste razonable para evitar que el operador apruebe un plan ambiguo que después requiere re-trabajo.

---

**Siguiente paso si se aprueba este spec**: lanzar un flow del autonomous-orchestrator con el prompt "implementar v1-write-operations.md siguiendo el plan de §6, empezando por la pre-task de documentar planner-mode.md".
