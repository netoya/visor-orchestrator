// src/utils/format.js
// Helpers de formato compartidos por las tabs Flows/Sessions/Waiters.
// Sin dependencias externas.

/**
 * Convierte HTML reservado a entidades para insertar texto seguro en innerHTML.
 * @param {unknown} s
 * @returns {string}
 */
export function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Normaliza un timestamp a numero (epoch ms). Acepta number (ms o s), string
 * numerico o ISO. Devuelve NaN si no se puede interpretar.
 * @param {unknown} v
 * @returns {number}
 */
export function toEpochMs(v) {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'number') {
    if (!isFinite(v)) return NaN;
    // Heuristica: si es < 10^12 lo tratamos como segundos.
    return v < 1e12 ? v * 1000 : v;
  }
  if (typeof v === 'string') {
    if (/^\d+$/.test(v)) {
      const n = parseInt(v, 10);
      return n < 1e12 ? n * 1000 : n;
    }
    const t = Date.parse(v);
    return isNaN(t) ? NaN : t;
  }
  return NaN;
}

/**
 * Devuelve la edad humanizada de un timestamp respecto al instante actual.
 *   <60s   ->  "45s"
 *   <1h    ->  "3m 12s"
 *   <24h   ->  "1h 4m"
 *   >=24h  ->  "2d 3h"
 * Devuelve '-' si el timestamp no es interpretable.
 * @param {number|string|null|undefined} ts  epoch ms (o ISO).
 * @returns {string}
 */
export function formatAge(ts) {
  const ms = toEpochMs(ts);
  if (isNaN(ms)) return '-';
  let diff = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diff < 60) return diff + 's';
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    return m + 'm ' + s + 's';
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return h + 'h ' + m + 'm';
  }
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  return d + 'd ' + h + 'h';
}

/**
 * Devuelve una duracion humanizada a partir de ms.
 *   <1s    ->  "0s"
 *   <60s   ->  "45s"
 *   <1h    ->  "3m 12s"
 *   >=1h   ->  "1h 4m"
 * Devuelve '-' si ms no es interpretable.
 * @param {number|null|undefined} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  if (ms === null || ms === undefined || typeof ms !== 'number' || !isFinite(ms)) {
    return '-';
  }
  let secs = Math.max(0, Math.floor(ms / 1000));
  if (secs < 60) return secs + 's';
  if (secs < 3600) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m + 'm ' + s + 's';
  }
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h + 'h ' + m + 'm';
}

/**
 * Duracion calculada a partir de started_at / finished_at (ambos epoch ms).
 * Si no hay started_at devuelve '-'. Si no hay finished_at usa now().
 * @param {number|string|null|undefined} startedAt
 * @param {number|string|null|undefined} finishedAt
 * @returns {string}
 */
export function formatTaskDuration(startedAt, finishedAt) {
  const start = toEpochMs(startedAt);
  if (isNaN(start)) return '-';
  const end = finishedAt != null ? toEpochMs(finishedAt) : Date.now();
  const ref = isNaN(end) ? Date.now() : end;
  return formatDuration(ref - start);
}

/**
 * Devuelve la clase CSS asociada al status de un flow/task.
 *   running -> badge-blue
 *   done/completed -> badge-green
 *   failed -> badge-red
 *   pending/queued -> badge-gray
 *   otros -> badge-gray
 * @param {string|null|undefined} status
 * @returns {string}
 */
export function statusBadgeClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'running') return 'badge badge-blue';
  if (s === 'done' || s === 'completed') return 'badge badge-green';
  if (s === 'failed') return 'badge badge-red';
  if (s === 'pending' || s === 'queued' || s === 'ready') return 'badge badge-gray';
  if (s === 'waiting-waiter' || s === 'waiting') return 'badge badge-amber';
  if (s === 'fulfilled') return 'badge badge-green';
  if (s === 'rejected') return 'badge badge-red';
  if (s === 'timeout') return 'badge badge-amber';
  if (s === 'invalid') return 'badge badge-red';
  if (s === 'cancelled') return 'badge badge-gray';
  return 'badge badge-gray';
}

/**
 * Devuelve la clase CSS asociada al process_status de una session.
 *   alive -> badge-green
 *   zombie -> badge-amber
 *   finished -> badge-gray
 * @param {string|null|undefined} status
 * @returns {string}
 */
export function processStatusBadgeClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'alive') return 'badge badge-green';
  if (s === 'zombie') return 'badge badge-amber';
  if (s === 'finished') return 'badge badge-gray';
  return 'badge badge-gray-soft';
}

/**
 * Devuelve un ID truncado tipo "abc12345..." para mostrar en celdas estrechas.
 * Sigue conservando el id completo si mide menos que `max`.
 * @param {string|null|undefined} id
 * @param {number} max
 * @returns {string}
 */
export function truncateId(id, max) {
  if (id === null || id === undefined) return '-';
  const s = String(id);
  if (s.length <= max) return s;
  return s.slice(0, max) + '...';
}

/**
 * Devuelve un valor o '-' si es null/undefined/empty.
 * @param {unknown} v
 * @returns {string}
 */
export function orDash(v) {
  if (v === null || v === undefined || v === '') return '-';
  return String(v);
}

/**
 * Formatea un valor de segundos como "45s" o "2m 10s".
 * @param {number|null|undefined} secs
 * @returns {string}
 */
export function formatSeconds(secs) {
  if (secs === null || secs === undefined || typeof secs !== 'number' || !isFinite(secs)) {
    return '-';
  }
  const s = Math.max(0, Math.floor(secs));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return m + 'm ' + r + 's';
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return h + 'h ' + rm + 'm';
}
