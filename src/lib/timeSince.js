// src/lib/timeSince.js
// Helper que devuelve una representacion humanizada en castellano del
// tiempo transcurrido desde un timestamp dado (acepta ISO string o epoch
// ms/segundos). Cubre AC9 del flow visor-ui-polish.

/**
 * Normaliza un timestamp a epoch ms.
 * Acepta number (ms o s), string numerico o ISO. Devuelve NaN si falla.
 * @param {unknown} v
 * @returns {number}
 */
function toMs(v) {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'number') {
    if (!isFinite(v)) return NaN;
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
 * Devuelve el tiempo transcurrido en formato relativo castellano:
 *   < 5s    -> "hace un momento"
 *   < 60s   -> "hace X segundos"
 *   < 60min -> "hace 1 minuto" / "hace X minutos"
 *   < 24h   -> "hace 1 hora" / "hace X horas"
 *   < 30d   -> "hace 1 dia" / "hace X dias"
 *   >= 30d  -> fecha absoluta corta (es-AR)
 *
 * Si el timestamp no parsea, devuelve '-' para no romper render.
 *
 * @param {string|number|null|undefined} iso
 * @param {number} [nowMs]
 * @returns {string}
 */
export function timeSince(iso, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const t = toMs(iso);
  if (isNaN(t)) return '-';

  const dtSec = Math.max(0, Math.floor((now - t) / 1000));

  if (dtSec < 5) return 'hace un momento';
  if (dtSec < 60) return 'hace ' + dtSec + ' segundos';

  const dtMin = Math.floor(dtSec / 60);
  if (dtMin < 60) return dtMin === 1 ? 'hace 1 minuto' : 'hace ' + dtMin + ' minutos';

  const dtHr = Math.floor(dtMin / 60);
  if (dtHr < 24) return dtHr === 1 ? 'hace 1 hora' : 'hace ' + dtHr + ' horas';

  const dtDay = Math.floor(dtHr / 24);
  if (dtDay < 30) return dtDay === 1 ? 'hace 1 dia' : 'hace ' + dtDay + ' dias';

  try {
    return new Date(t).toLocaleDateString('es-AR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch (e) {
    return new Date(t).toISOString().slice(0, 10);
  }
}

/**
 * Devuelve el ISO normalizado de un timestamp para usar como atributo `title`.
 * Si no parsea, devuelve string vacio (no rompe el render).
 * @param {string|number|null|undefined} v
 * @returns {string}
 */
export function toIsoTitle(v) {
  const ms = toMs(v);
  if (isNaN(ms)) return '';
  try {
    return new Date(ms).toISOString();
  } catch (e) {
    return '';
  }
}
