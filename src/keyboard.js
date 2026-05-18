// src/keyboard.js
// Listener global de atajos de teclado. Cubre AC8.
//   1/2/3/4 -> cambia a la tab correspondiente (flows/sessions/waiters/stats)
//   '/'     -> mueve el foco al input [data-search-input] de la tab activa
//   Escape  -> blur del input activo (devuelve foco al body)
// Los atajos numericos y '/' se ignoran si el foco esta dentro de un campo
// editable. Solo Escape se procesa dentro de inputs.

const TAB_HASH = {
  '1': '#flows',
  '2': '#sessions',
  '3': '#waiters',
  '4': '#stats',
};

function isEditable(el) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el.isContentEditable === true;
}

function focusActiveSearch() {
  const el = document.querySelector('[data-search-input]');
  if (el instanceof HTMLElement) {
    el.focus();
    if (typeof el.select === 'function') {
      try { el.select(); } catch (e) { /* algunos input types no soportan select */ }
    }
  }
}

function switchHash(hash) {
  if (location.hash !== hash) location.hash = hash;
}

/**
 * Registra el listener global. Idempotente: solo se monta una vez.
 */
let _bound = false;
export function initKeyboard() {
  if (_bound) return;
  _bound = true;

  document.addEventListener('keydown', function (ev) {
    if (ev.defaultPrevented) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

    const target = ev.target;

    if (ev.key === 'Escape') {
      if (isEditable(target)) {
        target.blur();
      }
      return;
    }

    if (isEditable(target)) return;

    if (ev.key === '/') {
      ev.preventDefault();
      focusActiveSearch();
      return;
    }

    const hash = TAB_HASH[ev.key];
    if (hash) {
      ev.preventDefault();
      switchHash(hash);
    }
  });
}
