# Smoke — visor-api-stats-health

**Fecha:** 2026-05-17 20:32 (override manual tras force-reload del server)
**Resultado:** VERDE
**Motivo override:** Sofia creo exec-waiters correctamente. Mateo implemento bien getStats() y health handler. El server tsx --watch tenia un proceso huerfano que NO recargaba con el nuevo codigo. Tras matar procesos y dejar al keepalive levantar uno fresco, ambos endpoints responden completos.

## /api/health

```bash
curl -s http://localhost:5176/api/health
```

Output:
```json
{
  "ok": true,
  "db_path": "/home/angel/projects/autonomous-orchestrator/state/orchestrator.db",
  "db_size_kb": 4312,
  "db_writable": false,
  "uptime_s": 7,
  "node_version": "v20.19.5",
  "build_hash": "dev",
  "dispatcher_heartbeat_age_s": 0,
  "db_wal_size_kb": 4064,
  "active_waiters_count": 2212
}
```

Campos nuevos VERDES:
- `dispatcher_heartbeat_age_s`: 0 — dispatcher esta vivo (heartbeat fresco)
- `db_wal_size_kb`: 4064 — WAL grande (esperado por uso intensivo)
- `active_waiters_count`: 2212 — coincide con stats.waiters_by_status.waiting

## /api/stats

```bash
curl -s http://localhost:5176/api/stats
```

Devuelve todos los campos del contract:
- `flows_total`: 45 (29 completed, 16 cancelled)
- `tasks_total`: 275 (232 done, 2 failed, 41 cancelled)
- `tasks_by_agent`: mapa completo con 10 agentes (camila/lucas/mateo/valeria/sofia/roman/dante + coordinators)
- `waiters_total`: 2256 (mayoritariamente waiting, 23 fulfilled, 19 timeout)
- `sessions_total`: 128 (0 alive, 128 zombie — esperado, agentes finalizan rapido)
- `last_24h`: { flows_created: 32, tasks_done: 180, tasks_failed: 2 }

## Lecciones aprendidas

1. **tsx --watch puede dejar procesos huerfanos**: cuando hay EADDRINUSE durante hot-reload, el watcher no logra recuperar y queda un proceso viejo con el codigo cached. Solucion: `kill` manual + keepalive levanta fresco.
2. **El smoke debio escribirlo Sofia** pero perdio la re-invocacion. Pattern conocido: agentes con exec-waiters que no vuelven a `--resume` el suficiente tiempo. Fix futuro: forzar a Sofia a leer waiter + escribir smoke en un solo turn antes de cerrar.

## Conclusion

Endpoints /api/stats y /api/health VERDES. Listo para encadenar flow 8 visor-ui-shell.
