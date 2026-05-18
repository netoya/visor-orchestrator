# Criterios de Aceptacion — Fase Bootstrap (Flow 1/12)

**Proyecto:** VISOR-ORCHESTRATOR
**Fase:** bootstrap
**PM:** Camila
**Fecha:** 2026-05-17

---

## 1. Objetivo de la fase

Levantar el esqueleto del server Hono que sirve como puerta de entrada read-only a la DB del autonomous-orchestrator. Esta fase NO incluye UI ni queries de negocio: solo health-check, apertura readonly de DB, y test E2E que valide que todo el stack arranca.

---

## 2. Endpoint `GET /api/health`

### 2.1 Contrato exacto (response 200)

```json
{
  "ok": true,
  "db_path": "/home/angel/projects/autonomous-orchestrator/state/orchestrator.db",
  "db_size_kb": 1234,
  "db_writable": false,
  "uptime_s": 42,
  "node_version": "v22.x.x",
  "build_hash": "dev"
}
```

### 2.2 Tipos y semantica por campo

| Campo          | Tipo    | Valor / Regla                                                                              |
|----------------|---------|--------------------------------------------------------------------------------------------|
| `ok`           | boolean | Siempre `true` cuando el endpoint responde 200.                                            |
| `db_path`      | string  | Ruta absoluta al archivo SQLite. Default: `/home/angel/projects/autonomous-orchestrator/state/orchestrator.db`. Si `ORCHESTRATOR_DB_PATH` esta seteado, refleja ese valor. |
| `db_size_kb`   | number  | Tamanio del archivo DB en KB. Calculado con `fs.statSync(dbPath).size / 1024`. Debe ser `> 0`. Puede ser float. |
| `db_writable`  | boolean | Siempre `false` en esta fase. Confirma que la DB se abrio en modo readonly.                |
| `uptime_s`     | number  | Segundos desde el arranque del proceso. `process.uptime()`. Debe ser `>= 0`.               |
| `node_version` | string  | `process.version` literal (ej: `"v22.10.0"`).                                              |
| `build_hash`   | string  | Literal `"dev"` en esta fase. (En futuras fases podra venir de env o git rev-parse.)       |

### 2.3 Headers

- `Content-Type: application/json; charset=utf-8`
- Status `200 OK`

### 2.4 Errores

- Si el archivo DB no existe al arrancar: el proceso debe abortar con error claro en stdout (`fileMustExist: true` en better-sqlite3 garantiza esto). NO se debe levantar un server que responda `ok: true` con DB inexistente.

---

## 3. Comportamiento read-only (CRITICO)

- La DB se abre con `better-sqlite3` usando las opciones **exactas**:
  ```ts
  new Database(dbPath, { readonly: true, fileMustExist: true })
  ```
- Cualquier intento de `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `DROP`, `ALTER` debe fallar con error de SQLite (`SQLITE_READONLY`). Esto lo garantiza el driver; no hace falta validacion adicional en codigo.
- El campo `db_writable` en `/api/health` siempre devuelve `false`. NO se debe intentar detectar writability dinamicamente — es un literal `false` que documenta la intencion del server.

**Por que importa:** el visor lee la DB del autonomous-orchestrator en vivo mientras este sigue corriendo. Cualquier write desde el visor podria corromper estado del orchestrator.

---

## 4. Configuracion

### 4.1 Puerto

- Server escucha en **port 5176** (hardcoded en esta fase, no configurable por env).

### 4.2 Variables de entorno

| Variable                 | Tipo   | Default                                                                  | Notas                                    |
|--------------------------|--------|--------------------------------------------------------------------------|------------------------------------------|
| `ORCHESTRATOR_DB_PATH`   | string | `/home/angel/projects/autonomous-orchestrator/state/orchestrator.db`     | Opcional. Override de la ruta a la DB.   |

### 4.3 Scripts npm

- `npm run dev` debe ejecutar `tsx --watch server/index.ts` (o equivalente) y dejar el server escuchando en 5176.
- Recomendado: log de arranque a stdout: `[visor-orchestrator] listening on http://localhost:5176 (db: <path>, readonly)`.

---

## 5. Estructura de archivos esperada

```
/home/angel/projects/visor-orchestrator/
├── server/
│   ├── index.ts        # Hono app + @hono/node-server + middleware logger + ruta /api/health
│   ├── db.ts           # export function getDb(): Database — abre singleton readonly
│   └── queries.ts      # esqueleto vacio, placeholder export (ej: export const _placeholder = true)
└── tests/
    └── e2e/
        └── health.spec.ts
```

### 5.1 `server/index.ts`

- Importa `Hono` de `hono` y `serve` de `@hono/node-server`.
- Usa el middleware `logger` de `hono/logger`.
- Registra `app.get('/api/health', handler)`.
- Llama a `serve({ fetch: app.fetch, port: 5176 })`.

### 5.2 `server/db.ts`

- Exporta `getDb(): Database` que devuelve una instancia singleton de `better-sqlite3`.
- La instancia se crea con `{ readonly: true, fileMustExist: true }`.
- La ruta se resuelve desde `process.env.ORCHESTRATOR_DB_PATH ?? '/home/angel/projects/autonomous-orchestrator/state/orchestrator.db'`.

### 5.3 `server/queries.ts`

- Esqueleto. Debe existir el archivo con al menos un `export` para que TypeScript no se queje. Las queries reales llegan en fases siguientes.

---

## 6. Test E2E — `tests/e2e/health.spec.ts`

### 6.1 Stack

- Playwright Test (`@playwright/test`), usando `request` fixture.
- Base URL: `http://localhost:5176` (configurado en `playwright.config.ts`).

### 6.2 Especificacion del test

```ts
import { test, expect } from '@playwright/test';

test('GET /api/health responds 200 with valid readonly payload', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);

  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.db_writable).toBe(false);
  expect(typeof body.db_size_kb).toBe('number');
  expect(body.db_size_kb).toBeGreaterThan(0);
  expect(typeof body.db_path).toBe('string');
  expect(body.db_path.length).toBeGreaterThan(0);
});
```

### 6.3 Aserciones obligatorias

1. `res.status() === 200`
2. `body.ok === true`
3. `body.db_writable === false`
4. `typeof body.db_size_kb === 'number'` y `body.db_size_kb > 0`
5. `typeof body.db_path === 'string'` con la ruta de la DB (no vacio)

### 6.4 Aserciones opcionales (nice-to-have, no bloquean)

- `body.node_version` empieza con `'v'`.
- `body.build_hash === 'dev'`.
- `body.uptime_s >= 0`.

---

## 7. Criterio de listo (Definition of Done)

La fase bootstrap se considera **completa** cuando:

1. `npm run dev` levanta tsx en watch mode escuchando en port 5176 sin errores.
2. `curl -s http://localhost:5176/api/health | jq` retorna status 200 con el JSON valido descrito en seccion 2.
3. El campo `db_size_kb` es un numero `> 0` (confirmando que la DB existe y se pudo statear).
4. El campo `db_writable` es `false`.
5. `npx playwright test tests/e2e/health.spec.ts` pasa en verde.
6. Existen los tres archivos: `server/index.ts`, `server/db.ts`, `server/queries.ts`.
7. TypeScript compila sin errores (`tsc --noEmit` limpio).

---

## 8. Fuera de alcance (NO en esta fase)

- UI / frontend Vite (llega en flow 2+).
- Queries SQL reales sobre la DB (llega en flow 3+).
- Autenticacion / rate limiting.
- Multiples endpoints (`/api/runs`, `/api/agents`, etc).
- Build de produccion / Docker.
- Logs estructurados a archivo.

---

## 9. Handoff

- **Backend (Mateo):** implementa `server/index.ts`, `server/db.ts`, `server/queries.ts` segun seccion 5.
- **QA (Sofia):** implementa `tests/e2e/health.spec.ts` segun seccion 6, valida criterio de listo (seccion 7).
- **DevOps (Dante):** confirma que `npm run dev` script existe en `package.json` y que `playwright.config.ts` apunta al port 5176.
