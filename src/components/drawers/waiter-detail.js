// src/components/drawers/waiter-detail.js
// Drawer lateral del detalle de un waiter. Recibe el objeto completo (no
// re-fetch). Muestra encabezado, prompt, schema parseado (con
// available_actions si existe), value_json (si fulfilled) y expires_in_s.

import { openDrawer } from './drawer.js';
import {
  escapeHtml,
  formatSeconds,
  statusBadgeClass,
} from '../../utils/format.js';
import { timeSince, toIsoTitle } from '../../lib/timeSince.js';

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

function makeWaiterView(waiter) {
  return {
    render(ctx) {
      const html =
        renderHeader(waiter) +
        '<div class="drawer-content">' +
        renderPromptSection(waiter) +
        renderSchemaSection(waiter) +
        renderValueSection(waiter) +
        renderExpiresSection(waiter) +
        '</div>';
      ctx.setContent(html);
      attachCloseHandler(ctx.body, ctx);
    },
  };
}

/**
 * Abre el drawer con el detalle del waiter.
 * @param {object} waiter
 */
export function openWaiterDrawer(waiter) {
  openDrawer(makeWaiterView(waiter));
}
