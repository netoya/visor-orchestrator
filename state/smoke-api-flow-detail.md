# Smoke test -- GET /api/flows/:id/detail

Fecha: 2026-05-17
QA: Sofia
Spec: `tests/e2e/flow-detail.spec.ts`
Endpoint bajo test: `GET /api/flows/:id/detail` (Hono, puerto 5176)

---

## Resultado

**PASS**

- Tests pasados: **3 / 3**
- Runner: `npx playwright test tests/e2e/flow-detail.spec.ts --reporter=line`
- Tiempo total: 637ms (chromium, 1 worker, fullyParallel=false)
- Server: `npm run dev` (reuseExistingServer=true en `playwright.config.ts`); el server ya estaba corriendo y respondio 200 en `/api/health` antes de arrancar los tests.

## Cobertura

| # | Test                                                                                            | Resultado |
|---|--------------------------------------------------------------------------------------------------|-----------|
| 1 | `GET /api/flows/:id/detail` con id real (tomado de `/api/flows[0].id`) -> 200, body.id === id, body.tasks es array | PASS      |
| 2 | `GET /api/flows/nonexistent-id-xxx/detail` -> 404 con `body.error` string no vacio              | PASS      |
| 3 | Para cada task: `id` (string), `stage` (string), `agent_id` (string), `status` (string), `priority` (number) | PASS      |

> Test 3 protege contra el caso `tasks.length === 0` con un assert blando (`>= 0`) y un return early; los datos actuales en la DB de orchestrator tienen tasks reales, por lo que el shape se valido sobre tasks no vacios.

## Output relevante (ultimas lineas)

```
Running 3 tests using 1 worker
[1/3] [chromium] > tests/e2e/flow-detail.spec.ts:5:1 > GET /api/flows/:id/detail retorna 200 con flow.id correcto y tasks array
[2/3] [chromium] > tests/e2e/flow-detail.spec.ts:23:1 > GET /api/flows/:id/detail con id inexistente retorna 404 y body.error definido
[3/3] [chromium] > tests/e2e/flow-detail.spec.ts:32:1 > cada task del detail tiene id, stage, agent_id, status (strings) y priority (number)
  3 passed (637ms)
```

## Observaciones

- El endpoint cumple con AC1, AC2 (subset shape minimo de Task), AC4 y AC5 (integridad referencial: `body.id === firstId`) segun lo verificado en este smoke.
- ACs no cubiertos por este smoke (fuera del scope del brief inicial de 3 tests, candidatos a refuerzo futuro): AC3 orden `priority DESC, created_at ASC`, AC6 tasks vacio explicito, AC7 strings JSON literales, AC8 nullables, AC9 readonly snapshot, AC10 coherencia `task_counts` vs `tasks`.
- `FlowDetail` en `server/types.ts` extiende `Flow` (los campos del flow estan a nivel raiz, no anidados bajo `flow.*`). El smoke valida `body.id` y `body.tasks` consistentes con esa shape; si se quisiera enforce de `body.flow.id` se requiere reestructurar el response del server (decision pendiente con Mateo/Camila si difiere de `ac-api-flow-detail.md` seccion 1).
- No se modifico codigo del server. Solo se agrego `tests/e2e/flow-detail.spec.ts`.
- No se hizo `git commit` (per instrucciones).

## Causa probable de fallo (si FAIL)

N/A -- todos los tests pasaron.
