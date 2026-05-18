# Handoff Tests E2E - Tech Lead Roman

## Estado actual del proyecto visor-orchestrator

Flow visor-ui-polish cerrado. El UI quedo pulido sobre vanilla JS + Vite con los siguientes entregables:

### Polish aplicado
- **Loading / empty / error states**: cada tab maneja explicitamente sus tres estados visuales en lugar de quedar en blanco. El empty state aparece cuando la lista filtrada queda vacia; el error state se renderiza si el fetch del backend falla.
- **Drawer animations**: transiciones suaves de apertura/cierre del side drawer de detalle (no mas pop instantaneo), con backdrop fade.
- **Polling configurable**: intervalo de polling expuesto via settings (persistido en localStorage) en vez de hardcoded.
- **Filtros + sort**: filtros por estado / tipo aplicables en cliente sobre la lista renderizada; sort por columnas clave en las tablas de flows y tasks.
- **Atajos de teclado**: navegacion por tabs con 1/2/3/4, foco a la barra de busqueda con `/`, cierre de drawer con Esc. Centralizados en `keyboard.js`.
- **Time-since helper**: `timeSince.js` formatea timestamps relativos (ej. "hace 3m") en lugar de ISO crudo.
- **Tokens CSS**: variables de color/espaciado/radio extraidas a `tokens.css` para consistencia visual y futura tematizacion.

### Build verde
- Smoke build de Sofia: exit_code 0, duracion 669ms (vite 199ms), sin warnings.
- 16 modulos transformados (tokens.css, timeSince.js, keyboard.js, settings.js, style.css, drawer.js, tabs, drawers).
- `dist/public/index.html` generado correctamente.

### Tamanos finales
- `dist/public/index.html`: 1052 B (gzip 0.47 kB)
- `dist/public/assets/index-kttjlJM5.css`: 19166 B (gzip 3.57 kB)
- `dist/public/assets/index-BdOXkF98.js`: 35600 B (gzip 9.32 kB)
- Total bundle: ~54 kB raw / ~12.9 kB gzip. Dentro de presupuesto razonable para una SPA vanilla.

## Proximo paso sugerido: flow de tests E2E con Playwright

El UI ya esta estable y con build verde reproducible. Recomiendo abrir un nuevo flow `visor-tests-e2e` que monte Playwright sobre el visor servido (puerto local del dev server o `dist/public/` servido estatico) y cubra el contrato de interaccion del polish.

### Tests minimos a incluir

1. **Cambio de tabs por atajos 1/2/3/4**
   - Press `1` => tab Flows activo, contenido de flows visible.
   - Press `2`, `3`, `4` => activan tasks/runs/settings respectivamente.
   - Assertion sobre `aria-selected` o clase activa del tab.

2. **Focus search con `/`**
   - Press `/` desde estado idle => el input de busqueda recibe focus (`document.activeElement` matchea el selector del search).
   - El `/` no debe escribirse dentro del input (preventDefault correcto).

3. **Drawer abre/cierra**
   - Click sobre una row de la lista => drawer entra con animacion y muestra detalle.
   - Press `Esc` o click en backdrop => drawer cierra. Verificar que el contenido del drawer ya no es visible.

4. **Filtros aplican**
   - Setear un filtro (por estado o tipo) => la lista renderizada se reduce a items que matchean.
   - Limpiar el filtro => la lista vuelve al conteo original.

5. **Empty state visible cuando lista vacia**
   - Forzar un filtro que no matchee nada (o mockear backend con respuesta vacia) => verificar que el componente empty state esta en el DOM y no la tabla.

6. **Error state si fetch falla**
   - Interceptar la request del backend con `page.route` y devolver 500 / network error => verificar que el componente error state se renderiza con su mensaje.

### Cobertura adicional sugerida (no bloqueante)
- Polling configurable: cambiar intervalo en settings, esperar el siguiente tick y validar que se hizo un nuevo fetch.
- Sort por columna: click en header => orden ascendente; segundo click => descendente.
- Time-since: renderiza string relativo (regex `hace \d+`) en lugar de ISO.

## Riesgos / notas

- `stderr_tail` del smoke quedo vacio, no hay warnings pendientes que arrastrar al flow de E2E.
- El bundle se sirve desde `dist/public/`. Para Playwright conviene definir si los tests corren contra el dev server (vite con HMR, mas rapido para iterar) o contra el build estatico (mas cercano a prod). Sugerencia: dev server para CI iterativo, build estatico en un job de verificacion final.
- Los atajos de teclado dependen de que el foco no este capturado por inputs. Los tests deben asegurar el estado de foco antes de cada `press`.
- El error state se prueba con `page.route` interceptando la URL del backend; documentar en el flow cual es el endpoint exacto para no acoplar tests a paths que puedan cambiar.

TASK_DONE
