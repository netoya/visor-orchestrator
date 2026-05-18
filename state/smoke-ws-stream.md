# Smoke - Flow 4: visor-ws-stream

**Estado**: FAIL
**Fecha**: 2026-05-17
**Decididor**: Roman (Tech Lead)

---

## Resultado

No se encontro evidencia de smoke ejecutado para el flow visor-ws-stream.
El archivo `smoke-ws-stream.md` no existia al momento de la decision (creado por Roman para registrar el FAIL).
Todos los acceptance criteria en `ac-ws-stream.md` permanecen sin marcar (`[ ]`).

- exitCode esperado: 0
- exitCode observado: N/A (sin smoke)

---

## BLOQUEANTES

AC no cumplidos / sin evidencia (todos los del flow):

### 1. Endpoint WebSocket
- AC1.1 - `GET ws://localhost:5176/api/ws` con upgrade 101 no verificado.
- AC1.2 - Comportamiento HTTP no-upgrade no verificado.
- AC1.3 - Sin regresion check sobre REST existente.

### 2. Evento inicial `hello`
- AC2.1 - Envio inmediato de `{type:'hello', ts}` no verificado.
- AC2.2 - Validez ISO 8601 de `ts` no verificada.
- AC2.3 - Latencia < 2s no medida.

### 3. Polling de Stats
- AC3.1 - Lectura cada ~2s de Stats no verificada.
- AC3.2 - Comparacion por contenido del snapshot no verificada.
- AC3.3 - Emision `{type:'stats', payload}` ante diff no verificada.
- AC3.4 - Silencio cuando no hay diff no verificado.
- AC3.5 - Conformidad de payload con `Stats` de `server/types.ts` no verificada.
- AC3.6 - Hidratacion en primer snapshot no verificada.

### 4. Polling de Flows
- AC4.1 - Lectura cada ~2s de flows no verificada.
- AC4.2 - Snapshot previo (id + signature) no verificado.
- AC4.3 - Calculo de `added` / `updated` no verificado.
- AC4.4 - Emision `flows-changed` ante diff no verificada.
- AC4.5 - Silencio sin cambios no verificado.
- AC4.6 - Arrays con solo IDs (strings) no verificados.

### 5. Tipos TypeScript
- AC5.1 - Union type `WsEvent` en `server/types.ts` no verificado.
- AC5.2 - Handler tipa con `WsEvent` (no `any`) no verificado.
- AC5.3 - `tsc --noEmit` limpio no verificado.

### 6. Cierre limpio
- AC6.1 - Cancelacion de interval al `close` no verificada.
- AC6.2 - Cierre ante `error` no verificado.
- AC6.3 - Conexiones concurrentes con intervalos independientes no verificadas.
- AC6.4 - 10 ciclos abierto/cerrado sin intervalos colgados no verificados.
- AC6.5 - 5 min loop sin leaks no medidos.

### 7. Test E2E
- AC7.1 - `tests/e2e/ws.spec.ts` no confirmado existente.
- AC7.2 - Conexion del test a `ws://localhost:5176/api/ws` no verificada.
- AC7.3 - Aserciones (`hello` <2s, `stats` <5s, cierre limpio) no ejecutadas.
- AC7.4 - Determinismo en 3 corridas no validado.
- AC7.5 - PASS del test ausente.

### 8. Operacion
- AC8.1 - Confirmacion de no-commit pendiente.
- AC8.2 - DB readonly no verificada.
- AC8.3 - Constante `POLL_INTERVAL_MS = 2000` no verificada.

---

## Accion requerida

Ejecutar el smoke del flow (sofia/mateo) y dejar el archivo `smoke-ws-stream.md` con `Estado: PASS` y `exitCode: 0` para que Roman pueda encadenar el flow 5.
