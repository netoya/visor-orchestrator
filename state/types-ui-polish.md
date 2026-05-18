# Contratos TypeScript - Flow visor-ui-polish

**Tech Lead:** Roman
**Fecha:** 2026-05-18
**Stack:** Vite + Vanilla TypeScript
**Referencia AC:** `state/ac-ui-polish.md`

Este documento define los contratos de tipos que el frontend debe consumir para implementar las mejoras del flow `visor-ui-polish`. Es documentacion: los snippets se transcriben tal cual al codigo (ej. `src/types/ui.ts`, `src/lib/timeSince.ts`, `src/styles/tokens.css`).

---

## 1. UIFetchState<T>

**Shape:**

```ts
export type UIFetchStatus = 'idle' | 'loading' | 'success' | 'error';

export interface UIFetchState<T> {
  status: UIFetchStatus;
  data?: T;
  error?: string;
}
```

**Donde se usa:**
- Modulos: `src/tabs/flows.ts`, `src/tabs/sessions.ts`, `src/tabs/waiters.ts`.
- Es el estado canonico que cada tab mantiene en memoria por su endpoint. El render de loading (AC1), empty (AC2) y error (AC3) se deriva exclusivamente de este objeto.

**Reglas de transicion:**
- `idle` -> `loading` al disparar el fetch.
- `loading` -> `success` (con `data`) o `error` (con `error: string`).
- `success` -> `loading` en refetch (mantener `data` previa para evitar flicker, o limpiarla si se prefiere skeleton).

**Ejemplo:**

```ts
const flowsState: UIFetchState<Flow[]> = { status: 'idle' };

async function loadFlows(): Promise<void> {
  flowsState.status = 'loading';
  render();
  try {
    const res = await fetch('/api/flows');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    flowsState.data = await res.json();
    flowsState.status = 'success';
    flowsState.error = undefined;
  } catch (e) {
    flowsState.status = 'error';
    flowsState.error = e instanceof Error ? e.message : 'Error desconocido';
  }
  render();
}
```

---

## 2. FlowsFilter

**Shape:**

```ts
export type Autonomy = 'L0' | 'L1' | 'L2' | 'L3';

export interface FlowsFilter {
  status?: string;
  autonomy?: Autonomy;
  q?: string;
}
```

**Donde se usa:**
- Modulo: `src/tabs/flows.ts`.
- Implementa AC6.1. Se aplica en cliente sobre el array `Flow[]` recibido del backend.

**Semantica:**
- `status`: match exacto contra `flow.status` (case-insensitive recomendado). `undefined` = todos.
- `autonomy`: match exacto contra `flow.autonomy`. Tipado estricto a `L0|L1|L2|L3`.
- `q`: substring case-insensitive sobre `flow.name` y/o `flow.description` (campos relevantes del Flow).
- Combinacion AND entre filtros con valor definido.

**Ejemplo:**

```ts
const filter: FlowsFilter = { status: 'running', autonomy: 'L2', q: 'visor' };

function applyFlowsFilter(items: Flow[], f: FlowsFilter): Flow[] {
  return items.filter(it => {
    if (f.status && it.status.toLowerCase() !== f.status.toLowerCase()) return false;
    if (f.autonomy && it.autonomy !== f.autonomy) return false;
    if (f.q) {
      const needle = f.q.toLowerCase();
      const hay = `${it.name} ${it.description ?? ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}
```

---

## 3. SessionsFilter

**Shape:**

```ts
export interface SessionsFilter {
  agent?: string;
  processStatus?: string;
}
```

**Donde se usa:**
- Modulo: `src/tabs/sessions.ts`.
- Implementa AC6.2. El dropdown de `agent` se puebla dinamicamente desde el set de agentes presentes en la lista actual.

**Semantica:**
- `agent`: match exacto contra `session.agent`. `undefined` = todos.
- `processStatus`: match exacto contra `session.process_status` (snake_case en backend, camelCase en el filter del frontend).

**Ejemplo:**

```ts
const filter: SessionsFilter = { agent: 'roman', processStatus: 'running' };

function applySessionsFilter(items: Session[], f: SessionsFilter): Session[] {
  return items.filter(s => {
    if (f.agent && s.agent !== f.agent) return false;
    if (f.processStatus && s.process_status !== f.processStatus) return false;
    return true;
  });
}

function uniqueAgents(items: Session[]): string[] {
  return Array.from(new Set(items.map(s => s.agent))).sort();
}
```

---

## 4. WaitersFilter

**Shape:**

```ts
export interface WaitersFilter {
  status?: string;
}
```

**Donde se usa:**
- Modulo: `src/tabs/waiters.ts`.
- Implementa AC6.3.

**Semantica:**
- `status`: match exacto contra `waiter.status`. Valores tipicos: `pending`, `fired`, `expired`. `undefined` = todos.

**Ejemplo:**

```ts
const filter: WaitersFilter = { status: 'pending' };

function applyWaitersFilter(items: Waiter[], f: WaitersFilter): Waiter[] {
  if (!f.status) return items;
  return items.filter(w => w.status === f.status);
}
```

---

## 5. UISettings

**Shape:**

```ts
export interface UISettings {
  pollMs: number;
}

export const POLL_MIN_MS = 1000;
export const POLL_MAX_MS = 60000;
export const POLL_DEFAULT_MS = 5000;
export const POLL_STORAGE_KEY = 'visor:ui:pollMs';
```

**Donde se usa:**
- Modulo: `src/settings.ts` (singleton) consumido por el loop de polling global (`src/polling.ts`) y por el control numerico de la barra superior.
- Implementa AC5.

**Reglas:**
- Unidad interna: milisegundos. El input UI muestra segundos (`min=1, max=60, step=1`).
- Clamp obligatorio en `set`: valores fuera de rango se ajustan al limite mas cercano y se reflejan en el input.
- Persistencia en `localStorage` bajo `POLL_STORAGE_KEY`.
- Cambio en caliente: el siguiente tick respeta el nuevo valor (no espera al ciclo anterior; el loop debe leer el setting actual en cada iteracion o resetearse al cambiar).

**Ejemplo:**

```ts
function clampPollMs(ms: number): number {
  if (!Number.isFinite(ms)) return POLL_DEFAULT_MS;
  return Math.max(POLL_MIN_MS, Math.min(POLL_MAX_MS, Math.round(ms)));
}

function loadSettings(): UISettings {
  const raw = localStorage.getItem(POLL_STORAGE_KEY);
  const parsed = raw ? Number(raw) : POLL_DEFAULT_MS;
  return { pollMs: clampPollMs(parsed) };
}

function saveSettings(s: UISettings): void {
  localStorage.setItem(POLL_STORAGE_KEY, String(clampPollMs(s.pollMs)));
}
```

---

## 6. timeSince helper

**Signature:**

```ts
export function timeSince(iso: string, nowMs?: number): string;
```

**Donde se usa:**
- Modulo: `src/lib/timeSince.ts`.
- Consumido por todas las tablas (Flows, Sessions, Waiters) y por el drawer al renderizar `created_at`, `updated_at`, `fired_at`, etc. Implementa AC9.

**Contrato de salida (castellano, singular/plural correctos):**

| Diferencia | Salida esperada |
|---|---|
| `< 5s` | `"hace un momento"` |
| `5s <= dt < 60s` | `"hace X segundos"` (o `"hace 1 segundo"` si X=1, aunque cae en `< 5s`) |
| `60s <= dt < 60min` | `"hace 1 minuto"` o `"hace X minutos"` |
| `1h <= dt < 24h` | `"hace 1 hora"` o `"hace X horas"` |
| `1d <= dt < 30d` | `"hace 1 dia"` o `"hace X dias"` |
| `>= 30 dias` | fecha absoluta corta en es-AR, ej `"12 abr 2026"` |

**Notas de implementacion:**
- `nowMs` opcional para facilitar tests deterministas; default `Date.now()`.
- Si `iso` no parsea, devolver string vacio o `'-'` (no lanzar excepcion: rompe render).
- El timestamp ISO crudo se expone como atributo `title` en el DOM (no responsabilidad de este helper; del consumidor).

**Ejemplo:**

```ts
export function timeSince(iso: string, nowMs: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '-';
  const dtSec = Math.max(0, Math.floor((nowMs - t) / 1000));

  if (dtSec < 5) return 'hace un momento';
  if (dtSec < 60) return `hace ${dtSec} segundos`;

  const dtMin = Math.floor(dtSec / 60);
  if (dtMin < 60) return dtMin === 1 ? 'hace 1 minuto' : `hace ${dtMin} minutos`;

  const dtHr = Math.floor(dtMin / 60);
  if (dtHr < 24) return dtHr === 1 ? 'hace 1 hora' : `hace ${dtHr} horas`;

  const dtDay = Math.floor(dtHr / 24);
  if (dtDay < 30) return dtDay === 1 ? 'hace 1 dia' : `hace ${dtDay} dias`;

  return new Date(t).toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
```

**Casos de test sugeridos (input -> output):**

```ts
// Con nowMs fijo = Date.parse('2026-05-18T12:00:00Z')
timeSince('2026-05-18T11:59:58Z', now); // 'hace un momento'
timeSince('2026-05-18T11:59:30Z', now); // 'hace 30 segundos'
timeSince('2026-05-18T11:55:00Z', now); // 'hace 5 minutos'
timeSince('2026-05-18T11:59:00Z', now); // 'hace 1 minuto'
timeSince('2026-05-18T09:00:00Z', now); // 'hace 3 horas'
timeSince('2026-05-15T12:00:00Z', now); // 'hace 3 dias'
timeSince('2026-03-01T12:00:00Z', now); // '1 mar 2026' (o similar segun locale)
```

---

## 7. KeyboardShortcut map

**Shape:**

```ts
export type TabId = 'flows' | 'sessions' | 'waiters' | 'extra';

export type ShortcutAction =
  | { kind: 'switchTab'; tab: TabId }
  | { kind: 'focusSearch' };

export type KeyboardShortcut = Record<string, ShortcutAction>;

export const SHORTCUTS: KeyboardShortcut = {
  '1': { kind: 'switchTab', tab: 'flows' },
  '2': { kind: 'switchTab', tab: 'sessions' },
  '3': { kind: 'switchTab', tab: 'waiters' },
  '4': { kind: 'switchTab', tab: 'extra' },
  '/': { kind: 'focusSearch' },
};
```

**Donde se usa:**
- Modulo: `src/keyboard.ts`. Registra un listener `keydown` a nivel `document`. Implementa AC8.

**Reglas:**
- Ignorar el evento si `event.target` es `<input>`, `<textarea>` o elemento `contenteditable`.
- En `focusSearch` llamar `event.preventDefault()` para que `/` no se tipee en el input al recibir foco.
- `Escape` con foco en input: blur al body (no esta en el map porque su contexto es opuesto: solo activo dentro de input).
- Para `tab: 'extra'`: si la cuarta tab no existe, no-op silencioso.

**Ejemplo:**

```ts
function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && isEditable(ev.target)) {
    (ev.target as HTMLElement).blur();
    return;
  }
  if (isEditable(ev.target)) return;

  const action = SHORTCUTS[ev.key];
  if (!action) return;

  if (action.kind === 'switchTab') {
    switchTab(action.tab);
  } else {
    ev.preventDefault();
    focusActiveSearch();
  }
});
```

---

## 8. CSS tokens

**Archivo destino:** `src/styles/tokens.css` (importado una sola vez desde el entry CSS principal).

**Bloque sugerido:**

```css
:root {
  /* Fondos */
  --bg: #0e1116;
  --bg-elev: #161b22;
  --bg-overlay: rgba(0, 0, 0, 0.55);

  /* Texto */
  --fg: #e6edf3;
  --fg-muted: #8b949e;
  --fg-subtle: #6e7681;

  /* Bordes */
  --border: #30363d;
  --border-strong: #484f58;

  /* Acento e interaccion */
  --accent: #2f81f7;
  --accent-hover: #1f6feb;

  /* Estados */
  --success: #3fb950;
  --warning: #d29922;
  --danger: #f85149;
  --info: #58a6ff;

  /* Espaciados */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 20px;

  /* Tipografia */
  --font-size-sm: 12px;
  --font-size-base: 14px;
  --font-size-lg: 16px;

  /* Radios */
  --radius-sm: 4px;
  --radius-md: 8px;

  /* Sombras */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);

  /* Animaciones */
  --duration-fast: 150ms;
  --duration-base: 200ms;
  --easing-out: cubic-bezier(0.16, 1, 0.3, 1);
  --easing-in: cubic-bezier(0.7, 0, 0.84, 0);
}
```

**Donde se usa:**
- Todos los archivos CSS de la app deben consumir estas variables via `var(--token)`. Implementa AC10.
- El control de polling (AC5), el drawer (AC4), los empty/error states (AC2/AC3) y los focus rings de los atajos (AC8) consumen estos tokens.

**Regla de validacion:**
- `grep -E '#[0-9a-fA-F]{3,6}'` fuera de `tokens.css` no debe devolver mas de 2 ocurrencias justificadas (ej. iconos SVG inline).
- Mantener un unico archivo de tokens; si se necesita un theme alternativo, declarar overrides bajo selectores adicionales (ej. `[data-theme="light"] { ... }`).

**Ejemplo de consumo:**

```css
.drawer {
  background: var(--bg-elev);
  color: var(--fg);
  border-left: 1px solid var(--border);
  box-shadow: var(--shadow-md);
  transform: translateX(100%);
  transition: transform var(--duration-base) var(--easing-in);
}

.drawer.is-open {
  transform: translateX(0);
  transition-timing-function: var(--easing-out);
}
```

---

## Resumen de modulos sugeridos

| Archivo | Exporta | AC cubiertos |
|---|---|---|
| `src/types/ui.ts` | `UIFetchState`, `FlowsFilter`, `SessionsFilter`, `WaitersFilter`, `UISettings`, constantes de poll, `TabId`, `ShortcutAction`, `KeyboardShortcut`, `SHORTCUTS` | AC1, AC2, AC3, AC5, AC6, AC8 |
| `src/lib/timeSince.ts` | `timeSince` | AC9 |
| `src/settings.ts` | `loadSettings`, `saveSettings`, `clampPollMs` | AC5 |
| `src/keyboard.ts` | listener global + dispatcher de `SHORTCUTS` | AC8 |
| `src/styles/tokens.css` | variables CSS bajo `:root` | AC4, AC10 (y consumido por AC1/AC2/AC3) |

Restriccion transversal: sin emojis en codigo, comentarios ni strings de UI (R1 del AC).

TASK_DONE
