// src/components/drawers/flow-detail.js
// Drawer lateral del detalle de un flow. Muestra header con metadata del
// flow + lista de tasks (ordenadas por created_at ASC, mas antigua arriba,
// secuencia cronologica natural). Click en task pushea la vista de
// conversation dentro del mismo drawer (back-stack).

import { fetchFlowDetail } from '../../api.js';
import { openDrawer } from './drawer.js';
import { makeTaskConversationView } from './task-conversation.js';
import {
  escapeHtml,
  formatTaskDuration,
  statusBadgeClass,
  orDash,
  toEpochMs,
} from '../../utils/format.js';
import { timeSince, toIsoTitle } from '../../lib/timeSince.js';

function renderHeader(flow) {
  const status = flow.status || 'unknown';
  const created = timeSince(flow.created_at);
  const createdTitle = toIsoTitle(flow.created_at);
  return (
    '<div class="drawer-header">' +
    '<div class="drawer-header-row">' +
    '<div class="drawer-title">Detalle de flow</div>' +
    '<button type="button" class="drawer-close" data-action="close" aria-label="Cerrar">X</button>' +
    '</div>' +
    '<div class="drawer-sub mono">' + escapeHtml(flow.id || '') + '</div>' +
    '<div class="drawer-sub">' + escapeHtml(flow.name || '(sin nombre)') + '</div>' +
    '<div class="drawer-meta">' +
    '<span class="' + statusBadgeClass(status) + '">' + escapeHtml(status) + '</span>' +
    '<span class="meta-pill" title="' + escapeHtml(createdTitle) + '">' + escapeHtml(created) + '</span>' +
    '<span class="meta-pill">prioridad ' + escapeHtml(orDash(flow.priority)) + '</span>' +
    '<span class="meta-pill">autonomy ' + escapeHtml(orDash(flow.autonomy)) + '</span>' +
    '</div>' +
    '</div>'
  );
}

function renderHeaderSkeleton(flowId) {
  return (
    '<div class="drawer-header">' +
    '<div class="drawer-header-row">' +
    '<div class="drawer-title">Detalle de flow</div>' +
    '<button type="button" class="drawer-close" data-action="close" aria-label="Cerrar">X</button>' +
    '</div>' +
    '<div class="drawer-sub mono">' + escapeHtml(flowId) + '</div>' +
    '</div>'
  );
}

function sortTasksAsc(tasks) {
  return tasks.slice().sort(function (a, b) {
    const ta = toEpochMs(a && a.created_at);
    const tb = toEpochMs(b && b.created_at);
    if (isNaN(ta) && isNaN(tb)) return 0;
    if (isNaN(ta)) return 1;
    if (isNaN(tb)) return -1;
    if (ta !== tb) return ta - tb;
    // Tiebreaker estable por id
    const ia = a && a.id ? String(a.id) : '';
    const ib = b && b.id ? String(b.id) : '';
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
}

function renderTasksList(tasks) {
  if (!tasks || tasks.length === 0) {
    return '<div class="empty-state">No hay tasks en este flow</div>';
  }
  const sorted = sortTasksAsc(tasks);
  const rows = sorted.map(function (t) {
    const duration = formatTaskDuration(t.started_at, t.finished_at);
    const created = timeSince(t.created_at);
    const createdTitle = toIsoTitle(t.created_at);
    return (
      '<li class="task-row" data-task-id="' + escapeHtml(t.id) + '" tabindex="0">' +
      '<div class="task-row-main">' +
      '<span class="' + statusBadgeClass(t.status) + '">' + escapeHtml(t.status || 'unknown') + '</span>' +
      '<span class="task-stage">' + escapeHtml(t.stage || '-') + '</span>' +
      '<span class="task-agent mono">' + escapeHtml(t.agent_id || '-') + '</span>' +
      '</div>' +
      '<div class="task-row-aux">' +
      '<span class="muted">creado</span> <span class="mono" title="' + escapeHtml(createdTitle) + '">' + escapeHtml(created) + '</span>' +
      ' <span class="muted">duracion</span> <span class="mono">' + escapeHtml(duration) + '</span>' +
      '</div>' +
      '</li>'
    );
  }).join('');
  return (
    '<div class="drawer-section-title">Tasks (' + sorted.length + ')</div>' +
    '<ul class="task-list">' + rows + '</ul>'
  );
}

function attachCloseHandler(host, ctx) {
  const close = host.querySelector('[data-action="close"]');
  if (close) close.addEventListener('click', function () { ctx.close(); });
}

function attachTaskClickHandlers(host, ctx, flowDetail) {
  const rows = host.querySelectorAll('.task-row');
  rows.forEach(function (row) {
    const handler = function () {
      const taskId = row.getAttribute('data-task-id');
      if (!taskId) return;
      const view = makeTaskConversationView({ taskId, flowDetail });
      ctx.push(view);
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

function makeFlowDetailView(flowId) {
  let cachedFlow = null;
  let cachedError = null;

  function paintLoading(ctx) {
    ctx.setContent(renderHeaderSkeleton(flowId) +
      '<div class="drawer-content"><div class="loading"><div class="spinner" aria-hidden="true"></div><div>Cargando detalle del flow...</div></div></div>');
    attachCloseHandler(ctx.body, ctx);
  }

  function paintError(ctx, errText) {
    ctx.setContent(renderHeaderSkeleton(flowId) +
      '<div class="drawer-content">' +
      '<div class="state-error">' +
      '<div class="state-error-title">Error al cargar el detalle del flow</div>' +
      '<div class="state-error-detail">' + escapeHtml(errText || '') + '</div>' +
      '<button type="button" class="btn btn-retry" data-action="retry">Reintentar</button>' +
      '</div></div>');
    const retry = ctx.body.querySelector('[data-action="retry"]');
    if (retry) retry.addEventListener('click', function () { load(ctx, true); });
    attachCloseHandler(ctx.body, ctx);
    if (errText && typeof console !== 'undefined') console.error('[flow-detail]', errText);
  }

  function paintData(ctx, flow) {
    const html = renderHeader(flow) +
      '<div class="drawer-content">' + renderTasksList(flow.tasks || []) + '</div>';
    ctx.setContent(html);
    attachCloseHandler(ctx.body, ctx);
    attachTaskClickHandlers(ctx.body, ctx, flow);
  }

  async function load(ctx, force) {
    if (cachedFlow && !force) {
      paintData(ctx, cachedFlow);
      return;
    }
    paintLoading(ctx);
    const res = await fetchFlowDetail(flowId);
    if (res && res.error) {
      cachedError = res.error;
      paintError(ctx, res.error);
      return;
    }
    cachedError = null;
    cachedFlow = res;
    paintData(ctx, cachedFlow);
  }

  return {
    render(ctx) {
      load(ctx, false);
    },
  };
}

/**
 * Punto de entrada publico: abre el drawer del flow indicado.
 * Si ya hay un drawer abierto (otro flow o el mismo), el contenido se
 * reemplaza sin reanimar el panel (ver drawer.js).
 * @param {string} flowId
 */
export function openFlowDetailDrawer(flowId) {
  openDrawer(makeFlowDetailView(flowId));
}
