# Criterios de Aceptacion: UI Views (Flows, Sessions, Waiters)

Autor: Camila (PM)
Flow: visor-ui-views (01KRWKBCGBP2W7RK1XFEW5PH9F)
Fecha: 2026-05-17

## 0. Contexto general

El visor es una SPA con dev server Vite que expone tres tabs principales en la barra superior: **Flows**, **Sessions** y **Waiters**. Cada tab consume la API del autonomous-orchestrator publicada en `http://localhost:5176/api`, accedida via el proxy `/api` configurado en el dev server de Vite.

Restricciones transversales que aplican a las tres tabs:

- **Idioma**: todos los textos visibles deben estar en castellano (labels, encabezados, mensajes de estado, tooltips, botones).
- **Sin emojis**: ni en titulos, ni en labels, ni en mensajes de estado, ni en badges. Los iconos visuales, de ser necesarios, deben ser SVG o icon fonts (lucide / heroicons / similares), no emojis Unicode.
- **Proxy**: el frontend nunca debe referenciar `http://localhost:5176` directamente; siempre usa la ruta relativa `/api/...`.
- **No autenticacion**: la API es local, no se envian headers de auth.

---

## 1. Endpoints consumidos por cada tab

### 1.1 Tab Flows

| Uso | Metodo | Endpoint | Cuando se llama |
|---|---|---|---|
| Lista principal de flows | GET | `/api/flows` | Al montar la tab Flows; refresco manual; polling opcional. |
| Detalle de un flow (drawer) | GET | `/api/flows/:id/detail` | Al hacer click en una row de la lista de flows. |
| Conversacion de una task (drawer anidado) | GET | `/api/tasks/:id/conversation` | Al hacer click en una task dentro del drawer de flow. |

### 1.2 Tab Sessions

| Uso | Metodo | Endpoint | Cuando se llama |
|---|---|---|---|
| Lista de sessions | GET | `/api/sessions` | Al montar la tab Sessions; refresco manual; polling opcional. |

### 1.3 Tab Waiters

| Uso | Metodo | Endpoint | Cuando se llama |
|---|---|---|---|
| Lista de waiters (con filtro de status) | GET | `/api/waiters` | Al montar la tab Waiters; al cambiar de filtro; refresco manual. |

---

## 2. Tab Flows - Criterios de Aceptacion

### 2.1 Lista de flows (vista principal de la tab)

- **AC-FLOWS-01**: Al activar la tab Flows, la UI llama `GET /api/flows` y renderiza una tabla con una row por flow.
- **AC-FLOWS-02**: La tabla muestra como minimo las siguientes columnas, en este orden:
  1. `flow_id` (string, mostrado con tipografia monoespaciada).
  2. `name` (texto plano, truncado con elipsis si excede el ancho de columna; tooltip al hover muestra el nombre completo).
  3. `status` (renderizado como badge de color segun el valor: `running`=azul, `done`=verde, `failed`=rojo, `pending`=gris, otros valores=gris).
  4. `created_at` (formato humanizado, ej `hace 3 minutos`, `hace 2 horas`, `ayer 14:32`, o ISO localizada `2026-05-17 14:32`).
  5. `priority` (numero entero, alineado a la derecha).
- **AC-FLOWS-03**: Cada row es clickeable en cualquier parte de la fila (no solo en un boton). El cursor cambia a `pointer` al hacer hover sobre la row y el fondo de la fila se resalta levemente.
- **AC-FLOWS-04**: Al hacer click en una row se abre un **drawer lateral derecho** (panel deslizante desde el borde derecho de la pantalla) con el detalle del flow. El drawer ocupa entre el 40 y el 60 por ciento del ancho del viewport en desktop.
- **AC-FLOWS-05**: El drawer tiene un boton de cierre visible en su esquina superior derecha (X o equivalente, no emoji) y tambien se cierra al presionar la tecla `Escape` o al hacer click fuera del drawer (overlay).
- **AC-FLOWS-06**: Mientras el drawer carga su contenido inicial, muestra el estado de carga descrito en la seccion 5.

### 2.2 Drawer de detalle de flow

- **AC-FLOWS-07**: Al abrir el drawer, la UI llama `GET /api/flows/:id/detail` con el `flow_id` de la row clickeada.
- **AC-FLOWS-08**: El drawer muestra en su encabezado: `flow_id`, `name`, `status` (badge), `created_at` humanizado.
- **AC-FLOWS-09**: Debajo del encabezado, el drawer renderiza la lista de **tasks** asociadas al flow (campo `tasks` del response). Cada item de la lista debe mostrar:
  1. `status` (badge de color con la misma convencion que en la lista de flows).
  2. `agent_id` (texto plano, monoespaciado si es un ID, o el `nombre humano` del agente si la API lo provee).
  3. `stage` (texto plano, ej `planning`, `coding`, `review`).
  4. **Duracion** humanizada calculada en cliente como `finished_at - started_at` si ambos existen, sino `now - started_at` si la task esta en curso. Formato: `3m 12s`, `1h 4m`, `45s`.
- **AC-FLOWS-10**: Si el flow no tiene tasks, se muestra el empty state descrito en la seccion 5 con el texto `No hay tasks en este flow`.
- **AC-FLOWS-11**: Cada task es clickeable. Al hacer click se abre una **vista anidada dentro del mismo drawer** (no un segundo drawer separado) que muestra la conversacion de la task.

### 2.3 Vista anidada de conversation de task

- **AC-FLOWS-12**: Al hacer click en una task, la UI llama `GET /api/tasks/:id/conversation` con el `task_id` de la task clickeada.
- **AC-FLOWS-13**: La vista anidada reemplaza el contenido principal del drawer (sin cerrarlo) y debe ofrecer un boton `Volver` (texto, sin emoji) en la parte superior que regresa a la vista de detalle del flow sin volver a fetchear.
- **AC-FLOWS-14**: La conversation se renderiza como una secuencia vertical de **turnos** del agente. Cada turno muestra como minimo:
  - Rol o autor del turno (`user`, `assistant`, `tool_use`, `tool_result`, etc., segun el modelo de la API).
  - Timestamp del turno en formato humanizado.
  - Contenido del turno renderizado con respeto a saltos de linea y formato monoespaciado para bloques de codigo o JSON.
- **AC-FLOWS-15**: Si la conversation esta vacia, se muestra el empty state con el texto `No hay turnos en esta conversacion`.
- **AC-FLOWS-16**: El header del drawer sigue mostrando los datos del flow padre incluso en la vista anidada, para no perder contexto.

---

## 3. Tab Sessions - Criterios de Aceptacion

- **AC-SESS-01**: Al activar la tab Sessions, la UI llama `GET /api/sessions` y renderiza una tabla con una row por session.
- **AC-SESS-02**: Cada row muestra las siguientes columnas, en este orden:
  1. **Process status badge** con color segun `process_status`:
     - `alive` -> verde.
     - `zombie` -> amarillo.
     - `finished` -> gris.
     - Cualquier otro valor -> gris claro con el texto literal del status.
  2. `pid` (numero entero). Si la API devuelve `null`, `undefined` o no devuelve el campo, mostrar el caracter `-` (guion medio simple), no `N/A`, no string vacio.
  3. **Edad humanizada** calculada en cliente como `now - started_at` (o el campo equivalente que devuelva la API). Formato:
     - Menos de 60 segundos: `Ns` (ej `45s`).
     - Entre 1 minuto y 1 hora: `Xm Ys` (ej `3m 12s`).
     - Mas de 1 hora: `Xh Ym` (ej `1h 4m`).
     - Mas de 24 horas: `Xd Yh` (ej `2d 3h`).
  4. `agent_id` (texto plano, monoespaciado).
  5. `flow_id` (texto plano, monoespaciado, truncado con elipsis si excede; tooltip con el id completo).
  6. `task_id` (texto plano, monoespaciado, truncado con elipsis si excede; tooltip con el id completo).
- **AC-SESS-03**: Las columnas `flow_id` y `task_id`, si son no nulas, son clickeables y llevan a la tab Flows con el flow correspondiente abierto en el drawer (deep-link interno). Si son nulas, mostrar `-`.
- **AC-SESS-04**: La tabla se ordena por defecto por edad descendente (sessions mas recientes arriba).
- **AC-SESS-05**: Aplican los estados generales de loading, error y empty state de la seccion 5.

---

## 4. Tab Waiters - Criterios de Aceptacion

### 4.1 Filtros

- **AC-WAIT-01**: Encima de la tabla de waiters se muestra una **barra de filtros tipo botones/pills** con las siguientes opciones, en este orden:
  1. `Todos` (valor interno `all`).
  2. `En espera` (valor interno `waiting`).
  3. `Resueltos` (valor interno `fulfilled`).
  4. `Rechazados` (valor interno `rejected`).
  5. `Timeout` (valor interno `timeout`).
  6. `Invalidos` (valor interno `invalid`).
- **AC-WAIT-02**: Solo una pill puede estar activa a la vez. La pill activa se muestra con fondo lleno (color primario) y las inactivas con fondo transparente y borde.
- **AC-WAIT-03**: El filtro **por defecto** al entrar a la tab es `En espera` (`waiting`). Si la lista resultante esta vacia, no se cambia automaticamente a otro filtro: se muestra el empty state.
- **AC-WAIT-04**: Al cambiar el filtro, la UI hace una nueva llamada a `GET /api/waiters?status=<valor>` (o el parametro que defina el contrato de la API). Si el filtro es `Todos`, no se envia el parametro `status` o se envia explicitamente `all`.

### 4.2 Lista de waiters

- **AC-WAIT-05**: La tabla muestra una row por waiter con como minimo: `waiter_id` (monoespaciado, truncado), `status` (badge de color), `agent_id`, `created_at` humanizado, `expires_in_s` formateado (ej `45s`, `2m 10s`).
- **AC-WAIT-06**: Cada row es clickeable y abre un drawer lateral derecho con el detalle del waiter.

### 4.3 Drawer de detalle de waiter

- **AC-WAIT-07**: El drawer muestra las siguientes secciones, en este orden:
  1. **Encabezado**: `waiter_id`, `status` (badge), `agent_id`, `created_at`.
  2. **Prompt completo**: el campo `prompt` del waiter renderizado en un bloque de texto con saltos de linea respetados. No truncar.
  3. **Schema parseado**: el campo `schema` (JSON) parseado en cliente. Si contiene `available_actions` (array), renderizar **como lista** con un item por accion (label + descripcion si existe). Si el schema no tiene `available_actions`, mostrar el JSON crudo en bloque monoespaciado.
  4. **Value JSON** (solo si `status == fulfilled`): mostrar el campo `value_json` (o `value`) como bloque JSON con tipografia **monoespaciada**, indentacion de 2 espacios y, si es posible, syntax highlight basico.
  5. **Expires in**: el valor de `expires_in_s` formateado humanizado (ej `45s`, `2m 10s`). Si el waiter ya no esta en espera, este campo se puede ocultar o mostrar como `-`.
- **AC-WAIT-08**: El drawer tiene el mismo comportamiento de cierre que el de Flows: boton X, tecla `Escape`, click fuera.
- **AC-WAIT-09**: Si un waiter en estado `fulfilled` no trae `value_json`, mostrar en la seccion correspondiente el texto `Sin valor de respuesta` (no error).
- **AC-WAIT-10**: Si el schema no es JSON parseable, mostrar el texto literal en un bloque monoespaciado con un aviso encima: `Schema no parseable, mostrando texto crudo`.

---

## 5. Estados generales (aplica a las tres tabs y a los drawers)

### 5.1 Loading

- **AC-GEN-01**: Mientras una llamada a la API esta en curso y no hay datos previos cacheados, se muestra:
  - Un **spinner** centrado en el area del contenido afectado (tabla o drawer), o
  - El texto `Cargando...` centrado, si no se implementa spinner.
- **AC-GEN-02**: Si hay datos previos visibles (ej refresco manual o polling), el loading puede mostrarse como un indicador discreto (barra superior delgada o badge `Actualizando...`) sin ocultar los datos actuales.

### 5.2 Error

- **AC-GEN-03**: Si la llamada a la API falla (status >= 400, error de red, timeout, JSON invalido), se muestra un mensaje claro en el area afectada con el formato:
  - Titulo: `Error al cargar <recurso>` donde `<recurso>` es `los flows`, `el detalle del flow`, `la conversacion`, `las sessions`, `los waiters`, `el detalle del waiter`, segun corresponda.
  - Debajo, un boton `Reintentar` que reintenta exactamente la misma llamada que fallo.
- **AC-GEN-04**: El mensaje de error no incluye stack traces ni codigos HTTP crudos en el texto visible al usuario. Esos detalles, si se quieren conservar, van en `console.error` o en un tooltip secundario.

### 5.3 Empty state

- **AC-GEN-05**: Si la llamada a la API responde con exito pero la coleccion esta vacia (`[]`), se muestra un texto centrado en el area de contenido con el formato `No hay <recurso>`:
  - Tab Flows lista vacia: `No hay flows`.
  - Drawer de flow sin tasks: `No hay tasks en este flow`.
  - Conversation vacia: `No hay turnos en esta conversacion`.
  - Tab Sessions vacia: `No hay sessions`.
  - Tab Waiters vacia (con filtro aplicado): `No hay waiters en este estado` (incluye el filtro actual en el texto si es distinto de `Todos`).
- **AC-GEN-06**: El empty state no debe parecer un error: no usa color rojo, no usa iconos de alerta, no ofrece boton `Reintentar`.

---

## 6. Restricciones de presentacion (recordatorio)

- **AC-UI-01**: No se permiten emojis Unicode en ningun texto visible de la UI (titulos, labels, badges, mensajes, tooltips, botones, placeholders, empty states, errores).
- **AC-UI-02**: Todos los textos visibles estan en castellano. Los identificadores tecnicos (`flow_id`, `task_id`, `agent_id`, valores de `status` como `running`/`done`/`failed`) pueden permanecer en ingles porque provienen de la API y son parte del contrato.
- **AC-UI-03**: La tipografia monoespaciada se usa para IDs, JSON, codigo y valores `pid`. El resto usa la tipografia base del design system.

---

## 7. Criterios de listo (Definition of Done de la feature)

La feature `visor-ui-views` se considera lista cuando:

1. Las tres tabs cargan y muestran datos reales obtenidos del orchestrator local en `http://localhost:5176/api` via proxy `/api`.
2. Los drawers de Flows y Waiters funcionan con apertura, cierre, navegacion anidada (en Flows) y todos los AC de cada tab marcados arriba.
3. Los tres estados (loading, error, empty) estan implementados y testeados manualmente en cada tab y en cada drawer.
4. Una revision visual confirma: castellano consistente, cero emojis, badges con los colores especificados, IDs en monoespaciada, fechas humanizadas.
5. QA (Sofia) puede ejecutar el smoke manual de cada tab sin encontrar discrepancias contra este documento.
