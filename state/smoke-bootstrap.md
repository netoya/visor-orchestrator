# Smoke Test — Fase Bootstrap (Flow 1/12)

**Proyecto:** VISOR-ORCHESTRATOR
**Fase:** bootstrap
**QA:** Sofia
**Fecha:** 2026-05-17

---

## Status: PASS

---

## Test ejecutado

`tests/e2e/health.spec.ts` — `GET /api/health returns ok and read-only DB info`

## Comando

```bash
DISPLAY=:0 XAUTHORITY=/run/user/1000/.mutter-Xwaylandauth.L4W5O3 \
  timeout 120 npx playwright test tests/e2e/health.spec.ts --reporter=list
```

## Output

```
Running 1 test using 1 worker

  ✓  1 [chromium] › tests/e2e/health.spec.ts:3:1 › GET /api/health returns ok and read-only DB info (45ms)

  1 passed (925ms)
```

---

## Aserciones validadas

1. `res.status() === 200` ✓
2. `body.ok === true` ✓
3. `body.db_writable === false` ✓
4. `typeof body.db_size_kb === 'number'` y `> 0` ✓
5. `typeof body.db_path === 'string'` y contiene `'orchestrator.db'` ✓
6. `typeof body.uptime_s === 'number'` ✓
7. `typeof body.node_version === 'string'` ✓
8. `body.build_hash === 'dev'` ✓

---

## Notas

- `playwright.config.ts` ya tenia `webServer` configurado (comando `npm run dev`, port 5176, `reuseExistingServer: !CI`, timeout 30s). No hizo falta arrancar el server manualmente.
- El test ejecuto en ~45ms; el setup total (incluyendo arranque del webServer) tomo 925ms.
- Implementacion de Mateo en `server/index.ts` cumple con el contrato definido por Camila en `ac-bootstrap.md` seccion 2.1.

## Definition of Done (seccion 7 de ac-bootstrap.md)

- [x] `npm run dev` levanta tsx en port 5176 sin errores (verificado via webServer fixture).
- [x] `/api/health` retorna 200 con JSON valido.
- [x] `db_size_kb` es numero `> 0`.
- [x] `db_writable === false`.
- [x] `npx playwright test tests/e2e/health.spec.ts` pasa en verde.
