# visor-orchestrator

UI de observabilidad readonly del autonomous-orchestrator. Permite inspeccionar flows, tasks, sessions, waiters y estadisticas leyendo directamente la base SQLite del orchestrator sin modificarla.

## Descripcion

`visor-orchestrator` expone un backend Hono (puerto 5176) que sirve un API JSON sobre `orchestrator.db` en modo readonly, y un frontend Vanilla JS + Vite (puerto 5173 en dev) con tabs (Flows / Sessions / Waiters / Stats), drawers de detalle, atajos de teclado y polling configurable. Es una herramienta de diagnostico para operadores: mira, no toca.

## Requisitos

- Node.js >= 20.x (probado con 20 LTS).
- npm >= 10.x (incluido con Node 20).
- SQLite: el driver `better-sqlite3` embebe el binario nativo, no se requiere `sqlite3` en el PATH.
- Acceso de lectura al archivo `orchestrator.db` del autonomous-orchestrator (por defecto en `/home/angel/projects/autonomous-orchestrator/state/orchestrator.db`, configurable via `ORCHESTRATOR_DB_PATH`).

## Setup

1. Clonar el repositorio:

   ```bash
   git clone <repo-url> /home/angel/projects/visor-orchestrator
   cd /home/angel/projects/visor-orchestrator
   ```

2. Instalar dependencias:

   ```bash
   npm install
   ```

3. Arrancar el backend en modo desarrollo (watch):

   ```bash
   npm run dev
   ```

   Para un deploy productivo usar:

   ```bash
   ./scripts/deploy.sh
   ```

Una vez arriba, el backend escucha en `http://localhost:5176`. En dev, el frontend Vite (puerto 5173) hace proxy de `/api/*` hacia el backend; para levantarlo aparte: `npm run dev:ui`.

## Scripts

Los siguientes scripts estan declarados en `package.json`:

| Script | Comando | Que hace |
| --- | --- | --- |
| `dev` | `tsx --watch server/index.ts` | Levanta el backend Hono en `http://localhost:5176` con recarga en cambios. |
| `dev:ui` | `vite` | Levanta el frontend Vite en `http://localhost:5173` con proxy `/api -> http://localhost:5176`. |
| `build` | `tsc -p tsconfig.json && vite build` | Compila el server TypeScript y genera el bundle del frontend en `dist/public/`. |
| `preview` | `vite preview` | Sirve el build estatico para inspeccionarlo. |
| `start` | `node dist/server/index.js` | Ejecuta el backend ya compilado (consume `dist/`). |
| `test:e2e` | `playwright test` | Corre la suite e2e de Playwright. |
| `test:e2e:install` | `npx playwright install chromium` | Instala el navegador para Playwright. |

Adicionalmente, el script de deploy vive en `scripts/deploy.sh`:

```bash
./scripts/deploy.sh
```

`scripts/deploy.sh` instala dependencias, compila (`npm run build`), arranca el backend y reporta PID y URL de acceso. Es idempotente y respeta las variables `PORT` y `ORCHESTRATOR_DB_PATH`.

## Endpoints

El backend (`server/index.ts`) expone 8 endpoints HTTP, todos `GET` y todos readonly:

- `GET /api/health` - Healthcheck. Devuelve `ok`, `db_path`, `db_size_kb`, `uptime_s`, `node_version`, edad del heartbeat del dispatcher, tamano del WAL y conteo de waiters activos.
- `GET /api/flows` - Lista flows. Acepta query params `status`, `autonomy`, `q` para filtrar.
- `GET /api/flows/:id/detail` - Detalle completo de un flow (tasks y eventos asociados). Devuelve 404 si no existe.
- `GET /api/tasks/:id` - Detalle de una task individual. Devuelve 404 si no existe.
- `GET /api/tasks/:id/conversation` - Mensajes (transcript) de la conversacion de una task. Devuelve 404 si la task no existe.
- `GET /api/sessions` - Lista sessions de Claude. Acepta `agent` y `status` (`alive` | `zombie` | `finished`).
- `GET /api/waiters` - Lista waiters. Acepta `status` (`waiting` | `fulfilled` | `rejected` | `timeout` | `invalid`); valor invalido devuelve 400.
- `GET /api/stats` - Estadisticas agregadas (counts, distribuciones) sobre la DB.

Ejemplos:

```bash
curl http://localhost:5176/api/health
curl 'http://localhost:5176/api/flows?status=running'
curl http://localhost:5176/api/stats
```

## Arquitectura

El sistema es de tres capas sin estado intermedio: el frontend Vanilla JS + Vite (puerto 5173 en dev, build estatico a `dist/public/` en prod) hace fetch a `/api/*`; en dev Vite proxea esas requests a `http://localhost:5176`, donde el backend Hono (`server/index.ts`) consulta directamente `orchestrator.db` via `better-sqlite3` en modo readonly y devuelve JSON. No hay cache, no hay websockets en MVP (polling configurable desde la UI), no hay autenticacion. Toda la lectura va contra la misma SQLite que escribe el autonomous-orchestrator, por lo que los datos son siempre frescos sin pasos de sincronizacion.

## Troubleshooting

### Puerto 5173 o 5176 ya esta ocupado

Detectar quien lo usa:

```bash
lsof -iTCP:5176 -sTCP:LISTEN
lsof -iTCP:5173 -sTCP:LISTEN
# alternativa con ss
ss -tlnp | grep -E ':(5173|5176)'
```

Matar el proceso (sustituyendo `<PID>` por el reportado):

```bash
kill <PID>
```

Para cambiar el puerto del backend, exportar `PORT` antes de levantar (el script `scripts/deploy.sh` lo respeta) o editar el `serve({ ... port: 5176 })` en `/home/angel/projects/visor-orchestrator/server/index.ts`. Para cambiar el puerto del frontend dev, editar `server.port` en `/home/angel/projects/visor-orchestrator/vite.config.js`.

### Base de datos no encontrada

El backend busca `orchestrator.db` en la ruta indicada por la variable de entorno `ORCHESTRATOR_DB_PATH`. Si no esta seteada, usa el path por defecto (`/home/angel/projects/autonomous-orchestrator/state/orchestrator.db`).

Verificar que el archivo existe y es legible:

```bash
ls -l "${ORCHESTRATOR_DB_PATH:-/home/angel/projects/autonomous-orchestrator/state/orchestrator.db}"
```

Apuntar a una ruta explicita:

```bash
export ORCHESTRATOR_DB_PATH=/ruta/absoluta/a/orchestrator.db
npm run dev
```

Tambien se puede copiar `.env.example` a `.env` y editar el valor ahi:

```bash
cp .env.example .env
```

### `node_modules` corrupto o errores de modulo nativo (`better-sqlite3`)

`better-sqlite3` compila un binding nativo y a veces queda inconsistente tras un cambio de version de Node o un install interrumpido. Reinstalacion limpia:

```bash
rm -rf node_modules package-lock.json
npm install
```

Si el error persiste, forzar la recompilacion del binding nativo:

```bash
npm rebuild better-sqlite3
```

### El healthcheck devuelve `ok: false`

Indica que la DB no respondio al `SELECT 1` interno. Revisar:

- Permisos de lectura sobre `orchestrator.db`.
- Integridad del archivo: `sqlite3 orchestrator.db 'PRAGMA integrity_check;'` (si se tiene el binario instalado).
- Que ningun proceso del orchestrator tenga lock exclusivo.
- Los logs del proceso (`npm run dev` imprime el error con `[GET /api/health] db check failed`).
