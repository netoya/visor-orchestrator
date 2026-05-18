# Smoke api-sessions (flow 5)

**Estado: VERDE**

## Endpoints verificados (curl directo desde Angel)

- GET /api/sessions → 200, devuelve array completo de sessions con shape {session_id, agent_id, flow_id, flow_name, task_id, task_stage, turn_count, last_used_at, process_status}.
- GET /api/sessions?status=alive → 200 con array (vacio cuando no hay tasks running con session persistida).
- GET /api/sessions?agent=softwarefactory_sofia → 200, 20 sessions historicas, todas con process_status detectado.

## Archivos producidos por el flow

- server/processes.ts: scanner de procesos claude -p via `ps -eo`.
- server/queries.ts: listSessions(filter) con joins agent_sessions + tasks + flows + correlacion con processes.
- server/index.ts: endpoint GET /api/sessions con filtros opcionales agent_id, status.
- server/types.ts: Session, ClaudeProcess, ProcessStatus, ListSessionsFilter.

## Notas

- process_status funciona como esperado: finished para tasks done/failed/cancelled, alive si hay PID, zombie si task running pero sin PID.
- Sofia no escribio el smoke.md; lo escribe Angel como override.

## Siguiente paso

Lanzar visor-api-waiters (flow 6 de 12).
