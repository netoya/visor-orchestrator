# Smoke — visor-api-waiters

**Fecha:** 2026-05-17 20:14
**Resultado:** VERDE
**Modo:** manual override (Sofia creo exec-waiter pero el server tenia EADDRINUSE; relanzado, endpoint OK)

## Endpoint probado

`GET http://localhost:5176/api/waiters`

```bash
curl -fsS http://localhost:5176/api/waiters | jq '.waiters | length'
```

Resultado: returna lista de waiters con campos:
- `id`, `flow_id`, `flow_name`, `task_id`, `task_stage`
- `step_id`, `mode` (passive|active), `kind`
- `prompt`, `status`, `value_json`
- `timeout_ms`, `created_at`, `expires_at`, `expires_in_s`
- `fulfilled_by`, `fulfilled_at`
- `schema_json` (raw) + `available_actions` (parsed) + `schema_invalid` (bool)

Tamanio respuesta: >300KB con todos los waiters activos del orchestrator real.

## Filtro

`GET /api/waiters?status=waiting` aplica filtro. Tambien acepta `fulfilled|rejected|timeout|invalid`. Status invalido devuelve 400.

## Conclusion

Endpoint /api/waiters OK. Flow 6 completed VERDE. Listo para encadenar flow 7 visor-api-stats-health.
