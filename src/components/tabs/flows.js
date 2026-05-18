// src/components/tabs/flows.js
// Tab Flows: tabla con la lista de flows + filtros (status, autonomy, q) y
// sort por created_at descendente. El fetch se dispara al montar la tab y
// se reusa entre cambios de filtro (filtros se aplican client-side).
// Cubre AC1/AC2/AC3 (loading/empty/error), AC6.1 (filtros), AC7.1 (sort) y
// AC9 (time-since) para la columna created_at.

import { fetchFlows } from '../../api.js';
import { openFlowDetailDrawer } from '../drawers/flow-detail.js';
import {
  escapeHtml,
  statusBadgeClass,
  orDash,
  toEpochMs,
} from '../../utils/format.js';
import { timeSince, toIsoTitle } from '../../lib/timeSince.js';

const VIEW_ID = 'view';

const STATUS_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'queued', label: 'queued' },
  { value: 'running', label: 'running' },
  { value: 'completed', label: 'completed' },
  { value: 'failed', label: 'failed' },
  { value: 'cancelled', label: 'cancelled' },
];

const AUTONOMY_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'L0', label: 'L0' },
  { value: 'L1', label: 'L1' },
  { value: 'L2', label: 'L2' },
  { value: 'L3', label: 'L3' },
];

const state = {
  fetch: { status: 'idle', data: undefined, error: undefined },
  filter: { status: '', autonomy: '', q: '' },
};

function getHost() {
  return document.getElementById(VIEW_ID);
}

function renderShell(innerHtml) {
  return (
    '<section class="tab-flows">' +
    '<h2 class="tab-title">Flows</h2>' +
    renderFilterBar() +
    '<div class="tab-body">' + innerHtml + '</div>' +
    '</section>'
  );
}

function renderFilterBar() {
  const statusOpts = STATUS_OPTIONS.map(function (o) {
    const sel = o.value === (state.filter.status || '') ? ' selected' : '';
    return '<option value="' + escapeHtml(o.value) + '"' + sel + '>' + escapeHtml(o.label) + '</option>';
  }).join('');
  const autoOpts = AUTONOMY_OPTIONS.map(function (o) {
    const sel = o.value === (state.filter.autonomy || '') ? ' selected' : '';
    return '<option value="' + escapeHtml(o.value) + '"' + sel + '>' + escapeHtml(o.label) + '</option>';
  }).join('');
  const q = escapeHtml(state.filter.q || '');
  const counter = renderCounter();
  return (
    '<div class="filter-bar" role="group" aria-label="Filtros de flows">' +
    '<div class="filter-group">' +
    '<label for="flt-flows-status">status</label>' +
    '<select id="flt-flows-status" data-filter="status" data-testid="filter-status">' + statusOpts + '</select>' +
    '</div>' +
    '<div class="filter-group">' +
    '<label for="flt-flows-autonomy">autonomy</label>' +
    '<select id="flt-flows-autonomy" data-filter="autonomy" data-testid="filter-autonomy">' + autoOpts + '</select>' +
    '</div>' +
    '<div class="filter-group">' +
    '<label for="flt-flows-q">search</label>' +
    '<input id="flt-flows-q" type="search" data-filter="q" data-search-input data-testid="search-input" value="' + q + '" placeholder="nombre..." />' +
    '</div>' +
    '<button type="button" class="btn btn-clear" data-action="clear-filters" data-testid="filter-clear">Limpiar</button>' +
    '<div class="filter-spacer"></div>' +
    counter +
    '</div>'
  );
}

function renderCounter() {
  if (state.fetch.status !== 'success' || !Array.isArray(state.fetch.data)) {
    return '<span class="filter-count" data-testid="filter-count"></span>';
  }
  const total = state.fetch.data.length;
  const visible = applyFilter(state.fetch.data).length;
  if (visible === total) {
    return '<span class="filter-count" data-testid="filter-count">' + total + ' flows</span>';
  }
  return '<span class="filter-count" data-testid="filter-count">' + visible + ' / ' + total + ' flows</span>';
}

function renderTableHtml(flows) {
  const rows = flows.map(function (f) {
    const created = timeSince(f.created_at);
    const createdTitle = toIsoTitle(f.created_at);
    return (
      '<tr class="flow-row" data-testid="flow-row" data-flow-id="' + escapeHtml(f.id) + '" tabindex="0">' +
      '<td class="mono cell-id">' + escapeHtml(f.id) + '</td>' +
      '<td class="cell-name" title="' + escapeHtml(f.name || '') + '">' + escapeHtml(f.name || '') + '</td>' +
      '<td><span class="' + statusBadgeClass(f.status) + '">' + escapeHtml(f.status || 'unknown') + '</span></td>' +
      '<td class="mono">' + escapeHtml(orDash(f.autonomy)) + '</td>' +
      '<td class="mono cell-age" title="' + escapeHtml(createdTitle) + '">' + escapeHtml(created) + '</td>' +
      '<td class="cell-priority">' + escapeHtml(orDash(f.priority)) + '</td>' +
      '</tr>'
    );
  }).join('');

  return (
    '<table class="data-table flows-table">' +
    '<thead>' +
    '<tr>' +
    '<th>flow_id</th>' +
    '<th>name</th>' +
    '<th>status</th>' +
    '<th>autonomy</th>' +
    '<th>created_at</th>' +
    '<th class="th-right">priority</th>' +
    '</tr>' +
    '</thead>' +
    '<tbody>' + rows + '</tbody>' +
    '</table>'
  );
}

function renderBodyHtml() {
  if (state.fetch.status === 'loading' && !state.fetch.data) {
    return '<div class="loading"><div class="spinner" aria-hidden="true"></div><div>Cargando flows...</div></div>';
  }
  if (state.fetch.status === 'error') {
    return (
      '<div class="state-error" data-testid="error-state">' +
      '<div class="state-error-title">Error al cargar flows: ' + escapeHtml(state.fetch.error || 'desconocido') + '</div>' +
      '<button type="button" class="btn btn-retry" data-action="retry">Reintentar</button>' +
      '</div>'
    );
  }
  const items = Array.isArray(state.fetch.data) ? state.fetch.data : [];
  if (items.length === 0) {
    return '<div class="empty-state" data-testid="empty-state">No hay flows todavia</div>';
  }
  const filtered = applyFilter(items);
  if (filtered.length === 0) {
    return (
      '<div class="empty-state" data-testid="empty-state">Ningun resultado para los filtros aplicados' +
      '<span class="empty-hint">probar limpiando algun filtro</span>' +
      '</div>'
    );
  }
  const sorted = sortFlowsDesc(filtered);
  return renderTableHtml(sorted);
}

function applyFilter(items) {
  const f = state.filter;
  return items.filter(function (it) {
    if (f.status && String(it.status || '').toLowerCase() !== f.status.toLowerCase()) return false;
    if (f.autonomy && it.autonomy !== f.autonomy) return false;
    if (f.q) {
      const needle = f.q.toLowerCase();
      const hay = (String(it.name || '') + ' ' + String(it.description || '') + ' ' + String(it.id || '')).toLowerCase();
      if (hay.indexOf(needle) === -1) return false;
    }
    return true;
  });
}

function sortFlowsDesc(items) {
  return items.slice().sort(function (a, b) {
    const ta = toEpochMs(a && a.created_at);
    const tb = toEpochMs(b && b.created_at);
    if (isNaN(ta) && isNaN(tb)) return 0;
    if (isNaN(ta)) return 1;
    if (isNaN(tb)) return -1;
    if (ta !== tb) return tb - ta;
    const ia = a && a.id ? String(a.id) : '';
    const ib = b && b.id ? String(b.id) : '';
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
}

function attachRowHandlers() {
  const rows = document.querySelectorAll('.flow-row');
  rows.forEach(function (row) {
    const handler = function () {
      const id = row.getAttribute('data-flow-id');
      if (id) openFlowDetailDrawer(id);
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

function attachFilterHandlers() {
  const statusEl = document.querySelector('[data-filter="status"]');
  const autoEl = document.querySelector('[data-filter="autonomy"]');
  const qEl = document.querySelector('[data-filter="q"]');
  const clearEl = document.querySelector('[data-action="clear-filters"]');

  if (statusEl) {
    statusEl.addEventListener('change', function () {
      state.filter.status = statusEl.value;
      paint();
    });
  }
  if (autoEl) {
    autoEl.addEventListener('change', function () {
      state.filter.autonomy = autoEl.value;
      paint();
    });
  }
  if (qEl) {
    qEl.addEventListener('input', function () {
      state.filter.q = qEl.value;
      // No repintamos todo el shell para no perder el foco; solo el body.
      paintBodyOnly();
    });
  }
  if (clearEl) {
    clearEl.addEventListener('click', function () {
      state.filter.status = '';
      state.filter.autonomy = '';
      state.filter.q = '';
      paint();
    });
  }
}

function paint() {
  const host = getHost();
  if (!host) return;
  host.innerHTML = renderShell(renderBodyHtml());
  attachFilterHandlers();
  if (state.fetch.status === 'error') attachRetryHandler();
  attachRowHandlers();
}

function paintBodyOnly() {
  const host = getHost();
  if (!host) return;
  const body = host.querySelector('.tab-body');
  const counter = host.querySelector('.filter-count');
  if (!body) {
    paint();
    return;
  }
  if (counter) {
    const fresh = document.createElement('div');
    fresh.innerHTML = renderCounter();
    const span = fresh.querySelector('.filter-count');
    if (span) counter.textContent = span.textContent;
  }
  body.innerHTML = renderBodyHtml();
  if (state.fetch.status === 'error') attachRetryHandler();
  attachRowHandlers();
}

async function load() {
  state.fetch.status = 'loading';
  state.fetch.error = undefined;
  paint();
  const res = await fetchFlows();
  if (res && res.error) {
    state.fetch.status = 'error';
    state.fetch.error = res.error;
    state.fetch.data = undefined;
    if (typeof console !== 'undefined') console.error('[flows]', res.error);
    paint();
    return;
  }
  state.fetch.status = 'success';
  state.fetch.error = undefined;
  state.fetch.data = Array.isArray(res) ? res : [];
  paint();
}

/**
 * Monta la tab Flows en #view. Resetea filtros al entrar.
 */
export function renderFlowsTab() {
  state.filter.status = '';
  state.filter.autonomy = '';
  state.filter.q = '';
  state.fetch.status = 'idle';
  state.fetch.data = undefined;
  state.fetch.error = undefined;
  load();
}
