// src/components/drawers/waiter-detail.js
// Drawer lateral del detalle de un waiter.
//
// Comportamiento:
//   - status='waiting' && mode='passive' → renderiza SchemaForm para
//     resolver el waiter via POST /api/waiters/:id/fulfill. La sección
//     "Schema" raw se reemplaza por el form (evita duplicación).
//   - resto → vista read-only existente (id, status, prompt, schema raw,
//     value_json si fulfilled, expires_in).
//
// "Respond differently" NO se ofrece desde esta tab: cuando un operador
// abre el drawer desde la tab Waiters genérica no hay un "prepare flow"
// al que rebobinar. El callback no se pasa a SchemaForm, por lo que el
// botón no se renderiza. Bajo el form mostramos un help text con title
// (tooltip nativo) explicando dónde sí aplica.
//
// Spec: docs/specs/v1-write-operations.md §4 (Capacidad B).

import { openDrawer } from './drawer.js';
import { createSchemaForm } from '../forms/SchemaForm.js';
import { fulfillWaiter as apiFulfillWaiter } from '../../api.js';
import {
  escapeHtml,
  formatSeconds,
  statusBadgeClass,
} from '../../utils/format.js';
import { timeSince, toIsoTitle } from '../../lib/timeSince.js';

const STALE_WAITER_RE = /not waiting|not in waiting|already fulfilled|already rejected|not found/i;

function isFulfillable(w) {
  return !!w && w.status === 'waiting' && w.mode === 'passive';
}

function renderHeader(w) {
  const created = timeSince(w.created_at);
  const createdTitle = toIsoTitle(w.created_at);
  return (
    '<div class="drawer-header">' +
    '<div class="drawer-header-row">' +
    '<div class="drawer-title">Detalle de waiter</div>' +
    '<button type="button" class="drawer-close" data-action="close" aria-label="Cerrar">X</button>' +
    '</div>' +
    '<div class="drawer-sub mono">' + escapeHtml(w.id || '') + '</div>' +
    '<div class="drawer-meta">' +
    '<span class="' + statusBadgeClass(w.status) + '">' + escapeHtml(w.status || 'unknown') + '</span>' +
    '<span class="meta-pill mono">' + escapeHtml(w.agent_id || w.fulfilled_by || '-') + '</span>' +
    '<span class="meta-pill" title="' + escapeHtml(createdTitle) + '">' + escapeHtml(created) + '</span>' +
    (w.mode ? '<span class="meta-pill">' + escapeHtml(w.mode) + '</span>' : '') +
    '</div>' +
    '</div>'
  );
}

function renderPromptSection(w) {
  const text = w.prompt != null ? String(w.prompt) : '';
  return (
    '<div class="drawer-section">' +
    '<div class="drawer-section-title">Prompt</div>' +
    '<pre class="text-block">' + escapeHtml(text) + '</pre>' +
    '</div>'
  );
}

function renderSchemaSection(w) {
  // Solo aplica a waiters pasivos. Si no es passive, no renderiza nada.
  if (w.mode !== 'passive') return '';

  const raw = w.schema_json;
  const invalid = w.schema_invalid === true;

  if (invalid || raw === null || raw === undefined) {
    if (raw == null) {
      return (
        '<div class="drawer-section">' +
        '<div class="drawer-section-title">Schema</div>' +
        '<div class="muted">Sin schema declarado</div>' +
        '</div>'
      );
    }
    return (
      '<div class="drawer-section">' +
      '<div class="drawer-section-title">Schema</div>' +
      '<div class="muted">Schema no parseable, mostrando texto crudo</div>' +
      '<pre class="text-block mono">' + escapeHtml(raw) + '</pre>' +
      '</div>'
    );
  }

  let parsed = null;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return (
      '<div class="drawer-section">' +
      '<div class="drawer-section-title">Schema</div>' +
      '<div class="muted">Schema no parseable, mostrando texto crudo</div>' +
      '<pre class="text-block mono">' + escapeHtml(String(raw)) + '</pre>' +
      '</div>'
    );
  }

  const actions = Array.isArray(w.available_actions) && w.available_actions.length > 0
    ? w.available_actions
    : null;

  if (actions) {
    const items = actions.map(function (a) {
      if (typeof a === 'string') return '<li class="mono">' + escapeHtml(a) + '</li>';
      const label = a && (a.label || a.name || a.value) ? (a.label || a.name || a.value) : JSON.stringify(a);
      const desc = a && a.description ? '<div class="muted">' + escapeHtml(a.description) + '</div>' : '';
      return '<li><div class="mono">' + escapeHtml(label) + '</div>' + desc + '</li>';
    }).join('');
    return (
      '<div class="drawer-section">' +
      '<div class="drawer-section-title">Available actions</div>' +
      '<ul class="actions-list">' + items + '</ul>' +
      '</div>'
    );
  }

  return (
    '<div class="drawer-section">' +
    '<div class="drawer-section-title">Schema</div>' +
    '<pre class="text-block mono">' + escapeHtml(JSON.stringify(parsed, null, 2)) + '</pre>' +
    '</div>'
  );
}

function renderFulfillSectionShell() {
  // El form se inyecta como Node por attachFulfillForm tras setContent.
  return (
    '<div class="drawer-section waiter-fulfill-section">' +
    '<div class="drawer-section-title">Resolver waiter</div>' +
    '<div class="schema-form-mount" data-mount="schema-form"></div>' +
    '<div class="schema-form-banner waiter-fulfill-error" role="alert" data-mount="fulfill-error" style="display:none"></div>' +
    '<div class="muted schema-form-help" ' +
      'title="Solo aplica a waiters del flujo Coordinate. Para resolver este waiter, usa el form structured.">' +
      'Respond differently: solo disponible desde la tab Coordinate.' +
    '</div>' +
    '</div>'
  );
}

function attachFulfillForm(host, waiter, opts) {
  const mount = host.querySelector('[data-mount="schema-form"]');
  const errBanner = host.querySelector('[data-mount="fulfill-error"]');
  if (!mount) return;

  function showError(msg) {
    if (!errBanner) return;
    errBanner.textContent = msg;
    errBanner.style.display = 'block';
  }
  function hideError() {
    if (!errBanner) return;
    errBanner.textContent = '';
    errBanner.style.display = 'none';
  }
  function setBusy(busy) {
    const buttons = mount.querySelectorAll('button');
    buttons.forEach(function (b) { b.disabled = !!busy; });
  }

  async function handleSubmit(value) {
    hideError();
    setBusy(true);
    let res;
    try {
      res = await apiFulfillWaiter(waiter.id, value);
    } catch (e) {
      showError('Error inesperado: ' + (e && e.message ? e.message : String(e)));
      setBusy(false);
      return;
    }
    if (res && res.error) {
      showError('No se pudo resolver: ' + res.error);
      setBusy(false);
      // Race: el waiter ya no está en waiting. Refrescamos la tabla
      // para que el operador vea el estado actual; el drawer queda
      // abierto con el error visible (no auto-cierra para no perder
      // contexto del fallo).
      if (STALE_WAITER_RE.test(String(res.error))) {
        if (typeof opts.onFulfilled === 'function') {
          try { opts.onFulfilled(waiter, null); } catch (_) {}
        }
      }
      return;
    }
    // Éxito: refetch + cerrar drawer.
    if (typeof opts.onFulfilled === 'function') {
      try { opts.onFulfilled(waiter, res); } catch (_) {}
    }
    if (opts.ctx && typeof opts.ctx.close === 'function') opts.ctx.close();
  }

  function handleCancel() {
    if (opts.ctx && typeof opts.ctx.close === 'function') opts.ctx.close();
  }

  const form = createSchemaForm({
    schemaJson: waiter.schema_json,
    onSubmit: handleSubmit,
    onCancel: handleCancel,
    // Sin onRespondDifferently: el botón no se renderiza. El operador
    // que abre el waiter desde esta tab no tiene un flow de planner al
    // que volver. El help text bajo el form explica la limitación.
    plannerQuestions: undefined,
  });

  mount.appendChild(form);
}

function renderValueSection(w) {
  if (w.status !== 'fulfilled') return '';
  if (w.value_json === null || w.value_json === undefined) {
    return (
      '<div class="drawer-section">' +
      '<div class="drawer-section-title">Valor de respuesta</div>' +
      '<div class="muted">Sin valor de respuesta</div>' +
      '</div>'
    );
  }
  let body;
  try {
    body = JSON.stringify(w.value_json, null, 2);
  } catch (e) {
    body = String(w.value_json);
  }
  return (
    '<div class="drawer-section">' +
    '<div class="drawer-section-title">Valor de respuesta</div>' +
    '<pre class="text-block mono">' + escapeHtml(body) + '</pre>' +
    '</div>'
  );
}

function renderExpiresSection(w) {
  if (w.status !== 'waiting') {
    return (
      '<div class="drawer-section">' +
      '<div class="drawer-section-title">Expira en</div>' +
      '<div class="muted">-</div>' +
      '</div>'
    );
  }
  const val = formatSeconds(w.expires_in_s);
  return (
    '<div class="drawer-section">' +
    '<div class="drawer-section-title">Expira en</div>' +
    '<div class="mono">' + escapeHtml(val) + '</div>' +
    '</div>'
  );
}

function attachCloseHandler(host, ctx) {
  const close = host.querySelector('[data-action="close"]');
  if (close) close.addEventListener('click', function () { ctx.close(); });
}

function makeWaiterView(waiter, opts) {
  return {
    render(ctx) {
      const fulfillable = isFulfillable(waiter);

      const html =
        renderHeader(waiter) +
        '<div class="drawer-content">' +
        renderPromptSection(waiter) +
        (fulfillable ? renderFulfillSectionShell() : renderSchemaSection(waiter)) +
        renderValueSection(waiter) +
        renderExpiresSection(waiter) +
        '</div>';
      ctx.setContent(html);
      attachCloseHandler(ctx.body, ctx);
      if (fulfillable) {
        attachFulfillForm(ctx.body, waiter, {
          onFulfilled: opts && opts.onFulfilled,
          ctx: ctx,
        });
      }
    },
  };
}

/**
 * Abre el drawer con el detalle del waiter.
 *
 * @param {object} waiter
 * @param {object} [opts]
 * @param {(waiter: object, result: object|null) => void} [opts.onFulfilled]
 *   Callback invocado tras un fulfill exitoso (result={ok:true}) o tras
 *   detectar que el waiter ya no está en `waiting` por un race (result=null).
 *   Típicamente la tab que abre el drawer pasa aquí su función `load` para
 *   refetchear la lista.
 */
export function openWaiterDrawer(waiter, opts) {
  openDrawer(makeWaiterView(waiter, opts || {}));
}
