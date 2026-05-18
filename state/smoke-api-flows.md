# Smoke API Flows

Fecha: 2026-05-17
Spec: `tests/e2e/flows-list.spec.ts`
Base URL: `http://localhost:5176`

---

Resultado: PASS
Tests corridos: 4
Tests pasados: 4
Tests fallidos: 0

---

## Output completo

```
Running 4 tests using 1 worker

  ✓  1 [chromium] › tests/e2e/flows-list.spec.ts:5:1 › GET /api/flows retorna 200 con body.flows array (35ms)
  ✓  2 [chromium] › tests/e2e/flows-list.spec.ts:12:1 › cada flow tiene id, name, status, task_counts con total>=0 (96ms)
  ✓  3 [chromium] › tests/e2e/flows-list.spec.ts:25:1 › GET /api/stats retorna 200 con flows.total y tasks.total numericos (7ms)
  ✓  4 [chromium] › tests/e2e/flows-list.spec.ts:33:1 › GET /api/flows?status=done filtra correctamente (6ms)

  4 passed (824ms)
```

Comando ejecutado: `npx playwright test tests/e2e/flows-list.spec.ts --reporter=list`

---

## Notas

- Playwright ya estaba instalado y `playwright.config.ts` ya define `webServer` con `npm run dev` en puerto 5176 (`reuseExistingServer: !process.env.CI`). El server estaba corriendo (verificado con `curl /api/health` -> 200) y fue reutilizado.
- Test #4 (`?status=done`) pasa de forma trivial porque `flows.status` en el schema real no acepta el valor `done` (usa `completed`). El array regresa vacio y el `for` no itera, por lo que ningun assert se viola. Esto coincide con AC4 del `ac-api-flows.md` (filtrado literal, sin alias). Si en el futuro se decide alias `done -> completed`, este test deberia cambiar la expectativa.
- No se modifico codigo de `server/*`. La implementacion de Mateo (`server/queries.ts`, `server/index.ts`) cubre los 4 ACs ejercitados por el smoke sin bugs detectables.
- Cobertura limitada al smoke: NO se valida AC5 (substring `q=visor`), AC7 (readonly snapshot), AC8 (`priority` derivado de `MAX(tasks.priority)`), AC9 (combinacion de filtros), ni AC10 (params desconocidos). Recomendado extender el spec en una segunda iteracion.
