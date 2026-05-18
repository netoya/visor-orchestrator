// src/components/tabs/sessions.js
// Tab Sessions: tabla con sesiones (alive / zombie / finished) + filtros
// por agent y process_status. La API NO devuelve pid, asi que se muestra
// "-" en esa columna. flow_id/task_id clickeables: navegan a la tab Flows
// abriendo el drawer.
// Cubre AC1/AC2/AC3 (loading/empty/error), AC6.2 (filtros) y AC9 (time-since).

import { fetchSessions } from '../../api.js';
import { openFlowDetailDrawer } from '../drawers/flow-detail.js';
import {
  escapeHtml,
  processStatusBadgeClass,
  toEpochMs,
} from '../../utils/format.js';
import { timeSince, toIsoTitle } from '../../lib/timeSince.js';

const VIEW_ID = 'view';

const PROCESS_STATUS_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'alive', label: 'alive' },
  { value: 'zombie', label: 'zombie' },
  { value: 'finished', label: 'finished' },
];

const state = {
  fetch: { status: 'idle', data: undefined, error: undefined },
  filter: { agent: '', processStatus: '' },
};

function getHost() {
  return document.getElementById(VIEW_ID);
}

function uniqueAgents(items) {
  const set = new Set();
  for (let i = 0; i < items.length; i++) {
    const a = items[i] && items[i].agent_id;
    if (a) set.add(a);
  }
  return Array.from(set).sort();
}

function renderShell(innerHtml) {
  return (
    '<section class="tab-sessions">' +
    '<h2 class="tab-title">Sessions</h2>' +
    renderFilterBar() +
    '<div class="tab-body">' + innerHtml + '</div>' +
    '</section>'
  );
}

function renderFilterBar() {
  const items = Array.isArray(state.fetch.data) ? state.fetch.data : [];
  const agents = uniqueAgents(items);
  const agentOpts = ['<option value="">Todos</option>'].concat(
    agents.map(function (a) {
      const sel = a === state.filter.agent ? ' selected' : '';
      return '<option value="' + escapeHtml(a) + '"' + sel + '>' + escapeHtml(a) + '</option>';
    })
  ).join('');
  const psOpts = PROCESS_STATUS_OPTIONS.map(function (o) {
    const sel = o.value === state.filter.processStatus ? ' selected' : '';
    return '<option value="' + escapeHtml(o.value) + '"' + sel + '>' + escapeHtml(o.label) + '</option>';
  }).join('');
  const counter = renderCounter();
  return (
    '<div class="filter-bar" role="group" aria-label="Filtros de sessions">' +
    '<div class="filter-group">' +
    '<label for="flt-sess-agent">agent</label>' +
    '<select id="flt-sess-agent" data-filter="agent">' + agentOpts + '</select>' +
    '</div>' +
    '<div class="filter-group">' +
    '<label for="flt-sess-ps">process_status</label>' +
    '<select id="flt-sess-ps" data-filter="processStatus">' + psOpts + '</select>' +
    '</div>' +
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
  if (visible === total) return '<span class="filter-count">' + total + ' sessions</span>';
  return '<span class="filter-count">' + visible + ' / ' + total + ' sessions</span>';
}

function applyFilter(items) {
  const f = state.filter;
  return items.filter(function (s) {
    if (f.agent && s.agent_id !== f.agent) return false;
    if (f.processStatus && s.process_status !== f.processStatus) return false;
    return true;
  });
}

function sortByLastUsedDesc(items) {
  return items.slice().sort(function (a, b) {
    const ta = toEpochMs(a && a.last_used_at);
    const tb = toEpochMs(b && b.last_used_at);
    if (isNaN(ta) && isNaN(tb)) return 0;
    if (isNaN(ta)) return 1;
    if (isNaN(tb)) return -1;
    return tb - ta;
  });
}

function renderTableHtml(sessions) {
  const rows = sessions.map(function (s) {
    const ageVal = timeSince(s.last_used_at);
    const ageTitle = toIsoTitle(s.last_used_at);
    const flowId = s.flow_id || null;
    const taskId = s.task_id || null;
    const flowCell = flowId
      ? '<a href="#" class="link-cell" data-link-flow="' + escapeHtml(flowId) + '" title="' + escapeHtml(flowId) + '">' + escapeHtml(flowId) + '</a>'
      : '-';
    const taskCell = taskId
      ? '<a href="#" class="link-cell" data-link-flow="' + escapeHtml(flowId || '') + '" data-link-task="' + escapeHtml(taskId) + '" title="' + escapeHtml(taskId) + '">' + escapeHtml(taskId) + '</a>'
      : '-';
    return (
      '<tr>' +
      '<td><span class="' + processStatusBadgeClass(s.process_status) + '">' + escapeHtml(s.process_status || 'unknown') + '</span></td>' +
      '<td class="mono">-</td>' +
      '<td class="mono cell-age" title="' + escapeHtml(ageTitle) + '">' + escapeHtml(ageVal) + '</td>' +
      '<td class="mono">' + escapeHtml(s.agent_id || '-') + '</td>' +
      '<td class="mono cell-trunc">' + flowCell + '</td>' +
      '<td class="mono cell-trunc">' + taskCell + '</td>' +
      '</tr>'
    );
  }).join('');

  return (
    '<table class="data-table sessions-table">' +
    '<thead>' +
    '<tr>' +
    '<th>process_status</th>' +
    '<th>pid</th>' +
    '<th>last_used</th>' +
    '<th>agent_id</th>' +
    '<th>flow_id</th>' +
    '<th>task_id</th>' +
    '</tr>' +
    '</thead>' +
    '<tbody>' + rows + '</tbody>' +
    '</table>'
  );
}

function renderBodyHtml() {
  if (state.fetch.status === 'loading' && !state.fetch.data) {
    return '<div class="loading"><div class="spinner" aria-hidden="true"></div><div>Cargando sessions...</div></div>';
  }
  if (state.fetch.status === 'error') {
    return (
      '<div class="state-error">' +
      '<div class="state-error-title">Error al cargar sessions: ' + escapeHtml(state.fetch.error || 'desconocido') + '</div>' +
      '<button type="button" class="btn btn-retry" data-action="retry">Reintentar</button>' +
      '</div>'
    );
  }
  const items = Array.isArray(state.fetch.data) ? state.fetch.data : [];
  if (items.length === 0) {
    return '<div class="empty-state">No hay sessions activas</div>';
  }
  const filtered = applyFilter(items);
  if (filtered.length === 0) {
    return (
      '<div class="empty-state">Ningun resultado para los filtros aplicados' +
      '<span class="empty-hint">probar limpiando algun filtro</span>' +
      '</div>'
    );
  }
  return renderTableHtml(sortByLastUsedDesc(filtered));
}

function attachLinkHandlers() {
  const links = document.querySelectorAll('.link-cell');
  links.forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      const flowId = a.getAttribute('data-link-flow');
      if (!flowId) return;
      if (location.hash !== '#flows') location.hash = '#flows';
      openFlowDetailDrawer(flowId);
    });
  });
}

function attachRetryHandler() {
  const retry = document.querySelector('[data-action="retry"]');
  if (retry) retry.addEventListener('click', function () { load(); });
}

function attachFilterHandlers() {
  const agentEl = document.querySelector('[data-filter="agent"]');
  const psEl = document.querySelector('[data-filter="processStatus"]');
  if (agentEl) {
    agentEl.addEventListener('change', function () {
      state.filter.agent = agentEl.value;
      paint();
    });
  }
  if (psEl) {
    psEl.addEventListener('change', function () {
      state.filter.processStatus = psEl.value;
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
  attachLinkHandlers();
}

async function load() {
  state.fetch.status = 'loading';
  state.fetch.error = undefined;
  paint();
  const res = await fetchSessions();
  if (res && res.error) {
    state.fetch.status = 'error';
    state.fetch.error = res.error;
    state.fetch.data = undefined;
    if (typeof console !== 'undefined') console.error('[sessions]', res.error);
    paint();
    return;
  }
  state.fetch.status = 'success';
  state.fetch.error = undefined;
  state.fetch.data = Array.isArray(res) ? res : [];
  paint();
}

/**
 * Monta la tab Sessions en #view. Resetea filtros al entrar.
 */
export function renderSessionsTab() {
  state.filter.agent = '';
  state.filter.processStatus = '';
  state.fetch.status = 'idle';
  state.fetch.data = undefined;
  state.fetch.error = undefined;
  load();
}
