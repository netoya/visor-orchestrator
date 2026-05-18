// src/components/drawers/task-conversation.js
// Vista anidada dentro del drawer de flow: muestra la conversacion completa
// (turnos) de una task. NO se monta como drawer independiente, se "pushea"
// dentro del drawer del flow via ctx.push(view).

import { fetchTaskConversation } from '../../api.js';
import { escapeHtml, toEpochMs } from '../../utils/format.js';
import { timeSince, toIsoTitle } from '../../lib/timeSince.js';

/**
 * Renderiza una pieza de contenido (string o array de bloques al estilo
 * Anthropic SDK). Devuelve un fragmento HTML escapado.
 * @param {unknown} content
 * @returns {string}
 */
function renderContent(content) {
  if (content === null || content === undefined) {
    return '<pre class="conv-content">(vacio)</pre>';
  }
  if (typeof content === 'string') {
    return '<pre class="conv-content">' + escapeHtml(content) + '</pre>';
  }
  if (Array.isArray(content)) {
    return content.map(renderBlock).join('');
  }
  return '<pre class="conv-content">' + escapeHtml(JSON.stringify(content, null, 2)) + '</pre>';
}

function renderBlock(block) {
  if (!block || typeof block !== 'object') {
    return '<pre class="conv-content">' + escapeHtml(String(block)) + '</pre>';
  }
  const type = block.type;
  if (type === 'text') {
    return '<pre class="conv-content">' + escapeHtml(block.text || '') + '</pre>';
  }
  if (type === 'tool_use') {
    const name = block.name || 'tool';
    const input = block.input != null ? JSON.stringify(block.input, null, 2) : '';
    return (
      '<div class="conv-block tool-use">' +
      '<div class="conv-block-head">tool_use: ' + escapeHtml(name) + '</div>' +
      '<pre class="conv-content">' + escapeHtml(input) + '</pre>' +
      '</div>'
    );
  }
  if (type === 'tool_result') {
    const tu = block.tool_use_id || '';
    const out = block.content;
    let body;
    if (typeof out === 'string') body = escapeHtml(out);
    else if (Array.isArray(out)) body = escapeHtml(out.map(function (b) {
      if (b && b.type === 'text') return b.text || '';
      return JSON.stringify(b);
    }).join('\n'));
    else body = escapeHtml(JSON.stringify(out, null, 2));
    return (
      '<div class="conv-block tool-result">' +
      '<div class="conv-block-head">tool_result' + (tu ? ' (' + escapeHtml(tu) + ')' : '') + '</div>' +
      '<pre class="conv-content">' + body + '</pre>' +
      '</div>'
    );
  }
  // fallback: dump as JSON
  return '<pre class="conv-content">' + escapeHtml(JSON.stringify(block, null, 2)) + '</pre>';
}

function renderTurn(msg) {
  const role = escapeHtml(msg.role || 'unknown');
  const ts = msg.timestamp != null ? timeSince(msg.timestamp) : null;
  const tsTitle = msg.timestamp != null ? toIsoTitle(msg.timestamp) : '';
  const tsHtml = ts ? '<span class="conv-ts" title="' + escapeHtml(tsTitle) + '">' + escapeHtml(ts) + '</span>' : '';
  return (
    '<article class="conv-turn">' +
    '<header class="conv-turn-head">' +
    '<span class="conv-role role-' + role + '">' + role + '</span>' +
    tsHtml +
    '</header>' +
    '<div class="conv-turn-body">' + renderContent(msg.content) + '</div>' +
    '</article>'
  );
}

function renderHeader(flowDetail, taskId) {
  const flowName = escapeHtml(flowDetail && flowDetail.name);
  const flowIdShort = escapeHtml(flowDetail && flowDetail.id);
  return (
    '<div class="drawer-header">' +
    '<div class="drawer-header-row">' +
    '<button type="button" class="btn-link drawer-back" data-action="back">Volver</button>' +
    '<button type="button" class="drawer-close" data-action="close" aria-label="Cerrar">X</button>' +
    '</div>' +
    '<div class="drawer-title">Conversacion de task</div>' +
    '<div class="drawer-sub mono">task: ' + escapeHtml(taskId) + '</div>' +
    '<div class="drawer-sub">flow: ' + flowName + ' <span class="mono muted">' + flowIdShort + '</span></div>' +
    '</div>'
  );
}

/**
 * Crea un view object para pasarse a ctx.push(view) dentro del drawer de
 * flow. Cachea la respuesta dentro del view para que el "Volver" no fuerce
 * un re-fetch al regresar.
 * @param {{ taskId: string, flowDetail: any }} args
 */
export function makeTaskConversationView(args) {
  const taskId = args.taskId;
  const flowDetail = args.flowDetail;

  let cachedMessages = null;
  let cachedError = null;

  function attachHandlers(host, ctx) {
    const back = host.querySelector('[data-action="back"]');
    const close = host.querySelector('[data-action="close"]');
    if (back) back.addEventListener('click', function () { ctx.pop(); });
    if (close) close.addEventListener('click', function () { ctx.close(); });
  }

  function paintLoading(ctx) {
    const html =
      renderHeader(flowDetail, taskId) +
      '<div class="drawer-content"><div class="loading"><div class="spinner" aria-hidden="true"></div><div>Cargando conversacion...</div></div></div>';
    ctx.setContent(html);
    attachHandlers(ctx.body, ctx);
  }

  function paintError(ctx, errText) {
    const html =
      renderHeader(flowDetail, taskId) +
      '<div class="drawer-content">' +
      '<div class="state-error">' +
      '<div class="state-error-title">Error al cargar la conversacion</div>' +
      '<div class="state-error-detail">' + escapeHtml(errText || '') + '</div>' +
      '<button type="button" class="btn btn-retry" data-action="retry">Reintentar</button>' +
      '</div></div>';
    ctx.setContent(html);
    const retry = ctx.body.querySelector('[data-action="retry"]');
    if (retry) retry.addEventListener('click', function () { load(ctx, true); });
    attachHandlers(ctx.body, ctx);
    if (errText && typeof console !== 'undefined') console.error('[conversation]', errText);
  }

  function paintEmpty(ctx) {
    const html =
      renderHeader(flowDetail, taskId) +
      '<div class="drawer-content"><div class="empty-state">No hay turnos en esta conversacion</div></div>';
    ctx.setContent(html);
    attachHandlers(ctx.body, ctx);
  }

  function paintData(ctx, messages) {
    if (!messages || messages.length === 0) {
      paintEmpty(ctx);
      return;
    }
    const turns = messages.map(renderTurn).join('');
    const html =
      renderHeader(flowDetail, taskId) +
      '<div class="drawer-content"><div class="conv-list">' + turns + '</div></div>';
    ctx.setContent(html);
    attachHandlers(ctx.body, ctx);
  }

  async function load(ctx, force) {
    if (cachedMessages && !force) {
      paintData(ctx, cachedMessages);
      return;
    }
    if (cachedError && !force) {
      paintError(ctx, cachedError);
      return;
    }
    paintLoading(ctx);
    const res = await fetchTaskConversation(taskId);
    if (res && res.error) {
      cachedError = res.error;
      paintError(ctx, res.error);
      return;
    }
    cachedError = null;
    cachedMessages = Array.isArray(res) ? res : [];
    // Orden cronologico por timestamp si esta disponible.
    cachedMessages = cachedMessages.slice().sort(function (a, b) {
      const ta = toEpochMs(a.timestamp);
      const tb = toEpochMs(b.timestamp);
      if (isNaN(ta) || isNaN(tb)) return 0;
      return ta - tb;
    });
    paintData(ctx, cachedMessages);
  }

  return {
    render(ctx) {
      load(ctx, false);
    },
  };
}
