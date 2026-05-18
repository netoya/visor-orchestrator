# AC - Flow 4: visor-ws-stream

**Flow**: 4 de 12 (VISOR-ORCHESTRATOR)
**Owner PM**: Camila
**Objetivo**: Endpoint WebSocket `/api/ws` que streamea eventos en tiempo real al frontend (consumido por flow 5).

---

## 1. Endpoint WebSocket

- [ ] AC1.1 - El server expone `GET ws://localhost:5176/api/ws` y acepta upgrades a WebSocket (status 101 Switching Protocols).
- [ ] AC1.2 - Una request HTTP normal (no-upgrade) a `/api/ws` retorna error claro (400/426), no rompe el server.
- [ ] AC1.3 - El endpoint convive con los endpoints REST existentes (`/api/health`, `/api/flows`, `/api/stats`, `/api/flows/:id/detail`) sin regresiones.

## 2. Evento inicial `hello`

- [ ] AC2.1 - Al establecer la conexion, el server envia inmediatamente (antes de cualquier otro evento) un mensaje JSON con shape `{type: 'hello', ts: <ISO 8601 string>}`.
- [ ] AC2.2 - El campo `ts` es una fecha ISO valida en UTC (parseable por `new Date(ts)`).
- [ ] AC2.3 - El `hello` llega en menos de 2 segundos desde el momento de conexion.

## 3. Polling de Stats

- [ ] AC3.1 - El server lee `Stats` desde la DB (`/home/angel/projects/autonomous-orchestrator/state/orchestrator.db`, readonly) cada ~2 segundos.
- [ ] AC3.2 - Compara el snapshot actual contra el anterior por igualdad de contenido (no por referencia).
- [ ] AC3.3 - Si difiere, emite `{type: 'stats', payload: Stats}` al cliente.
- [ ] AC3.4 - Si NO difiere, NO emite nada (evita ruido en el canal).
- [ ] AC3.5 - El payload `Stats` respeta el tipo declarado en `server/types.ts`.
- [ ] AC3.6 - En la primera vuelta del polling, emite `stats` aunque sea el primer snapshot (para hidratar al cliente).

## 4. Polling de Flows

- [ ] AC4.1 - El server lee la lista de flows recientes desde la DB cada ~2 segundos.
- [ ] AC4.2 - Mantiene un snapshot del estado previo (id + signature relevante: status, updated_at, task counts).
- [ ] AC4.3 - Calcula diferencias:
  - `added`: flow IDs presentes ahora y ausentes en el snapshot previo.
  - `updated`: flow IDs presentes en ambos pero con cambios detectables.
- [ ] AC4.4 - Si `added.length > 0 || updated.length > 0`, emite `{type: 'flows-changed', payload: {added: string[], updated: string[]}}`.
- [ ] AC4.5 - Si no hay cambios, NO emite nada.
- [ ] AC4.6 - Los arrays `added` y `updated` contienen unicamente flow IDs (strings), no objetos completos. El frontend hidrata via REST.

## 5. Tipos TypeScript

- [ ] AC5.1 - En `server/types.ts` existe el union type:
  ```ts
  export type WsEvent =
    | { type: 'hello'; ts: string }
    | { type: 'stats'; payload: Stats }
    | { type: 'flows-changed'; payload: { added: string[]; updated: string[] } };
  ```
- [ ] AC5.2 - El handler del WS tipa los mensajes salientes como `WsEvent` (no `any`).
- [ ] AC5.3 - `npm run typecheck` (o equivalente `tsc --noEmit`) pasa sin errores.

## 6. Cierre limpio

- [ ] AC6.1 - Al recibir `close` desde el cliente, el server cancela el `setInterval` asociado a esa conexion.
- [ ] AC6.2 - Al recibir `error` en la conexion, tambien se cancela el polling y se cierra el socket.
- [ ] AC6.3 - Multiples conexiones concurrentes mantienen intervalos independientes (no se pisan).
- [ ] AC6.4 - Despues de 10 conexiones abiertas + cerradas en sucesion, no quedan intervalos activos (verificable con un counter de intervalos o inspeccion manual).
- [ ] AC6.5 - No hay leaks de memoria detectables tras 5 min de cliente conectado-desconectado en loop.

## 7. Test E2E

- [ ] AC7.1 - Existe el archivo `tests/e2e/ws.spec.ts`.
- [ ] AC7.2 - El test arranca el server (o asume server arriba en port 5176) y conecta a `ws://localhost:5176/api/ws`.
- [ ] AC7.3 - Aserciones del test:
  - Recibe `hello` en menos de 2 segundos. Valida shape: `type === 'hello'` y `ts` parseable como Date.
  - Recibe al menos un evento `stats` en menos de 5 segundos. Valida shape: `type === 'stats'` y `payload` con keys esperadas de `Stats`.
  - Cierra la conexion limpiamente al final del test.
- [ ] AC7.4 - El test pasa de forma deterministica (3 ejecuciones consecutivas en verde).
- [ ] AC7.5 - PASS de este test marca AC verde para el flow.

## 8. Operacion

- [ ] AC8.1 - No se ejecutan `git commit` durante este flow (entrega via archivos en working dir).
- [ ] AC8.2 - La DB del orquestador se lee con flag readonly; el flow nunca escribe en ella.
- [ ] AC8.3 - El intervalo de polling es configurable via constante (`POLL_INTERVAL_MS = 2000`) para tuning futuro.

---

## Definition of Done

Todos los checkboxes de las secciones 1-8 marcados, test E2E en verde, typecheck limpio, sin commits.
