# Visor Tests E2E - Final Report

## Status final

**ROJO (N/A — smoke ausente)**

El archivo esperado `state/smoke-tests-e2e.md` con el resultado de la ejecucion de Playwright no esta presente en el directorio `state/`. Sin esa evidencia no puedo confirmar cuantos de los 6 tests pasaron, por lo que el flow queda en ROJO hasta que se materialice el smoke o se vuelva a correr la suite.

Listado actual de smokes en `state/` (referencia):
- smoke-api-flow-detail.md, smoke-api-flows.md, smoke-api-sessions.md, smoke-api-stats-health.md, smoke-api-waiters.md
- smoke-bootstrap.md, smoke-task-detail.md, smoke-ws-stream.md
- smoke-ui-polish.md, smoke-ui-shell.md, smoke-ui-views.md, smoke-deploy-doc.md
- (no aparece `smoke-tests-e2e.md`)

## Cobertura

Suite E2E con Playwright (`tests/e2e/visor.spec.ts`, 6 tests):

1. **Atajos 1/2/3/4 cambian de tab** — presiona cada tecla y verifica `aria-selected="true"` en `tab-flows | tab-sessions | tab-waiters | tab-stats`, y `false` en la tab previa.
2. **Tecla `/` da focus al search input** — desde foco neutro presiona `/`, espera que `search-input` quede `toBeFocused()` y `toHaveValue('')` (preventDefault correcto, el `/` no se escribe).
3. **Drawer abre con click en row, cierra con Esc** — click en `flow-row` muestra `drawer`; `Escape` lo desmonta (`toHaveCount(0)` con timeout 2s para cubrir la transicion ~400ms).
4. **Filtros reducen lista y limpia restaura** — `filter-status="running"` => count `<=` initial; click `filter-clear` => count vuelve al original y el select queda en valor vacio.
5. **Empty state visible con lista filtrada vacia** — `page.route('**/api/flows*')` responde `{ flows: [] }` con 200; verifica `empty-state` visible y `table.flows-table` con `count=0`.
6. **Error state con interceptor 500** — `page.route('**/api/flows*')` responde 500 text/plain; verifica `error-state` visible y `table.flows-table` con `count=0`.

Selectores ancla via `data-testid` (declarados en el header del spec): `tab-flows`, `tab-sessions`, `tab-waiters`, `tab-stats`, `health-header`, `filter-status`, `filter-autonomy`, `search-input`, `filter-clear`, `filter-count`, `flow-row`, `empty-state`, `error-state`, `drawer`, `drawer-overlay`.

## Decisiones de diseno

- **Test 5 (empty) mockea `/api/flows` con `{ flows: [] }`** porque fuerza el empty state de forma determinista, sin depender del estado real del backend (que podria tener o no flows segun la corrida). Acoplar el test a "filtrar hasta que no matchee" seria fragil ante cambios de seed/data.
- **Test 6 (error) mockea `/api/flows` con status 500** porque valida el contrato visual del error state sin tener que matar el backend Hono ni cortar la red. El interceptor de Playwright deja al resto de la app intacta (header health sigue cargando) y aisla el modo de falla a la ruta de flows.
- **Tests 1-4 usan API real (vite proxy hacia `localhost:5176`)** porque cubren interaccion teclado/UI que no requieren estado controlado: los atajos, el focus del search y el filtro/limpieza funcionan sobre cualquier lista no vacia. Mockear aqui solo agregaria mantenimiento sin valor.
- **`gotoAndWaitForReady` espera `health-header` visible** como gating comun: sin ese ancla los tests podrian disparar `keyboard.press` antes de que el listener global este registrado, dando flakes intermitentes.
- **`fullyParallel: false` y `retries: 0`** en `playwright.config.ts`: la suite es chica, comparte backend, y queremos detectar flakes en vez de enmascararlos con reintentos.
- **`webServer` con `reuseExistingServer: !process.env.CI`**: en local reusa el vite que ya esta arriba (iteracion rapida); en CI siempre arranca uno limpio.

## Recomendacion

Status actual ROJO por smoke ausente. **Intervencion humana requerida**:

### Modo de falla detectado

No se trata de un fallo en el codigo de tests ni en la app, sino de un gap de evidencia:

- `state/smoke-tests-e2e.md` no existe.
- Posibles causas (a verificar manualmente):
  1. **Smoke nunca corrio**: el agente Sofia/QA no llego a ejecutar `npx playwright test` o el wrapper de smoke fallo silenciosamente antes de escribir el archivo.
  2. **Smoke corrio pero no persistio**: la ejecucion fallo con un error temprano (puerto 5173 ocupado, vite no levanto, backend en 5176 caido) y el reporter `list` no genero el markdown esperado.
  3. **Archivo escrito con otro nombre/path**: `tests/` tiene 6 specs (`flow-detail`, `flows-list`, `health`, `sessions-list`, `visor`, `ws`), no solo `visor.spec.ts`. Si el smoke corrio la suite completa, podria haberse guardado bajo otro nombre.

### Acciones concretas para destrabar

1. Verificar manualmente:
   ```bash
   cd /home/angel/projects/visor-orchestrator
   # backend Hono en :5176 debe estar arriba antes
   npx playwright test tests/e2e/visor.spec.ts --reporter=list
   ```
   Capturar stdout/stderr a `state/smoke-tests-e2e.md`.

2. Si los 6 pasan => promover a VERDE y abrir flow de CI:
   - Crear `.github/workflows/e2e.yml` con un job que:
     - instala deps + `npx playwright install --with-deps chromium`,
     - arranca el backend Hono en background (`node server/...` o el script que corresponda),
     - corre `npx playwright test` con `CI=1` (fuerza fresh webServer),
     - sube el `playwright-report/` y `test-results/` como artifacts en caso de fallo.

3. Si algun test falla, mirar el stdout del smoke por test:
   - **Test 1 (atajos)**: si falla en `tab-sessions`, revisar que `keyboard.js` siga registrando `1/2/3/4` y que los `data-testid` esten en `src/main.js`.
   - **Test 2 (`/`)**: si el input no recibe focus, validar `preventDefault` en el handler de `/` y que no haya otro listener capturando la tecla antes.
   - **Test 3 (drawer)**: si el `toHaveCount(0)` timeoutea, subir el `timeout` de 2000ms o forzar el desmonte sin esperar la transicion (`drawer.js` debe terminar removiendo el nodo del DOM, no solo ocultandolo).
   - **Test 4 (filtros)**: si `toHaveCount(initialCount)` falla, hay polling que esta repintando rows entre la lectura inicial y el click de `filter-clear`; mockear `/api/flows` con respuesta estable o pausar el polling durante el test.
   - **Test 5 (empty)**: si la tabla sigue apareciendo, el render condicional en `flows.js` no esta respetando `flows.length === 0`.
   - **Test 6 (error)**: si `error-state` no aparece, revisar el `catch` del fetch en `flows.js` — el 500 debe propagarse al render como estado de error y no como lista vacia.

## Adjuntos

- `state/smoke-tests-e2e.md` (ausente — bloqueante para promover a VERDE)
- `tests/e2e/visor.spec.ts` (6 tests E2E, 138 lineas)
- `playwright.config.ts` (`baseURL` 5173, vite como `webServer`, chromium-only, sin retries, no paralelo)
- `state/handoff-tests-e2e.md` (plan original — el spec implementado cumple los 6 escenarios pedidos)

<<TASK_DONE>>
