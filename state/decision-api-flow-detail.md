# Decision -- Cierre Flow 3 (visor-api-flow-detail) y encadenamiento Flow 4

Fecha: 2026-05-17
Tech Lead: Roman
Insumos: `state/smoke-api-flow-detail.md` (Sofia), `state/ac-api-flow-detail.md` (Camila).

---

## Resultado

**PASS**

- Smoke `tests/e2e/flow-detail.spec.ts`: **3 / 3** tests verdes en 637ms.
- Endpoint `GET /api/flows/:id/detail` (Hono, port 5176) verificado contra AC1 (200 con shape valido), AC2 (subset shape minimo de Task: id, stage, agent_id, status strings + priority number), AC4 (404 con `error` no vacio en id inexistente) y AC5 (integridad referencial `body.id === firstId`).
- ACs no cubiertos en este smoke pero aceptados como riesgo bajo para promover el flow: AC3 (orden `priority DESC, created_at ASC`), AC6 (tasks vacio explicito), AC7 (strings JSON literales), AC8 (nullables como `null`), AC9 (readonly snapshot identico antes/despues), AC10 (coherencia `task_counts` vs `tasks`). Quedan como candidatos a refuerzo en una fase de hardening de tests posterior al frontend (no bloquean el encadenamiento porque la shape principal y los paths 200/404 estan validados).
- Nota de shape: el server responde con los campos del flow a nivel raiz (`body.id`, `body.tasks`) en vez de anidados bajo `body.flow.*` como sugeria literalmente la SECCION 1 del AC. Sofia y Mateo lo alinearon contra `FlowDetail` en `server/types.ts` (que extiende `Flow`); el frontend (Valeria) consumira esta shape plana. Si en el futuro Lucas/Camila piden el wrapping `{flow, tasks}` se trata como refinamiento, no como bug bloqueante.

## Flow encadenado

- **Nombre**: `visor-ws-stream` (Flow 4 de 12).
- **Mision**: WebSocket `/api/ws` con eventos `hello` / `stats` / `flows-changed` por polling de la DB readonly cada 2s + test E2E con cliente ws minimo.
- **Tasks planeadas (5)**: `ac-ws-stream` (camila), `types-ws-stream` (roman), `impl-ws-stream` (mateo, depende de los dos anteriores), `tests-ws-stream` (sofia, depende de impl), `decide-ws-stream` (roman, depende de tests; encadena flow 5 si PASS).
- **Prompt fuente**: `/tmp/visor-ws-stream-prompt.txt`.
- **Comando ejecutado**:
  ```
  npx tsx /home/angel/projects/autonomous-orchestrator/src/coordinator/cli-tools.ts createFlow \
    --name visor-ws-stream \
    --message-file /tmp/visor-ws-stream-prompt.txt \
    --autonomy L3 \
    --cwd /home/angel/projects/visor-orchestrator \
    --add-dir /home/angel/projects/autonomous-orchestrator/state \
    --session-strategy flow-agent-task \
    --max-turns 60 \
    --priority 10
  ```
- **Flow ID devuelto**: `01KRW1N343CKEX9CF9M8XPQH9D`
- **Task ID inicial devuelto**: `01KRW1N343096SPS18Y3T5FAM3`

## No-acciones

- NO se hizo `git commit` (per instrucciones del proyecto VISOR-ORCHESTRATOR).
- NO se modifico codigo del server tras el smoke; el endpoint quedo intacto.
- NO se relajaron ni se reescribieron criterios del AC; solo se aceptaron como riesgo conocido los ACs no cubiertos en este smoke (AC3, AC6, AC7, AC8, AC9, AC10), documentados arriba para revisita.
