# Criterios de Aceptacion: UI Polish del Visor

Autor: Camila (PM)
Feature: visor-ui-polish
Fecha: 2026-05-18

## 0. Contexto

Polish visual y de interaccion del visor-orchestrator (Vite + Vanilla TS, `root='.'`, `outDir='dist/public'`, dev port 5173, proxy `/api -> :5176`). UI con cuatro tabs (Flows, Sessions, Waiters, Health) y drawer lateral derecho para detalles. Este documento extiende [ac-ui-views.md](./ac-ui-views.md): no redefine los AC ya cubiertos alli, agrega los del polish.

Restricciones transversales (recordatorio):

- Castellano en todo texto visible.
- Cero emojis Unicode en codigo, archivos de estado y UI.
- Frontend consume API por proxy relativo `/api/...`.
- IDs y JSON en tipografia monoespaciada.

Como se lee este documento:

- Cada AC es una unidad verificable manualmente o con test.
- Roman usa los AC para definir tipos (`PollingConfig`, `FilterState`, `TimeAgo`, `ThemeTokens`).
- Valeria implementa contra los AC sin reinterpretar el alcance.
- Sofia (QA) usa los AC como checklist de smoke.

---

## 1. Loading states

**Como** usuario del visor
**Quiero** ver un indicador mientras los datos cargan
**Para** saber que el sistema esta respondiendo y no esta colgado.

- **AC-LOAD-01**: Cada fetch a `/api/flows`, `/api/sessions`, `/api/waiters` y `/api/health` muestra un indicador de carga mientras la promesa esta pendiente.
- **AC-LOAD-02**: El indicador puede ser uno de: spinner centrado, skeleton rows en la tabla, o el texto `Cargando...` centrado. La eleccion debe ser consistente por tab (no mezclar skeleton y spinner en la misma tab).
- **AC-LOAD-03**: Si ya hay datos previos visibles (refresco manual o polling), el indicador es discreto y no oculta los datos actuales. Formas aceptadas: barra delgada superior, badge `Actualizando...` en el header de la tab, o cambio de opacidad leve (opacidad final >= 0.7) en la tabla.
- **AC-LOAD-04**: El indicador desaparece al resolverse o rechazarse la promesa, sin requerir interaccion del usuario.
- **AC-LOAD-05**: El loading bloquea la interaccion solo sobre el area afectada (tabla o drawer), no sobre la barra de tabs ni sobre los filtros.

---

## 2. Empty states

**Como** usuario del visor
**Quiero** ver un mensaje claro cuando una lista esta vacia
**Para** distinguir entre "no hay datos" y "fallo la carga".

- **AC-EMPTY-01**: Cuando un fetch responde con exito pero la coleccion es `[]`, se muestra un mensaje centrado en el area de contenido. Nunca se renderiza una tabla sin filas y sin mensaje.
- **AC-EMPTY-02**: Textos por contexto:
  - Flows vacio: `No hay flows`.
  - Sessions vacio: `No hay sessions`.
  - Waiters vacio: `No hay waiters` (si hay filtro distinto de `Todos`, agregar `en este estado`).
  - Tasks del drawer vacio: `No hay tasks en este flow`.
- **AC-EMPTY-03**: El empty state no usa color rojo ni icono de alerta. No ofrece boton `Reintentar`.
- **AC-EMPTY-04**: Si la combinacion de filtros vacia el resultado (aunque la API haya devuelto datos), se muestra empty state con el texto `Ningun resultado para los filtros aplicados`.

---

## 3. Error states

**Como** usuario del visor
**Quiero** un mensaje de error legible y un reintento manual cuando un fetch falla
**Para** recuperarme sin recargar toda la pagina.

- **AC-ERR-01**: Si un fetch falla por status >= 400, error de red, timeout o JSON invalido, se muestra un mensaje inline en el area afectada.
- **AC-ERR-02**: Formato del mensaje:
  - Titulo: `Error al cargar <recurso>` (`los flows`, `las sessions`, `los waiters`, `el health`, `el detalle del flow`, `la conversacion`, `el detalle del waiter`).
  - Debajo, un boton `Reintentar` que invoca el mismo fetch que fallo con los mismos parametros.
- **AC-ERR-03**: El error de una tab o drawer no rompe el resto de la UI: la barra de tabs sigue funcionando, las demas tabs renderizan normalmente, el drawer no se cierra solo.
- **AC-ERR-04**: El mensaje no incluye stack traces ni codigos HTTP crudos en el texto visible. El detalle tecnico va a `console.error` con prefijo `[visor]`.
- **AC-ERR-05**: Si el reintento tiene exito, el mensaje de error se reemplaza por los datos sin requerir refrescar la tab.
- **AC-ERR-06**: El indicador de loading desaparece al renderizarse el error (no quedan ambos visibles a la vez).

---

## 4. Drawer animations

**Como** usuario del visor
**Quiero** que el drawer se abra y cierre con una transicion suave
**Para** percibir un cambio de contexto fluido y no un salto brusco.

- **AC-DRWR-01**: Al abrir el drawer (click en row), el panel se desliza desde el borde derecho del viewport hasta su posicion final.
- **AC-DRWR-02**: Al cerrar el drawer (boton X, tecla `Escape`, click en overlay), el panel se desliza hacia el borde derecho hasta salir del viewport.
- **AC-DRWR-03**: La transicion usa `transform` (translateX) y `opacity`. Esta prohibido animar `width`, `right`, `display` o `visibility` (causan reflow o cortes).
- **AC-DRWR-04**: La duracion total esta entre 150ms y 250ms inclusive. Apertura y cierre comparten la misma duracion.
- **AC-DRWR-05**: El easing es `ease-out` (o `cubic-bezier` equivalente) para apertura y `ease-in` para cierre. No se permite `linear`.
- **AC-DRWR-06**: El overlay (fondo opaco detras del drawer) hace fade-in/fade-out en la misma duracion que el panel.
- **AC-DRWR-07**: Si el usuario hace click en otra row mientras el drawer ya esta abierto, el contenido se actualiza sin re-disparar la animacion completa (sin cerrar y reabrir).
- **AC-DRWR-08**: Durante el cierre el drawer es visualmente pasivo: los clicks adentro no abren navegacion nueva.

---

## 5. Polling configurable

**Como** usuario del visor
**Quiero** ajustar la frecuencia del polling de health
**Para** balancear actualidad vs carga y persistir mi eleccion entre sesiones.

- **AC-POLL-01**: El polling de `/api/health` usa un intervalo por defecto de **5000ms**.
- **AC-POLL-02**: En el UI (tab Health o panel de settings accesible desde el header) hay un input numerico etiquetado `Intervalo de polling (ms)` que permite modificar el intervalo en vivo.
- **AC-POLL-03**: El input acepta valores enteros en el rango **[1000, 60000]** inclusive. Valores fuera de rango se rechazan: se muestra un texto en rojo debajo del input con `Valor permitido: 1000 a 60000 ms` y el intervalo activo no cambia.
- **AC-POLL-04**: Al confirmar un valor valido (blur del input o boton `Aplicar`), el polling se reinicia con el nuevo intervalo: el siguiente fetch se dispara al cumplir el nuevo intervalo desde el momento del cambio (no espera al ciclo viejo).
- **AC-POLL-05**: El valor se persiste en `localStorage` bajo la clave `visor.pollingIntervalMs`.
- **AC-POLL-06**: Al cargar la SPA, si existe `visor.pollingIntervalMs` en `localStorage` y es un entero en rango, se usa como intervalo inicial. Si no existe o es invalido, se usa 5000ms; si era invalido, se elimina la entrada corrupta.
- **AC-POLL-07**: El input muestra el valor activo al renderizarse (no solo placeholder).

---

## 6. Filtros por tab

**Como** usuario del visor
**Quiero** filtrar las listas de cada tab
**Para** encontrar rapido lo que me interesa sin scroll.

### 6.1 Flows

- **AC-FILT-FLOWS-01**: Encima de la tabla de flows hay tres controles de filtro:
  1. Select multi o pills de `status` con valores: `queued`, `running`, `done`, `failed`, mas cualquier otro valor presente en la respuesta. Opcion `Todos` presente y default.
  2. Select de `autonomy` con valores `L0`, `L1`, `L2`, `L3` y opcion `Todos` (default).
  3. Input de texto libre etiquetado `Buscar` que filtra por `name` (substring case-insensitive).
- **AC-FILT-FLOWS-02**: Los filtros aplican en cliente sobre la lista cargada (no requieren refetch). Combinados se evaluan con AND.
- **AC-FILT-FLOWS-03**: El input de texto aplica con debounce de 200ms; no requiere `Enter`.
- **AC-FILT-FLOWS-04**: Si la combinacion vacia el resultado, se muestra empty state segun AC-EMPTY-04.

### 6.2 Sessions

- **AC-FILT-SESS-01**: Encima de la tabla de sessions hay dos controles:
  1. Input o select de `agent` que filtra por `agent_id` (substring case-insensitive contra el ID o el nombre humano del agente si la API lo provee).
  2. Select de `process_status` con valores `alive`, `zombie`, `finished` y opcion `Todos` (default).
- **AC-FILT-SESS-02**: Los filtros aplican en cliente sobre la lista cargada y se combinan con AND.

### 6.3 Waiters

- **AC-FILT-WAIT-01**: La tab Waiters mantiene su barra de pills definida en [ac-ui-views.md](./ac-ui-views.md) seccion 4.1 (`Todos`, `En espera`, `Resueltos`, `Rechazados`, `Timeout`, `Invalidos`).
- **AC-FILT-WAIT-02**: El polish no debe alterar el contrato existente de filtros de Waiters.

### 6.4 Estado de filtros

- **AC-FILT-GEN-01**: Los filtros activos NO se persisten en `localStorage` (fuera de scope del polish). Al recargar la SPA cada tab vuelve a su default.
- **AC-FILT-GEN-02**: Cambiar de tab y volver mantiene el filtro de la sesion en curso (estado en memoria), no lo resetea.

---

## 7. Sort

**Como** usuario del visor
**Quiero** los flows mas recientes arriba y las tasks de un flow en orden cronologico
**Para** ubicar rapido lo ultimo y leer la secuencia de ejecucion sin reordenar mentalmente.

- **AC-SORT-01**: La lista principal de flows (tab Flows) esta ordenada por `created_at` descendente. El flow mas reciente queda en la primera fila.
- **AC-SORT-02**: La lista de tasks dentro del drawer de detalle de un flow esta ordenada por `created_at` ascendente. La task mas antigua queda arriba.
- **AC-SORT-03**: Si dos elementos tienen el mismo `created_at`, el desempate es por su ID (string compare). El criterio debe ser estable entre renders.
- **AC-SORT-04**: El ordenamiento se aplica en cliente despues de los filtros.

---

## 8. Atajos de teclado

**Como** usuario del visor
**Quiero** navegar entre tabs y enfocar la busqueda sin tocar el mouse
**Para** moverme rapido cuando inspecciono varias cosas.

- **AC-KEY-01**: Las teclas `1`, `2`, `3`, `4` (fila principal del teclado, no numpad) cambian respectivamente a las tabs Flows, Sessions, Waiters y Health. Si la cuarta tab no existe, `4` es no-op.
- **AC-KEY-02**: La tecla `/` pone el foco en el input de busqueda de la tab activa. Si la tab activa no tiene input de busqueda, la tecla es no-op. Se previene que el caracter `/` se inserte como input.
- **AC-KEY-03**: Ninguno de los atajos anteriores se dispara cuando el foco esta dentro de un `<input>`, `<textarea>` o un elemento con `contenteditable=true`. La pulsacion se trata como input normal en esos casos.
- **AC-KEY-04**: La tecla `Escape` mantiene su comportamiento previo: cierra el drawer si esta abierto; con foco en input, mueve el foco al `body`. No interfiere con los atajos de este bloque.
- **AC-KEY-05**: Los atajos no requieren modificadores (Ctrl/Alt/Meta). Si se pulsa con modificador, son no-op para evitar conflictos con shortcuts del navegador.

---

## 9. Time-since helper

**Como** usuario del visor
**Quiero** leer los timestamps en formato relativo en castellano
**Para** entender de un vistazo cuan reciente es un evento sin parsear fechas ISO.

- **AC-TIME-01**: Los timestamps mostrados en listas y headers se renderizan en formato relativo en castellano. Reemplaza la convencion mixta previa de [ac-ui-views.md](./ac-ui-views.md) para los campos listados en AC-TIME-04.
- **AC-TIME-02**: Formato del texto relativo:
  - Menos de 5 segundos: `hace un momento`.
  - Entre 5 y 59 segundos: `hace N segundos`.
  - Entre 1 y 59 minutos: `hace N min` (singular: `hace 1 min`).
  - Entre 1 y 23 horas: `hace N horas` (singular: `hace 1 hora`).
  - Entre 1 y 29 dias: `hace N dias` (singular: `hace 1 dia`).
  - 30 o mas dias: fecha absoluta corta `YYYY-MM-DD`.
- **AC-TIME-03**: Cada timestamp tiene un atributo `title` (tooltip nativo) con el timestamp absoluto en ISO 8601 local, ej `2026-05-18 14:32:07`.
- **AC-TIME-04**: El helper aplica a: `created_at` en lista de flows, `created_at` en lista de waiters, `created_at` en header del drawer, timestamps de turnos en la conversation. No reemplaza los formatos de **duracion** (ej `3m 12s`) ni de **edad de session** ni de **expires_in_s**, que conservan su formato propio definido en `ac-ui-views.md`.
- **AC-TIME-05**: El calculo se hace contra `Date.now()` en el momento del render. No se requiere auto-refresh del texto mientras la row esta visible: se actualiza naturalmente con el proximo render o polling.

---

## 10. Tokens CSS

**Como** equipo
**Queremos** centralizar los colores en variables CSS
**Para** garantizar consistencia visual y soportar un dark theme coherente.

- **AC-CSS-01**: En el archivo CSS principal (o en `:root` dentro de `src/styles/tokens.css` o equivalente) se definen como minimo las siguientes variables:
  - `--color-bg`
  - `--color-fg`
  - `--color-accent`
  - `--color-border`
  - `--color-muted`
  - `--color-danger`
  - `--color-success`
- **AC-CSS-02**: El resto del CSS de la SPA usa exclusivamente `var(--color-*)` para colores. No se permiten literales hex, `rgb()`, `hsl()` ni nombres de color (`white`, `red`) fuera de la definicion en `:root` y de los overrides de tema.
- **AC-CSS-03**: Existe un dark theme aplicado por defecto que satisface contraste WCAG AA para texto sobre fondo (ratio >= 4.5:1 para texto normal). Roman valida el contraste.
- **AC-CSS-04**: Cada badge de status (running/done/failed/queued/zombie/etc.) usa un token semantico (`--color-success`, `--color-danger`, `--color-accent`, `--color-muted`) y no un literal. Si hace falta un color extra (ej amarillo para `zombie`), se agrega como variable adicional en `:root` (ej `--color-warning`).
- **AC-CSS-05**: Una grep `grep -E "#[0-9a-fA-F]{3,6}|rgb\(|hsl\(" src/**/*.css` solo arroja resultados dentro del bloque de definicion de tokens (`:root` o `[data-theme=...]`); cero matches en el resto, salvo casos justificados (ej SVG inline) documentados con un comentario inmediato encima.

---

## 11. Definition of Done

La feature `visor-ui-polish` se considera lista cuando:

1. Los 10 grupos de AC pasan revision manual de Sofia (QA) sobre las cuatro tabs y los drawers correspondientes.
2. `vite build` corre verde (exit 0) sin warnings nuevos.
3. El intervalo de polling sobrevive a un reload de la pagina (verificacion de `localStorage`).
4. Una sesion de uso con teclado puro (sin mouse) permite navegar entre las 4 tabs, abrir un drawer, cerrarlo y enfocar la busqueda usando solo `1`/`2`/`3`/`4`, `/` y `Escape`.
5. Un grep manual confirma cero literales de color fuera de los tokens y cero emojis Unicode en `src/**/*.{ts,css,html}` y en archivos de `state/`.
6. Roman firma la definicion de tipos derivada de estos AC (`PollingConfig`, `FilterState`, `TimeAgo`, `ThemeTokens`).
7. Existe una nota en `state/ui-polish-evidence.md` (o equivalente) que evidencia visualmente los puntos clave: loading, empty, error, drawer animado.
