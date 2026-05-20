// src/components/tabs/CoordinateTab.js
// Tab Coordinate: state machine de 7 estados para el flujo prepare->confirm
// del visor (spec docs/specs/v1-write-operations.md §3).
//
// Estados (state machine §3.1.1 + §3.2):
//   - idle               : textarea + Prepare + Clear + Recent prepares (LS).
//   - preparing          : spinner + flowId + elapsed counter (polling 2s).
//   - proposal-ready     : renderiza PLAN-{PROPOSAL,FINAL}.md + Confirm/Edit.
//   - blocked-by-waiter  : preguntas NL + SchemaForm + onRespondDifferently.
//   - respond-differently: sub-estado interno del SchemaForm (no es estado
//                          propio aqui — el SchemaForm lo gestiona y nos
//                          notifica via callback).
//   - confirming         : spinner + IDs de prepare/execute.
//   - executing          : redirect a tab Flows + drawer del flow ejecutor.
//   - error              : banner rojo + Retry/Edit.
//
// Iteracion (§3.5):
//   - "Submit answers"        -> POST fulfill + POST prepare (previousFlowId,
//                                answers) -> vuelve a preparing.
//   - "Respond differently"   -> POST prepare (previousFlowId, customResponse)
//                                SIN fulfill. Marca el flow anterior como
//                                'superseded' en localStorage.
//
// Cap de iteraciones (§9.7):
//   - Contador por "lineage" (idea inicial + cadena de previousFlowId).
//   - Al llegar a 3 vueltas mostramos banner "no convergencia".
//
// Markdown renderer:
//   - No hay lib en el proyecto (ver package.json). Implementamos un parser
//     minimo aqui: headers (#..######), unordered/ordered lists, fenced code
//     blocks (```), tablas pipe (|...|), inline (`code`, **bold**, *italic*,
//     [link](url)). Suficiente para PLAN-PROPOSAL.md / PLAN-FINAL.md.

import './CoordinateTab.css';

import {
  fetchPrepareState,
  postConfirm,
  postFulfillWaiter,
  postPrepare,
} from '../../api.js';
import { createSchemaForm } from '../forms/SchemaForm.js';
import { openFlowDetailDrawer } from '../drawers/flow-detail.js';
import { escapeHtml } from '../../utils/format.js';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const VIEW_ID = 'view';
const POLL_INTERVAL_MS = 2000;
const POLL_STALL_TIMEOUT_MS = 90_000; // §3.6: 90s sin cambio -> error
const MIN_IDEA_LEN = 20;
const MAX_IDEA_LEN = 8000;
const MAX_ITERATIONS = 3;
const MAX_RECENT = 5;

const LS_RECENT_KEY = 'visor.coordinate.recent';
const LS_LINEAGE_KEY = 'visor.coordinate.lineage';
const LS_SUPERSEDED_KEY = 'visor.coordinate.superseded';

// ---------------------------------------------------------------------------
// Estado del modulo
// ---------------------------------------------------------------------------

const state = {
  /** @type {'idle'|'preparing'|'proposal-ready'|'blocked-by-waiter'|'confirming'|'executing'|'error'} */
  status: 'idle',
  idea: '',
  /** flowId del prepare actual (en preparing/proposal-ready/blocked-by-waiter). */
  flowId: null,
  /** Texto markdown del PLAN-PROPOSAL.md / PLAN-FINAL.md. */
  proposalMarkdown: '',
  /** Waiter pasivo activo (solo en blocked-by-waiter). */
  waiter: null,
  /** Mensaje de error (solo en error). */
  errorMessage: '',
  /** Resultado del confirm: {executeFlowId, executeCoordinatorTaskId}. */
  confirmResult: null,

  // Lineage tracking (§9.7).
  /** flowId raiz del linaje (cadena de previousFlowId). */
  lineageRoot: null,
  /** Numero de vueltas del lineage. 0 al iniciar. */
  lineageCount: 0,
  /** Idea raiz (texto) — se preserva tras iterar para reuse en submit. */
  lineageIdea: '',

  // Polling.
  /** id del setInterval (o null). */
  pollIntervalId: null,
  /** epoch ms al arrancar el polling actual. */
  pollStartedAt: 0,
  /** epoch ms del ultimo cambio de estado detectado por el poll. */
  lastStateChangeAt: 0,
  /** id del setInterval del contador "Elapsed". */
  elapsedIntervalId: null,
};

// ---------------------------------------------------------------------------
// Helpers DOM
// ---------------------------------------------------------------------------

function getHost() {
  return document.getElementById(VIEW_ID);
}

function $(sel, root) {
  return (root || document).querySelector(sel);
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function getRecent() {
  try {
    const raw = localStorage.getItem(LS_RECENT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_e) {
    return [];
  }
}

function persistRecent(list) {
  try {
    localStorage.setItem(LS_RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch (_e) {
    // QuotaExceeded u otros: silencioso, no es bloqueante.
  }
}

function addRecent(entry) {
  const list = getRecent().filter(function (e) { return e && e.flowId !== entry.flowId; });
  list.unshift(entry);
  persistRecent(list);
}

function updateRecentState(flowId, nextState) {
  const list = getRecent();
  let changed = false;
  for (const e of list) {
    if (e && e.flowId === flowId) {
      e.state = nextState;
      changed = true;
      break;
    }
  }
  if (changed) persistRecent(list);
}

function getLineageMap() {
  try {
    const raw = localStorage.getItem(LS_LINEAGE_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch (_e) {
    return {};
  }
}

function persistLineage(rootId, count, idea) {
  const map = getLineageMap();
  map[rootId] = { count: count, idea: idea, updatedAt: Date.now() };
  try {
    localStorage.setItem(LS_LINEAGE_KEY, JSON.stringify(map));
  } catch (_e) { /* noop */ }
}

function markSuperseded(flowId) {
  try {
    const raw = localStorage.getItem(LS_SUPERSEDED_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list) && list.indexOf(flowId) === -1) {
      list.push(flowId);
      localStorage.setItem(LS_SUPERSEDED_KEY, JSON.stringify(list));
    }
  } catch (_e) { /* noop */ }
}

// ---------------------------------------------------------------------------
// Markdown renderer (minimo, suficiente para PLAN-*.md)
// ---------------------------------------------------------------------------

function renderMarkdown(md) {
  if (!md || typeof md !== 'string') return '';
  const lines = md.split(/\r?\n/);
  let out = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim();
      i++;
      let code = '';
      while (i < lines.length && !/^```/.test(lines[i])) {
        code += lines[i] + '\n';
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      const langAttr = lang ? ' data-lang="' + escapeHtml(lang) + '"' : '';
      out += '<pre class="md-code mono"' + langAttr + '><code>' + escapeHtml(code.replace(/\n$/, '')) + '</code></pre>';
      continue;
    }

    // Table (header + separator + rows)
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s\-:|]+\|\s*$/.test(lines[i + 1])) {
      const headers = parseTableRow(line);
      i += 2; // skip header + separator
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      out += renderTable(headers, rows);
      continue;
    }

    // Header
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = h[1].length;
      out += '<h' + level + ' class="md-h md-h' + level + '">' + renderInline(h[2]) + '</h' + level + '>';
      i++;
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      let items = '';
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const item = lines[i].replace(/^\s*[-*]\s+/, '');
        items += '<li>' + renderInline(item) + '</li>';
        i++;
      }
      out += '<ul class="md-ul">' + items + '</ul>';
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      let items = '';
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const item = lines[i].replace(/^\s*\d+\.\s+/, '');
        items += '<li>' + renderInline(item) + '</li>';
        i++;
      }
      out += '<ol class="md-ol">' + items + '</ol>';
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) {
      out += '<hr class="md-hr" />';
      i++;
      continue;
    }

    // Paragraph: agrupa lineas no-vacias hasta siguiente bloque/blank.
    let para = line;
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\s*[-*]\s/.test(lines[i]) &&
      !/^\s*\d+\.\s/.test(lines[i]) &&
      !/^\s*\|.*\|\s*$/.test(lines[i])
    ) {
      para += '\n' + lines[i];
      i++;
    }
    out += '<p class="md-p">' + renderInline(para) + '</p>';
  }
  return out;
}

function parseTableRow(line) {
  const t = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '');
  return t.split('|').map(function (c) { return c.trim(); });
}

function renderTable(headers, rows) {
  let html = '<table class="md-table"><thead><tr>';
  headers.forEach(function (h) { html += '<th>' + renderInline(h) + '</th>'; });
  html += '</tr></thead><tbody>';
  rows.forEach(function (row) {
    html += '<tr>';
    // Si la row tiene menos cols que headers, paddear con celdas vacias.
    const max = Math.max(headers.length, row.length);
    for (let c = 0; c < max; c++) {
      html += '<td>' + renderInline(row[c] || '') + '</td>';
    }
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

function renderInline(text) {
  let out = escapeHtml(text);
  // inline code
  out = out.replace(/`([^`]+)`/g, '<code class="md-icode mono">$1</code>');
  // bold + italic combinaciones (orden importa)
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  // links [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  // line breaks dentro de paragrafo
  out = out.replace(/\n/g, '<br />');
  return out;
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

function stopPolling() {
  if (state.pollIntervalId !== null) {
    clearInterval(state.pollIntervalId);
    state.pollIntervalId = null;
  }
  if (state.elapsedIntervalId !== null) {
    clearInterval(state.elapsedIntervalId);
    state.elapsedIntervalId = null;
  }
}

function startPolling(flowId) {
  stopPolling();
  state.pollStartedAt = Date.now();
  state.lastStateChangeAt = Date.now();
  // Tick inmediato + interval.
  tickPrepareState(flowId);
  state.pollIntervalId = setInterval(function () {
    tickPrepareState(flowId);
  }, POLL_INTERVAL_MS);
  // Tick del contador "Elapsed" 1s.
  state.elapsedIntervalId = setInterval(function () {
    if (state.status === 'preparing') updateElapsedCounter();
  }, 1000);
}

async function tickPrepareState(flowId) {
  // Detectar stall (§3.6): si llevamos POLL_STALL_TIMEOUT_MS sin cambio, error.
  if (Date.now() - state.lastStateChangeAt > POLL_STALL_TIMEOUT_MS && state.status === 'preparing') {
    stopPolling();
    transitionToError('El planner no respondio en 90s. Reintenta o edita la idea.');
    return;
  }

  const res = await fetchPrepareState(flowId);
  if (state.flowId !== flowId) return; // raza: cambio de prepare en vuelo.
  if (res && res.error) {
    // Error transitorio: seguimos polleando (no rompemos el ciclo a la primera).
    return;
  }

  const next = res && res.state;
  if (!next) return;

  if (next === 'preparing') {
    // Sin cambio. NoOp.
    return;
  }

  if (next === 'proposal-ready') {
    state.lastStateChangeAt = Date.now();
    state.proposalMarkdown = String(res.proposalMarkdown || '');
    state.waiter = null;
    stopPolling();
    transition('proposal-ready');
    updateRecentState(flowId, 'proposal-ready');
    return;
  }

  if (next === 'blocked-by-waiter') {
    state.lastStateChangeAt = Date.now();
    state.proposalMarkdown = String(res.proposalMarkdown || '');
    state.waiter = res.waiter || null;
    stopPolling();
    transition('blocked-by-waiter');
    updateRecentState(flowId, 'blocked-by-waiter');
    return;
  }

  if (next === 'error') {
    stopPolling();
    transitionToError(res.errorMessage || 'planner failed');
    return;
  }
}

function updateElapsedCounter() {
  const el = document.querySelector('[data-coord-elapsed]');
  if (!el) return;
  const secs = Math.max(0, Math.floor((Date.now() - state.pollStartedAt) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  el.textContent = m + ':' + (s < 10 ? '0' + s : String(s));
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

function transition(next) {
  state.status = next;
  paint();
}

function transitionToError(msg) {
  state.status = 'error';
  state.errorMessage = String(msg || 'unknown error');
  paint();
}

function resetToIdle(opts) {
  const keepIdea = opts && opts.keepIdea;
  stopPolling();
  state.status = 'idle';
  if (!keepIdea) state.idea = '';
  state.flowId = null;
  state.proposalMarkdown = '';
  state.waiter = null;
  state.errorMessage = '';
  state.confirmResult = null;
  state.lineageRoot = null;
  state.lineageCount = 0;
  state.lineageIdea = '';
  paint();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function actionPrepare(opts) {
  const useIdea = opts && typeof opts.idea === 'string' ? opts.idea : state.idea;
  const trimmed = (useIdea || '').trim();
  if (trimmed.length < MIN_IDEA_LEN) {
    transitionToError('La idea debe tener al menos ' + MIN_IDEA_LEN + ' caracteres.');
    return;
  }
  if (trimmed.length > MAX_IDEA_LEN) {
    transitionToError('La idea excede ' + MAX_IDEA_LEN + ' caracteres.');
    return;
  }

  // Si es un nuevo "linaje" (sin previousFlowId), reset count.
  const isNewLineage = !(opts && (opts.previousFlowId));
  if (isNewLineage) {
    state.lineageRoot = null;
    state.lineageCount = 0;
    state.lineageIdea = trimmed;
  }

  // Iteration cap check (§9.7). El check se hace ANTES de iterar, pero solo
  // si NO es una iteracion fresh. lineageCount cuenta vueltas ya hechas; tras
  // 3, se bloquea.
  if (!isNewLineage && state.lineageCount >= MAX_ITERATIONS) {
    transitionToError(
      'El planner no esta convergiendo despues de ' + MAX_ITERATIONS +
      ' rondas de clarificacion. Edita la idea original para reformular, o cancela.',
    );
    return;
  }

  state.idea = trimmed;
  state.proposalMarkdown = '';
  state.waiter = null;
  state.errorMessage = '';
  transition('preparing');

  const body = { idea: trimmed };
  if (opts && opts.previousFlowId) body.previousFlowId = opts.previousFlowId;
  if (opts && opts.answers) body.answers = opts.answers;
  if (opts && typeof opts.customResponse === 'string') body.customResponse = opts.customResponse;

  const res = await postPrepare(body);
  if (!res || res.error) {
    transitionToError((res && res.error) || 'POST /api/flows/prepare failed');
    return;
  }
  if (!res.flowId) {
    transitionToError('Respuesta sin flowId del backend');
    return;
  }

  // Linaje: si era fresh, root = nuevo flowId.
  if (isNewLineage) {
    state.lineageRoot = res.flowId;
    state.lineageCount = 1;
  } else {
    state.lineageCount = (state.lineageCount || 0) + 1;
  }
  persistLineage(state.lineageRoot, state.lineageCount, state.lineageIdea);

  state.flowId = res.flowId;
  addRecent({
    flowId: res.flowId,
    idea: trimmed,
    state: 'preparing',
    createdAt: Date.now(),
    lineageRoot: state.lineageRoot,
  });

  startPolling(res.flowId);
}

async function actionConfirm() {
  if (!state.flowId) {
    transitionToError('No hay flowId para confirmar');
    return;
  }
  const prepareFlowId = state.flowId;
  transition('confirming');

  const res = await postConfirm(prepareFlowId);
  if (!res || res.error) {
    state.flowId = prepareFlowId; // restauramos para permitir retry desde proposal.
    transitionToError((res && res.error) || 'POST /api/flows/confirm failed');
    return;
  }
  state.confirmResult = {
    executeFlowId: res.executeFlowId,
    executeCoordinatorTaskId: res.executeCoordinatorTaskId,
  };
  updateRecentState(prepareFlowId, 'executing');

  // Transicion final: redirect a tab Flows con drawer del flow ejecutor.
  transition('executing');
  // Pequeno delay para que el usuario vea el estado "executing" antes del jump.
  setTimeout(function () {
    if (state.confirmResult && state.confirmResult.executeFlowId) {
      const executeId = state.confirmResult.executeFlowId;
      // Reset interno tras lanzar el redirect.
      resetToIdle({ keepIdea: false });
      // Navega a Flows y abre el drawer.
      if (location.hash !== '#flows') {
        location.hash = '#flows';
      }
      // openFlowDetailDrawer es seguro de llamar tras hashchange porque el
      // router ya pintara la tab Flows.
      setTimeout(function () { openFlowDetailDrawer(executeId); }, 50);
    }
  }, 600);
}

async function actionSubmitAnswers(answers) {
  if (!state.waiter || !state.flowId) {
    transitionToError('No hay waiter ni flowId actual para iterar');
    return;
  }
  const waiterId = state.waiter.id;
  const previousFlowId = state.flowId;
  transition('preparing'); // visualmente entramos a preparing ya.

  const fulfillRes = await postFulfillWaiter(waiterId, answers);
  if (!fulfillRes || fulfillRes.error) {
    transitionToError('Fulfill failed: ' + ((fulfillRes && fulfillRes.error) || 'unknown'));
    return;
  }
  // Lanzar nuevo prepare con previousFlowId + answers.
  await actionPrepare({
    idea: state.lineageIdea || state.idea,
    previousFlowId: previousFlowId,
    answers: answers,
  });
}

async function actionRespondDifferently(customResponse) {
  if (!state.flowId) {
    transitionToError('No hay flowId actual');
    return;
  }
  const previousFlowId = state.flowId;
  // NO fulfill del waiter actual (§3.5 + §4.2.1).
  markSuperseded(previousFlowId);
  updateRecentState(previousFlowId, 'superseded');

  await actionPrepare({
    idea: state.lineageIdea || state.idea,
    previousFlowId: previousFlowId,
    customResponse: customResponse,
  });
}

function actionCancelToIdle() {
  resetToIdle({ keepIdea: true });
}

function actionEditIdea() {
  // Edit idea: volver a idle conservando textarea.
  state.flowId = null;
  state.proposalMarkdown = '';
  state.waiter = null;
  state.errorMessage = '';
  state.confirmResult = null;
  state.lineageRoot = null;
  state.lineageCount = 0;
  // NOTA: state.idea se conserva para que el operador edite el texto.
  stopPolling();
  transition('idle');
}

function actionRetry() {
  // Retry usa la idea conservada.
  state.errorMessage = '';
  if (!state.lineageIdea && state.idea) state.lineageIdea = state.idea;
  actionPrepare({ idea: state.lineageIdea || state.idea });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderShell(bodyHtml) {
  return (
    '<section class="tab-coordinate">' +
    '<h2 class="tab-title">Coordinate</h2>' +
    '<div class="coord-body">' + bodyHtml + '</div>' +
    '</section>'
  );
}

function renderIdle() {
  const idea = escapeHtml(state.idea || '');
  const recent = renderRecent();
  const disabled = (state.idea || '').trim().length < MIN_IDEA_LEN ? ' disabled' : '';
  return (
    '<div class="coord-card coord-idle">' +
    '<div class="coord-head">' +
    '<div class="coord-head-title">New flow (planner-assisted)</div>' +
    '<div class="coord-head-sub">' +
    'Describe the idea. The planner will draft a plan and ask for ' +
    'clarifications if anything is ambiguous.' +
    '</div>' +
    '</div>' +
    '<textarea ' +
    'class="coord-textarea mono" ' +
    'data-coord="idea" ' +
    'rows="12" ' +
    'autofocus ' +
    'maxlength="' + MAX_IDEA_LEN + '" ' +
    'placeholder="Crear un comando CLI nuevo en algun repo para ver el estado del flow actual: tasks con status, waiters pendientes, duracion total.">' +
    idea +
    '</textarea>' +
    '<div class="coord-textarea-meta">' +
    '<span data-coord="idea-count">' + (state.idea || '').length + '</span> / ' + MAX_IDEA_LEN +
    ' &middot; min ' + MIN_IDEA_LEN +
    '</div>' +
    '<div class="coord-actions">' +
    '<button type="button" class="btn btn-primary" data-coord-action="prepare"' + disabled + '>Prepare</button>' +
    '<button type="button" class="btn" data-coord-action="clear">Clear</button>' +
    '</div>' +
    recent +
    '</div>'
  );
}

function renderRecent() {
  const list = getRecent();
  if (list.length === 0) return '';
  const items = list.map(function (e) {
    const idShort = String(e.flowId || '').slice(0, 10) + '...';
    const ideaShort = (e.idea || '').slice(0, 80) + ((e.idea || '').length > 80 ? '...' : '');
    const stateLabel = e.state || 'unknown';
    return (
      '<li class="coord-recent-item">' +
      '<span class="mono coord-recent-id">' + escapeHtml(idShort) + '</span>' +
      ' &mdash; ' +
      '<span class="coord-recent-idea" title="' + escapeHtml(e.idea || '') + '">' + escapeHtml(ideaShort) + '</span>' +
      ' <span class="coord-recent-state mono">(' + escapeHtml(stateLabel) + ')</span>' +
      '</li>'
    );
  }).join('');
  return (
    '<div class="coord-recent">' +
    '<div class="coord-recent-title">Recent prepares (last ' + MAX_RECENT + ')</div>' +
    '<ul class="coord-recent-list">' + items + '</ul>' +
    '</div>'
  );
}

function renderPreparing() {
  return (
    '<div class="coord-card coord-preparing">' +
    '<div class="coord-spinner-row">' +
    '<div class="spinner" aria-hidden="true"></div>' +
    '<div class="coord-spinner-text">Roman is analyzing your idea&hellip;</div>' +
    '</div>' +
    '<dl class="coord-kv">' +
    '<dt>Flow</dt><dd class="mono">' + escapeHtml(state.flowId || '-') + '</dd>' +
    '<dt>Elapsed</dt><dd class="mono" data-coord-elapsed>0:00</dd>' +
    '</dl>' +
    '<div class="coord-help muted">polling /api/flows/:id/prepare-state every ' + (POLL_INTERVAL_MS / 1000) + 's</div>' +
    '<div class="coord-actions">' +
    '<button type="button" class="btn" data-coord-action="cancel">Cancel</button>' +
    '</div>' +
    '</div>'
  );
}

function renderProposalReady() {
  const banner = renderIterationBanner();
  const md = renderMarkdown(state.proposalMarkdown);
  return (
    '<div class="coord-card coord-proposal">' +
    '<div class="coord-card-title">Plan ready &mdash; review</div>' +
    banner +
    '<div class="coord-md md-block">' + (md || '<div class="muted">(sin contenido)</div>') + '</div>' +
    '<div class="coord-actions sticky-footer">' +
    '<button type="button" class="btn btn-primary" data-coord-action="confirm">Confirm and execute</button>' +
    '<button type="button" class="btn" data-coord-action="edit-idea">Edit idea</button>' +
    '</div>' +
    '</div>'
  );
}

function renderBlockedByWaiter() {
  const banner = renderIterationBanner();
  // Mostrar el markdown como contexto, scrolleable y compacto arriba.
  const md = renderMarkdown(state.proposalMarkdown);
  // Extraer preguntas NL del markdown (heuristico) o desde el prompt del waiter.
  const questions = extractQuestionsFromMarkdown(state.proposalMarkdown, state.waiter);
  return (
    '<div class="coord-card coord-blocked">' +
    '<div class="coord-card-title">Clarifications needed</div>' +
    banner +
    (md
      ? '<details class="coord-context" open>' +
        '<summary>Context (PLAN-PROPOSAL.md)</summary>' +
        '<div class="coord-md md-block compact">' + md + '</div>' +
        '</details>'
      : ''
    ) +
    '<div class="coord-help">' +
    'The planner needs you to resolve these before drafting a firm plan:' +
    '</div>' +
    (questions.length > 0
      ? '<ol class="coord-questions">' +
        questions.map(function (q) { return '<li>' + escapeHtml(q) + '</li>'; }).join('') +
        '</ol>'
      : '<div class="muted">(no se detectaron preguntas en lenguaje natural)</div>'
    ) +
    '<div class="coord-form-host" data-coord-form-host></div>' +
    '</div>'
  );
}

function extractQuestionsFromMarkdown(md, waiter) {
  // Heuristica: buscar lineas que comiencen con un numero "1. ..." o "- ..."
  // tras un header tipo "Ambiguedades", "Preguntas" o "Clarifications".
  if (!md) return waiterQuestionsFallback(waiter);
  const lines = md.split(/\r?\n/);
  const out = [];
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,6}\s/.test(line)) {
      const t = line.toLowerCase();
      inSection = /ambig|pregunt|clarific/.test(t);
      continue;
    }
    if (inSection) {
      const m = /^\s*(?:\d+\.|[-*])\s+(.+)$/.exec(line);
      if (m) {
        // Quita formato markdown basico para mostrar texto plano.
        const text = m[1].replace(/[*_`]/g, '').trim();
        if (text) out.push(text);
      }
    }
  }
  if (out.length > 0) return out;
  return waiterQuestionsFallback(waiter);
}

function waiterQuestionsFallback(waiter) {
  if (!waiter || !waiter.schema_json) return [];
  let parsed = waiter.schema_json;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch (_e) { return []; }
  }
  if (!parsed || !parsed.properties) return [];
  return Object.keys(parsed.properties).map(function (name) {
    const prop = parsed.properties[name];
    const head = name;
    if (prop && Array.isArray(prop.enum) && prop.enum.length > 0) {
      return head + ' — ' + prop.enum.join(' / ');
    }
    return head;
  });
}

function renderIterationBanner() {
  if (!state.lineageCount) return '';
  if (state.lineageCount < MAX_ITERATIONS) {
    return (
      '<div class="coord-iteration-info muted">' +
      'Iteration ' + state.lineageCount + ' / ' + MAX_ITERATIONS +
      '</div>'
    );
  }
  return (
    '<div class="coord-iteration-warning">' +
    'No convergencia: el planner no esta convergiendo despues de ' + MAX_ITERATIONS +
    ' rondas. Edita la idea original para reformular, o cancela.' +
    '</div>'
  );
}

function renderConfirming() {
  return (
    '<div class="coord-card coord-confirming">' +
    '<div class="coord-spinner-row">' +
    '<div class="spinner" aria-hidden="true"></div>' +
    '<div class="coord-spinner-text">Launching execution coordinator based on PLAN-FINAL.md&hellip;</div>' +
    '</div>' +
    '<dl class="coord-kv">' +
    '<dt>Prepare flow</dt><dd class="mono">' + escapeHtml(state.flowId || '-') + '</dd>' +
    '<dt>Execute flow</dt><dd class="mono">' + escapeHtml((state.confirmResult && state.confirmResult.executeFlowId) || '(creating)') + '</dd>' +
    '</dl>' +
    '</div>'
  );
}

function renderExecuting() {
  const execId = (state.confirmResult && state.confirmResult.executeFlowId) || '-';
  return (
    '<div class="coord-card coord-executing">' +
    '<div class="coord-card-title">Executing</div>' +
    '<div class="coord-help">Redirigiendo a tab Flows con el drawer del flow ejecutor abierto&hellip;</div>' +
    '<dl class="coord-kv">' +
    '<dt>Execute flow</dt><dd class="mono">' + escapeHtml(execId) + '</dd>' +
    '</dl>' +
    '</div>'
  );
}

function renderError() {
  return (
    '<div class="coord-card coord-error">' +
    '<div class="coord-error-title">Something went wrong</div>' +
    '<pre class="coord-error-msg mono">' + escapeHtml(state.errorMessage || 'unknown error') + '</pre>' +
    '<div class="coord-actions">' +
    '<button type="button" class="btn btn-primary" data-coord-action="retry">Retry</button>' +
    '<button type="button" class="btn" data-coord-action="edit-idea">Edit idea</button>' +
    '</div>' +
    '</div>'
  );
}

function renderBody() {
  switch (state.status) {
    case 'preparing': return renderPreparing();
    case 'proposal-ready': return renderProposalReady();
    case 'blocked-by-waiter': return renderBlockedByWaiter();
    case 'confirming': return renderConfirming();
    case 'executing': return renderExecuting();
    case 'error': return renderError();
    case 'idle':
    default: return renderIdle();
  }
}

function paint() {
  const host = getHost();
  if (!host) return;
  host.innerHTML = renderShell(renderBody());
  attachHandlers();
  if (state.status === 'blocked-by-waiter') mountSchemaFormInBlockedState();
  if (state.status === 'preparing') updateElapsedCounter();
}

function mountSchemaFormInBlockedState() {
  const host = document.querySelector('[data-coord-form-host]');
  if (!host || !state.waiter) return;
  const plannerQuestions = extractQuestionsFromMarkdown(state.proposalMarkdown, state.waiter);

  const form = createSchemaForm({
    schemaJson: state.waiter.schema_json,
    plannerQuestions: plannerQuestions,
    onSubmit: function (value) { actionSubmitAnswers(value); },
    onCancel: function () { actionCancelToIdle(); },
    onRespondDifferently: function (text) { actionRespondDifferently(text); },
  });
  host.appendChild(form);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function attachHandlers() {
  const host = getHost();
  if (!host) return;

  // Textarea (idle).
  const ta = host.querySelector('[data-coord="idea"]');
  if (ta) {
    ta.addEventListener('input', function () {
      state.idea = ta.value;
      const counter = host.querySelector('[data-coord="idea-count"]');
      if (counter) counter.textContent = String(ta.value.length);
      const btn = host.querySelector('[data-coord-action="prepare"]');
      if (btn) {
        const dis = ta.value.trim().length < MIN_IDEA_LEN;
        btn.disabled = dis;
      }
    });
  }

  // Botones data-coord-action.
  const buttons = host.querySelectorAll('[data-coord-action]');
  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      const a = btn.getAttribute('data-coord-action');
      switch (a) {
        case 'prepare': actionPrepare({}); break;
        case 'clear':
          state.idea = '';
          if (ta) ta.value = '';
          paint();
          break;
        case 'cancel': actionCancelToIdle(); break;
        case 'confirm': actionConfirm(); break;
        case 'edit-idea': actionEditIdea(); break;
        case 'retry': actionRetry(); break;
        default: break;
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Monta la tab Coordinate en #view. NO resetea el estado: si hay un prepare
 * en vuelo, vuelve a pintar el estado actual y re-arranca el polling.
 */
export function renderCoordinateTab() {
  // Re-arrancar polling si veniamos de un prepare en vuelo y la tab estuvo
  // desmontada (cambio de tab + vuelta).
  if (state.status === 'preparing' && state.flowId && state.pollIntervalId === null) {
    startPolling(state.flowId);
  }
  paint();
}
