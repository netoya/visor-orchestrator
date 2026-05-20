// src/components/tabs/waiters.js
// Tab Waiters: tabla + barra de filtros pill (todos/waiting/fulfilled/
// rejected/timeout/invalid). Fetch unico al montar la tab y filtrado
// client-side. Click en una row abre el drawer de detalle del waiter.
// Cubre AC1/AC2/AC3 (loading/empty/error), AC6.3 (filtros) y AC9 (time-since).

import { fetchWaiters } from '../../api.js';
import { openWaiterDrawer } from '../drawers/waiter-detail.js';
import {
  escapeHtml,
  formatSeconds,
  statusBadgeClass,
} from '../../utils/format.js';
import { timeSince, toIsoTitle } from '../../lib/timeSince.js';

const VIEW_ID = 'view';

const FILTERS = [
  { value: 'all',       label: 'Todos' },
  { value: 'waiting',   label: 'En espera' },
  { value: 'fulfilled', label: 'Resueltos' },
  { value: 'rejected',  label: 'Rechazados' },
  { value: 'timeout',   label: 'Timeout' },
  { value: 'invalid',   label: 'Invalidos' },
];

const state = {
  fetch: { status: 'idle', data: undefined, error: undefined },
  filter: { status: 'waiting' },
};

function getHost() {
  return document.getElementById(VIEW_ID);
}

function findWaiter(id) {
  const items = state.fetch.data;
  if (!Array.isArray(items)) return null;
  for (let i = 0; i < items.length; i++) {
    if (items[i] && items[i].id === id) return items[i];
  }
  return null;
}

function renderFilterBar() {
  const pills = FILTERS.map(function (f) {
    const cls = 'pill' + (f.value === state.filter.status ? ' pill-active' : '');
    return (
      '<button type="button" class="' + cls + '" data-filter="' + escapeHtml(f.value) + '">' +
      escapeHtml(f.label) +
      '</button>'
    );
  }).join('');
  const counter = renderCounter();
  return (
    '<div class="filter-bar" role="group" aria-label="Filtros de waiters">' +
    pills +
    '<div class="filter-spacer"></div>' +
    counter +
    '</div>'
  );
}

function renderCounter() {
  if (state.fetch.status !== 'success' || !Array.isArray(state.fetch.data)) {
    return '<span class="filter-count"></span>';
  }
  const total = state.fetch.data.length;
  const visible = applyFilter(state.fetch.data).length;
  if (visible === total) return '<span class="filter-count">' + total + ' waiters</span>';
  return '<span class="filter-count">' + visible + ' / ' + total + ' waiters</span>';
}

function renderShell(innerHtml) {
  return (
    '<section class="tab-waiters">' +
    '<h2 class="tab-title">Waiters</h2>' +
    renderFilterBar() +
    '<div class="tab-body">' + innerHtml + '</div>' +
    '</section>'
  );
}

function emptyFilteredText() {
  if (state.filter.status === 'all') return 'No hay waiters pendientes';
  const f = FILTERS.find(function (x) { return x.value === state.filter.status; });
  const label = f ? f.label : state.filter.status;
  return 'No hay waiters en este estado (' + label + ')';
}

function applyFilter(waiters) {
  if (state.filter.status === 'all') return waiters;
  return waiters.filter(function (w) { return w && w.status === state.filter.status; });
}

function renderTableHtml(waiters) {
  const rows = waiters.map(function (w) {
    const created = timeSince(w.created_at);
    const createdTitle = toIsoTitle(w.created_at);
    return (
      '<tr class="waiter-row" data-waiter-id="' + escapeHtml(w.id) + '" tabindex="0">' +
      '<td class="mono cell-trunc" title="' + escapeHtml(w.id) + '">' + escapeHtml(w.id) + '</td>' +
      '<td><span class="' + statusBadgeClass(w.status) + '">' + escapeHtml(w.status || 'unknown') + '</span></td>' +
      '<td class="mono">' + escapeHtml(w.fulfilled_by || w.flow_name || '-') + '</td>' +
      '<td class="mono" title="' + escapeHtml(createdTitle) + '">' + escapeHtml(created) + '</td>' +
      '<td class="mono">' + escapeHtml(formatSeconds(w.expires_in_s)) + '</td>' +
      '</tr>'
    );
  }).join('');

  return (
    '<table class="data-table waiters-table">' +
    '<thead>' +
    '<tr>' +
    '<th>waiter_id</th>' +
    '<th>status</th>' +
    '<th>agent</th>' +
    '<th>created_at</th>' +
    '<th>expires_in</th>' +
    '</tr>' +
    '</thead>' +
    '<tbody>' + rows + '</tbody>' +
    '</table>'
  );
}

function renderBodyHtml() {
  if (state.fetch.status === 'loading' && !state.fetch.data) {
    return '<div class="loading"><div class="spinner" aria-hidden="true"></div><div>Cargando waiters...</div></div>';
  }
  if (state.fetch.status === 'error') {
    return (
      '<div class="state-error">' +
      '<div class="state-error-title">Error al cargar waiters: ' + escapeHtml(state.fetch.error || 'desconocido') + '</div>' +
      '<button type="button" class="btn btn-retry" data-action="retry">Reintentar</button>' +
      '</div>'
    );
  }
  const items = Array.isArray(state.fetch.data) ? state.fetch.data : [];
  if (items.length === 0) {
    return '<div class="empty-state">No hay waiters pendientes</div>';
  }
  const filtered = applyFilter(items);
  if (filtered.length === 0) {
    return '<div class="empty-state">' + escapeHtml(emptyFilteredText()) + '</div>';
  }
  return renderTableHtml(filtered);
}

function attachFilterHandlers() {
  const buttons = document.querySelectorAll('.filter-bar [data-filter]');
  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      const v = btn.getAttribute('data-filter');
      if (!v || v === state.filter.status) return;
      state.filter.status = v;
      paint();
    });
  });
}

function attachRowHandlers() {
  const rows = document.querySelectorAll('.waiter-row');
  rows.forEach(function (row) {
    const handler = function () {
      const id = row.getAttribute('data-waiter-id');
      if (!id) return;
      const w = findWaiter(id);
      if (w) openWaiterDrawer(w, { onFulfilled: function () { load(); } });
    };
    row.addEventListener('click', handler);
    row.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handler();
      }
    });
  });
}

function attachRetryHandler() {
  const retry = document.querySelector('[data-action="retry"]');
  if (retry) retry.addEventListener('click', function () { load(); });
}

function paint() {
  const host = getHost();
  if (!host) return;
  host.innerHTML = renderShell(renderBodyHtml());
  attachFilterHandlers();
  if (state.fetch.status === 'error') attachRetryHandler();
  attachRowHandlers();
}

async function load() {
  state.fetch.status = 'loading';
  state.fetch.error = undefined;
  paint();
  const res = await fetchWaiters();
  if (res && res.error) {
    state.fetch.status = 'error';
    state.fetch.error = res.error;
    state.fetch.data = undefined;
    if (typeof console !== 'undefined') console.error('[waiters]', res.error);
    paint();
    return;
  }
  state.fetch.status = 'success';
  state.fetch.error = undefined;
  state.fetch.data = Array.isArray(res) ? res : [];
  paint();
}

/**
 * Monta la tab Waiters en #view. Resetea el filtro al default ('waiting')
 * cada vez que se entra a la tab.
 */
export function renderWaitersTab() {
  state.filter.status = 'waiting';
  state.fetch.status = 'idle';
  state.fetch.data = undefined;
  state.fetch.error = undefined;
  load();
}
