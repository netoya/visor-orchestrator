// src/settings.js
// Singleton de settings de UI. Por ahora solo expone pollMs (intervalo de
// refresh global), con clamp + persistencia en localStorage y mecanismo
// pub/sub para que los consumidores reaccionen en caliente. Cubre AC5.

export const POLL_MIN_MS = 1000;
export const POLL_MAX_MS = 60000;
export const POLL_DEFAULT_MS = 5000;
export const POLL_STORAGE_KEY = 'visor:ui:pollMs';

let _pollMs = POLL_DEFAULT_MS;
let _initialized = false;
const _listeners = new Set();

/**
 * Clampea un valor de pollMs al rango permitido. Si no es numero finito,
 * devuelve el default.
 * @param {unknown} ms
 * @returns {number}
 */
export function clampPollMs(ms) {
  const n = typeof ms === 'number' ? ms : Number(ms);
  if (!Number.isFinite(n)) return POLL_DEFAULT_MS;
  return Math.max(POLL_MIN_MS, Math.min(POLL_MAX_MS, Math.round(n)));
}

/**
 * Carga el setting persistido y devuelve el valor inicial.
 * @returns {number}
 */
export function initSettings() {
  if (_initialized) return _pollMs;
  _initialized = true;
  try {
    const raw = localStorage.getItem(POLL_STORAGE_KEY);
    if (raw != null) {
      _pollMs = clampPollMs(Number(raw));
    } else {
      _pollMs = POLL_DEFAULT_MS;
    }
  } catch (e) {
    _pollMs = POLL_DEFAULT_MS;
  }
  return _pollMs;
}

/**
 * Devuelve el pollMs actual en memoria.
 * @returns {number}
 */
export function getPollMs() {
  return _pollMs;
}

/**
 * Devuelve el pollMs actual en segundos (helper para el input UI).
 * @returns {number}
 */
export function getPollSeconds() {
  return Math.round(_pollMs / 1000);
}

/**
 * Actualiza el pollMs. Hace clamp, persiste y notifica a los suscriptores.
 * Si el valor no cambia, no se dispara la notificacion (idempotente).
 * @param {number} ms
 * @returns {number} valor efectivo (clampeado)
 */
export function setPollMs(ms) {
  const v = clampPollMs(ms);
  if (v === _pollMs) return v;
  _pollMs = v;
  try {
    localStorage.setItem(POLL_STORAGE_KEY, String(v));
  } catch (e) {
    /* localStorage no disponible: ignoramos */
  }
  _listeners.forEach(function (fn) {
    try { fn(v); } catch (e) { /* ignoramos errores del listener */ }
  });
  return v;
}

/**
 * Suscribe a cambios de pollMs. Devuelve una funcion para desuscribirse.
 * @param {(ms: number) => void} fn
 * @returns {() => void}
 */
export function onPollMsChange(fn) {
  _listeners.add(fn);
  return function () { _listeners.delete(fn); };
}
