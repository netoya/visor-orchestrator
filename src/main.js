// src/main.js
// Shell de la UI del visor: header de health (polling 5s), navegacion por hash,
// tab Stats con polling 10s y placeholders para Flows/Sessions/Waiters.

import { fetchHealth, fetchStats } from './api.js';
import { renderFlowsTab } from './components/tabs/flows.js';
import { renderSessionsTab } from './components/tabs/sessions.js';
import { renderWaitersTab } from './components/tabs/waiters.js';
import { renderCoordinateTab } from './components/tabs/CoordinateTab.js';
import { closeDrawer } from './components/drawers/drawer.js';
import { initKeyboard } from './keyboard.js';
import {
  initSettings,
  getPollMs,
  setPollMs,
  onPollMsChange,
  POLL_MIN_MS,
  POLL_MAX_MS,
} from './settings.js';

const VALID_TABS = ['flows', 'sessions', 'waiters', 'coordinate', 'stats'];

let healthIntervalId = null;
let statsIntervalId = null;

// ---------------------------------------------------------------------------
// Health header
// ---------------------------------------------------------------------------

function fmtNumber(v) {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'number') return String(v);
  return String(v);
}

function metricSpan(label, value, extraClass) {
  const cls = extraClass ? ' class="' + extraClass + '"' : '';
  return (
    '<span class="metric"' + cls + '>' +
    '<span class="label">' + label + '</span> ' +
    '<span class="value">' + value + '</span>' +
    '</span>'
  );
}

function setupHealthHeader() {
  const header = document.getElementById('health-header');
  if (!header) return;
  if (header.querySelector('.metrics')) return;

  header.innerHTML =
    '<div class="metrics" data-testid="health-header"></div>' +
    '<div class="header-spacer"></div>' +
    '<div class="poll-control">' +
      '<label for="poll-input">Intervalo de polling (ms)</label>' +
      '<input id="poll-input" type="number" min="' + POLL_MIN_MS +
        '" max="' + POLL_MAX_MS + '" step="1000" value="' + getPollMs() + '" />' +
      '<span class="poll-error" hidden>Valor permitido: ' +
        POLL_MIN_MS + ' a ' + POLL_MAX_MS + ' ms</span>' +
    '</div>';

  const input = header.querySelector('#poll-input');
  const err = header.querySelector('.poll-error');

  function applyValue() {
    if (!input) return;
    const raw = String(input.value).trim();
    const n = Number(raw);
    if (!Number.isInteger(n) || n < POLL_MIN_MS || n > POLL_MAX_MS) {
      if (err) err.hidden = false;
      return;
    }
    if (err) err.hidden = true;
    setPollMs(n);
    input.value = String(getPollMs());
  }

  if (input) {
    input.addEventListener('blur', applyValue);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        applyValue();
      }
    });
  }
}

function renderHealthHeader(data) {
  const header = document.getElementById('health-header');
  if (!header) return;
  let metrics = header.querySelector('.metrics');
  if (!metrics) {
    setupHealthHeader();
    metrics = header.querySelector('.metrics');
    if (!metrics) return;
  }

  if (!data || data.error) {
    metrics.innerHTML = '<span class="offline">health: offline</span>';
    return;
  }

  const hb = data.dispatcher_heartbeat_age_s;
  const db = data.db_wal_size_kb != null ? data.db_wal_size_kb : data.db_size_kb;
  const waiters = data.active_waiters_count;
  const uptime = data.uptime_s;

  let hbClass = '';
  if (typeof hb === 'number') {
    if (hb > 60) hbClass = 'alert-red';
    else if (hb > 30) hbClass = 'alert';
  }

  const parts = [
    metricSpan('heartbeat', fmtNumber(hb) + 's', hbClass),
    metricSpan('db', fmtNumber(db) + ' kb'),
    metricSpan('waiters', fmtNumber(waiters)),
    metricSpan('uptime', fmtNumber(uptime) + 's'),
  ];
  metrics.innerHTML = parts.join('');
}

async function tickHealth() {
  const data = await fetchHealth();
  renderHealthHeader(data);
}

function startHealthPolling() {
  if (healthIntervalId !== null) return;
  tickHealth();
  healthIntervalId = setInterval(tickHealth, getPollMs());
  onPollMsChange(function (ms) {
    if (healthIntervalId !== null) {
      clearInterval(healthIntervalId);
    }
    healthIntervalId = setInterval(tickHealth, ms);
  });
}

// ---------------------------------------------------------------------------
// Stats view
// ---------------------------------------------------------------------------

function sumValues(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  let total = 0;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === 'number') total += v;
  }
  return total;
}

function renderCard(label, value) {
  return (
    '<div class="card">' +
    '<div class="label">' + label + '</div>' +
    '<div class="value">' + value + '</div>' +
    '</div>'
  );
}

function renderMiniTable(title, header1, header2, obj) {
  const entries = obj && typeof obj === 'object' ? Object.entries(obj) : [];
  let rows;
  if (entries.length === 0) {
    rows = '<tr><td colspan="2">(empty)</td></tr>';
  } else {
    rows = entries
      .map(function (kv) {
        return '<tr><td>' + escapeHtml(String(kv[0])) + '</td><td>' + fmtNumber(kv[1]) + '</td></tr>';
      })
      .join('');
  }
  return (
    '<div class="mini-table">' +
    '<h3>' + title + '</h3>' +
    '<table>' +
    '<thead><tr><th>' + header1 + '</th><th>' + header2 + '</th></tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '</table>' +
    '</div>'
  );
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderStatsView(stats) {
  const view = document.getElementById('view');
  if (!view) return;

  if (!stats) {
    view.innerHTML = '<div class="loading">Cargando...</div>';
    return;
  }

  if (stats.error) {
    view.innerHTML =
      '<div class="error">Error al cargar /api/stats &mdash; reintentando...</div>';
    return;
  }

  const flowsTotal = fmtNumber(stats.flows_total);
  const tasksTotal = fmtNumber(sumValues(stats.tasks_by_status));
  const waitersTotal = fmtNumber(sumValues(stats.waiters_by_status));
  const sessionsTotal = fmtNumber(stats.sessions_total);

  const cards =
    '<div class="stats-cards">' +
    renderCard('Flows', flowsTotal) +
    renderCard('Tasks', tasksTotal) +
    renderCard('Waiters', waitersTotal) +
    renderCard('Sessions', sessionsTotal) +
    '</div>';

  const tables =
    '<div class="stats-tables">' +
    renderMiniTable('flows_by_status', 'Status', 'Count', stats.flows_by_status) +
    renderMiniTable('tasks_by_agent', 'Agent', 'Count', stats.tasks_by_agent) +
    renderMiniTable('waiters_by_status', 'Status', 'Count', stats.waiters_by_status) +
    '</div>';

  view.innerHTML = cards + tables;
}

async function tickStats() {
  const data = await fetchStats();
  renderStatsView(data);
}

function startStatsPolling() {
  stopStatsPolling();
  renderStatsView(null);
  tickStats();
  statsIntervalId = setInterval(tickStats, 10000);
}

function stopStatsPolling() {
  if (statsIntervalId !== null) {
    clearInterval(statsIntervalId);
    statsIntervalId = null;
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function currentTab() {
  const raw = (location.hash || '').replace(/^#/, '').toLowerCase();
  if (VALID_TABS.indexOf(raw) === -1) return 'flows';
  return raw;
}

function markActiveTab(tab) {
  const nav = document.getElementById('tabs');
  if (!nav) return;
  const links = nav.querySelectorAll('a');
  links.forEach(function (a) {
    const target = (a.getAttribute('href') || '').replace(/^#/, '').toLowerCase();
    const isActive = target === tab;
    if (isActive) a.classList.add('active');
    else a.classList.remove('active');
    a.setAttribute('aria-selected', isActive ? 'true' : 'false');
    a.setAttribute('role', 'tab');
    if (target) a.setAttribute('data-testid', 'tab-' + target);
  });
}

let lastTab = null;

function router() {
  const tab = currentTab();
  markActiveTab(tab);

  if (tab !== 'stats') stopStatsPolling();
  // Cerrar cualquier drawer abierto cuando cambia de tab (excepto en el
  // primer mount, para no interrumpir aperturas dentro de la misma tab).
  if (lastTab !== null && lastTab !== tab) closeDrawer();
  lastTab = tab;

  switch (tab) {
    case 'stats':
      startStatsPolling();
      break;
    case 'flows':
      renderFlowsTab();
      break;
    case 'sessions':
      renderSessionsTab();
      break;
    case 'waiters':
      renderWaitersTab();
      break;
    case 'coordinate':
      renderCoordinateTab();
      break;
    default:
      renderFlowsTab();
      break;
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

window.addEventListener('hashchange', router);

initSettings();
if (!location.hash) {
  location.hash = '#flows';
}
setupHealthHeader();
router();
initKeyboard();
startHealthPolling();
