// src/components/drawers/drawer.js
// Drawer lateral derecho compartido por Flows y Waiters.
// Maneja monturas/desmontes, overlay, tecla Escape y back-stack para
// vistas anidadas dentro del mismo drawer (ej: flow -> task conversation).
// Animaciones:
//   - Apertura: slide-in horizontal (transform translateX 100% -> 0)
//     usando var(--duration-base) y var(--easing-out).
//   - Cierre: animacion inversa con var(--easing-in); el nodo se remueve
//     al disparar transitionend (o tras un timeout de seguridad).
//   - Si el drawer ya esta abierto y se llama openDrawer(otherView), se
//     reutiliza el ctx sin reanimar el panel (solo se cambia el contenido).

const DRAWER_ROOT_ID = 'drawer-root';
const CLOSE_FALLBACK_MS = 400;

let activeDrawer = null;
let escHandlerBound = null;

function ensureRoot() {
  let root = document.getElementById(DRAWER_ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = DRAWER_ROOT_ID;
    document.body.appendChild(root);
  }
  return root;
}

function bindEsc() {
  if (escHandlerBound) return;
  escHandlerBound = function (e) {
    if (e.key === 'Escape' && activeDrawer) closeDrawer();
  };
  document.addEventListener('keydown', escHandlerBound);
}

function unbindEsc() {
  if (!escHandlerBound) return;
  document.removeEventListener('keydown', escHandlerBound);
  escHandlerBound = null;
}

/**
 * Abre un drawer mostrando el render() inicial.
 * Si ya hay un drawer abierto, no reanima: solo reemplaza el view actual
 * por el nuevo y dispara el render dentro del mismo ctx, conservando el
 * panel y la animacion previa.
 *
 * El render recibe un objeto ctx que permite:
 *   - ctx.setContent(html | (host)=>void) para refrescar contenido
 *   - ctx.push(view) para apilar una vista anidada
 *   - ctx.pop() para volver atras
 *   - ctx.close() para cerrar el drawer
 *
 * @param {{ render: (ctx: any) => void }} view
 */
export function openDrawer(view) {
  if (activeDrawer) {
    activeDrawer.replaceView(view);
    return;
  }

  const root = ensureRoot();

  const overlay = document.createElement('div');
  overlay.className = 'drawer-overlay';
  overlay.setAttribute('data-testid', 'drawer-overlay');
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeDrawer();
  });

  const panel = document.createElement('aside');
  panel.className = 'drawer-panel';
  panel.setAttribute('data-testid', 'drawer');

  const body = document.createElement('div');
  body.className = 'drawer-body';
  panel.appendChild(body);

  overlay.appendChild(panel);
  root.appendChild(overlay);

  const stack = [];
  let currentView = view;

  function setContent(content) {
    if (typeof content === 'string') {
      body.innerHTML = content;
    } else if (typeof content === 'function') {
      body.innerHTML = '';
      content(body);
    } else if (content instanceof Node) {
      body.innerHTML = '';
      body.appendChild(content);
    }
  }

  const ctx = {
    body,
    panel,
    setContent,
    push(nextView) {
      stack.push(currentView);
      currentView = nextView;
      currentView.render(ctx);
    },
    pop() {
      if (stack.length === 0) {
        closeDrawer();
        return;
      }
      currentView = stack.pop();
      currentView.render(ctx);
    },
    canPop() {
      return stack.length > 0;
    },
    close() {
      closeDrawer();
    },
  };

  function replaceView(nextView) {
    stack.length = 0;
    currentView = nextView;
    currentView.render(ctx);
  }

  activeDrawer = { overlay, panel, body, ctx, replaceView };
  bindEsc();

  // Pequeno tick para que el navegador registre el estado inicial (translateX
  // 100% + opacity 0) antes de pasar al estado abierto. Sin esto la
  // transicion no se reproduce.
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      if (activeDrawer && activeDrawer.overlay === overlay) {
        overlay.classList.add('open');
      }
    });
  });

  currentView.render(ctx);
}

/**
 * Cierra el drawer activo con animacion. El nodo se remueve cuando termina
 * la transicion del panel (o tras un fallback por timeout si transitionend
 * no dispara, ej. animaciones deshabilitadas).
 */
export function closeDrawer() {
  if (!activeDrawer) return;
  const { overlay, panel } = activeDrawer;
  activeDrawer = null;
  unbindEsc();

  overlay.classList.remove('open');

  let removed = false;
  function cleanup() {
    if (removed) return;
    removed = true;
    panel.removeEventListener('transitionend', onEnd);
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  }
  function onEnd(ev) {
    if (ev && ev.target !== panel) return;
    cleanup();
  }
  panel.addEventListener('transitionend', onEnd);
  setTimeout(cleanup, CLOSE_FALLBACK_MS);
}

/**
 * Reemplaza el contenido del drawer actual (sin push). Util para mostrar
 * estados de loading, error o data tras un fetch.
 * @param {string | ((host: HTMLElement) => void) | Node} content
 */
export function setDrawerContent(content) {
  if (!activeDrawer) return;
  activeDrawer.ctx.setContent(content);
}

/**
 * Indica si hay un drawer abierto.
 * @returns {boolean}
 */
export function isDrawerOpen() {
  return activeDrawer !== null;
}
