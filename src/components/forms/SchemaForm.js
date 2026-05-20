// src/components/forms/SchemaForm.js
// Renderer dinamico reutilizable de formularios JSON Schema-like.
//
// Consumidores previstos:
//   - src/components/drawers/waiter-detail.js (resolver waiter pasivo)
//   - src/components/tabs/CoordinateTab.js   (form del waiter intermedio del planner)
//
// Spec: docs/specs/v1-write-operations.md, secciones 4.2 + 4.2.1.
//
// Mapeo de tipos:
//   - type=string + enum             -> <select>
//   - type=string sin enum           -> <input type=text>
//   - type=string + name reservado   -> <textarea>  (comments|reason|description|notes)
//   - type=boolean                   -> <input type=checkbox>
//   - type=number                    -> <input type=number>
//   - resto / desconocido            -> <input type=text> (best effort)
//
// Si schema_json es null/invalido/sin properties -> degradacion a textarea
// con value crudo como JSON, igual que documenta la spec §4.4.
//
// Modos:
//   - structured (default): muestra los inputs derivados del schema.
//   - respond-differently:  muestra preguntas readonly + textarea libre.
//     Activado via boton "Respond differently" (si onRespondDifferently se
//     pasa como prop) o "Back to questions" para volver.

import { escapeHtml } from '../../utils/format.js';

const TEXTAREA_FIELD_NAMES = new Set([
  'comments',
  'reason',
  'description',
  'notes',
]);

/**
 * Crea un SchemaForm como Node listo para appendChild.
 *
 * @param {Object} opts
 * @param {string|object|null|undefined} opts.schemaJson
 *   JSON Schema-like; acepta string (se parsea) u objeto ya parseado.
 * @param {(value: object) => void} opts.onSubmit
 *   Callback con el value structured (objeto JSON) tras validacion cliente.
 * @param {() => void} opts.onCancel
 *   Callback cuando el operador descarta el form.
 * @param {(text: string) => void} [opts.onRespondDifferently]
 *   Callback con el texto libre del modo "Respond differently".
 *   Si NO se pasa, el boton "Respond differently" no se renderiza.
 * @param {string[]} [opts.plannerQuestions]
 *   Preguntas (NL) que el planner generó. Se muestran como referencia
 *   read-only arriba del textarea cuando el operador activa
 *   "Respond differently". Si se omite, se deriva una lista desde el
 *   schema (nombre del field + enums).
 * @returns {HTMLElement}
 */
export function createSchemaForm(opts) {
  const {
    schemaJson,
    onSubmit,
    onCancel,
    onRespondDifferently,
    plannerQuestions,
  } = opts || {};

  if (typeof onSubmit !== 'function') {
    throw new Error('SchemaForm: onSubmit is required');
  }

  const root = document.createElement('div');
  root.className = 'schema-form';
  root.setAttribute('data-testid', 'schema-form');

  const schemaInfo = parseSchema(schemaJson);
  const decisionInfo = schemaInfo.ok
    ? detectDecisionField(schemaInfo.parsed)
    : null;

  // Estado interno minimo.
  const state = {
    mode: 'structured', // 'structured' | 'respond-differently'
    fields: [],
  };

  function render() {
    root.innerHTML = '';
    if (state.mode === 'respond-differently') {
      renderRespondDifferently();
    } else if (!schemaInfo.ok) {
      renderDegradedJson();
    } else {
      renderStructured();
    }
  }

  // -------------------------------------------------------------------------
  // Modo structured
  // -------------------------------------------------------------------------

  function renderStructured() {
    state.fields = [];

    const parsed = schemaInfo.parsed;
    const required = Array.isArray(parsed.required) ? parsed.required : [];

    const fieldsHost = document.createElement('div');
    fieldsHost.className = 'schema-form-fields';

    Object.keys(parsed.properties).forEach((name) => {
      const prop = parsed.properties[name];
      const isRequired = required.includes(name);
      const field = createField(name, prop, isRequired);
      state.fields.push(field);
      fieldsHost.appendChild(field.el);
    });

    root.appendChild(fieldsHost);

    const banner = makeBanner();
    root.appendChild(banner);

    root.appendChild(buildStructuredActions(banner));
  }

  function buildStructuredActions(banner) {
    const actions = document.createElement('div');
    actions.className = 'schema-form-actions';

    // Approve / Reject condicionales (§9.6 + §4.2.1).
    if (decisionInfo && decisionInfo.supportsApproved) {
      actions.appendChild(
        makeButton('Approve', 'btn btn-primary', function () {
          const f = findField(state.fields, decisionInfo.field);
          if (f) f.setValue('approved');
          doSubmit(banner);
        }),
      );
    }
    if (decisionInfo && decisionInfo.supportsRejected) {
      const hasReason =
        !!findField(state.fields, 'reason') ||
        !!findField(state.fields, 'comments');
      const label = hasReason ? 'Reject with reason' : 'Reject';
      actions.appendChild(
        makeButton(label, 'btn btn-danger', function () {
          const f = findField(state.fields, decisionInfo.field);
          if (f) f.setValue('rejected');
          // Forzar reason/comments como required para esta submission.
          const reasonField =
            findField(state.fields, 'reason') ||
            findField(state.fields, 'comments');
          if (reasonField) {
            reasonField.forceRequired();
            // Si esta vacio, focus + banner explicito antes de validar todo.
            const v = reasonField.getValue();
            if (v === '' || v === null || v === undefined) {
              showBanner(
                banner,
                'Indica el motivo del rechazo (' + reasonField.name + ').',
              );
              reasonField.markError(true);
              reasonField.focus();
              return;
            }
          }
          doSubmit(banner);
        }),
      );
    }

    // Submit answers (siempre).
    actions.appendChild(
      makeButton('Submit answers', 'btn btn-primary', function () {
        doSubmit(banner);
      }),
    );

    // Respond differently (si hay callback).
    if (typeof onRespondDifferently === 'function') {
      actions.appendChild(
        makeButton('Respond differently', 'btn', function () {
          state.mode = 'respond-differently';
          render();
        }),
      );
    }

    actions.appendChild(
      makeButton('Cancel', 'btn', function () {
        if (typeof onCancel === 'function') onCancel();
      }),
    );

    return actions;
  }

  function doSubmit(banner) {
    const value = {};
    const errors = [];

    state.fields.forEach(function (f) {
      const v = f.getValue();
      const empty = v === '' || v === null || v === undefined;
      if (f.isEffectivelyRequired() && empty) {
        errors.push('"' + f.name + '" es requerido');
        f.markError(true);
        return;
      }
      f.markError(false);
      // Booleans se incluyen siempre (false es un valor valido). El resto
      // se omite si esta vacio para no poluir el payload.
      if (f.type === 'boolean' || !empty) {
        value[f.name] = v;
      }
    });

    if (errors.length > 0) {
      showBanner(banner, errors.join(' · '));
      return;
    }
    hideBanner(banner);
    onSubmit(value);
  }

  // -------------------------------------------------------------------------
  // Modo degradado (schema invalido / sin properties)
  // -------------------------------------------------------------------------

  function renderDegradedJson() {
    const help = document.createElement('div');
    help.className = 'schema-form-help muted';
    help.textContent =
      schemaInfo.reason === 'unparseable'
        ? 'Schema no parseable. Escribe el value como JSON.'
        : schemaInfo.reason === 'no-properties'
        ? 'Schema sin properties declaradas. Escribe el value como JSON.'
        : 'Sin schema declarado. Escribe el value como JSON.';
    root.appendChild(help);

    const ta = document.createElement('textarea');
    ta.className = 'schema-form-textarea schema-form-raw-textarea mono';
    ta.rows = 10;
    ta.spellcheck = false;
    ta.placeholder = '{\n  "key": "value"\n}';
    root.appendChild(ta);

    const banner = makeBanner();
    root.appendChild(banner);

    const actions = document.createElement('div');
    actions.className = 'schema-form-actions';

    actions.appendChild(
      makeButton('Submit answers', 'btn btn-primary', function () {
        const raw = ta.value.trim();
        if (!raw) {
          showBanner(banner, 'El value es requerido.');
          return;
        }
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          showBanner(banner, 'JSON invalido: ' + (e && e.message ? e.message : e));
          return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          showBanner(banner, 'El value debe ser un objeto JSON (no array, no primitivo).');
          return;
        }
        hideBanner(banner);
        onSubmit(parsed);
      }),
    );

    if (typeof onRespondDifferently === 'function') {
      actions.appendChild(
        makeButton('Respond differently', 'btn', function () {
          state.mode = 'respond-differently';
          render();
        }),
      );
    }

    actions.appendChild(
      makeButton('Cancel', 'btn', function () {
        if (typeof onCancel === 'function') onCancel();
      }),
    );

    root.appendChild(actions);

    setTimeout(function () { ta.focus(); }, 0);
  }

  // -------------------------------------------------------------------------
  // Modo respond-differently
  // -------------------------------------------------------------------------

  function renderRespondDifferently() {
    // Bloque colapsable de referencia con las preguntas del planner.
    const ref = document.createElement('details');
    ref.className = 'schema-form-respond-reference';
    ref.open = true;

    const sum = document.createElement('summary');
    sum.className = 'schema-form-respond-reference-title';
    sum.textContent = 'The planner asked (for reference)';
    ref.appendChild(sum);

    const list = document.createElement('ol');
    list.className = 'schema-form-respond-reference-list';

    const qs = Array.isArray(plannerQuestions) ? plannerQuestions : [];
    if (qs.length > 0) {
      qs.forEach(function (q) {
        const li = document.createElement('li');
        li.textContent = String(q);
        list.appendChild(li);
      });
    } else {
      // Fallback: derivar preguntas desde el schema (nombre + enums).
      const fallback = deriveQuestionsFromSchema(schemaInfo.parsed);
      if (fallback.length === 0) {
        const li = document.createElement('li');
        li.className = 'muted';
        li.textContent = '(sin preguntas declaradas)';
        list.appendChild(li);
      } else {
        fallback.forEach(function (html) {
          const li = document.createElement('li');
          li.innerHTML = html;
          list.appendChild(li);
        });
      }
    }
    ref.appendChild(list);
    root.appendChild(ref);

    const help = document.createElement('div');
    help.className = 'schema-form-help muted';
    help.textContent =
      'None of these captures what you want? Describe what you actually want — this overrides the original idea.';
    root.appendChild(help);

    const ta = document.createElement('textarea');
    ta.className = 'schema-form-textarea schema-form-respond-textarea mono';
    ta.rows = 8;
    ta.spellcheck = true;
    ta.placeholder =
      'Describe what you actually want — this overrides the original idea.';
    root.appendChild(ta);

    const banner = makeBanner();
    root.appendChild(banner);

    const actions = document.createElement('div');
    actions.className = 'schema-form-actions';

    actions.appendChild(
      makeButton('Send custom response', 'btn btn-primary', function () {
        const txt = ta.value.trim();
        if (txt.length < 5) {
          showBanner(banner, 'Escribe una respuesta (min 5 caracteres).');
          return;
        }
        hideBanner(banner);
        if (typeof onRespondDifferently === 'function') {
          onRespondDifferently(txt);
        }
      }),
    );

    actions.appendChild(
      makeButton('Back to questions', 'btn', function () {
        state.mode = 'structured';
        render();
      }),
    );

    actions.appendChild(
      makeButton('Cancel', 'btn', function () {
        if (typeof onCancel === 'function') onCancel();
      }),
    );

    root.appendChild(actions);

    setTimeout(function () { ta.focus(); }, 0);
  }

  // -------------------------------------------------------------------------
  // Field factory
  // -------------------------------------------------------------------------

  /**
   * @param {string} name
   * @param {object} prop
   * @param {boolean} isRequired
   * @returns {{
   *   name: string,
   *   type: string,
   *   el: HTMLElement,
   *   getValue: () => unknown,
   *   setValue: (v: unknown) => void,
   *   focus: () => void,
   *   markError: (on: boolean) => void,
   *   forceRequired: () => void,
   *   isEffectivelyRequired: () => boolean,
   * }}
   */
  function createField(name, prop, isRequired) {
    const type = prop && typeof prop.type === 'string' ? prop.type : 'string';
    const wrap = document.createElement('div');
    wrap.className = 'schema-form-field schema-form-field-' + type;
    wrap.dataset.fieldName = name;
    wrap.dataset.fieldType = type;

    const label = document.createElement('label');
    label.className = 'schema-form-label';
    label.setAttribute('for', 'sf-' + name);
    label.innerHTML =
      escapeHtml(name) +
      (isRequired
        ? ' <span class="schema-form-required" aria-hidden="true">*</span>'
        : '');
    wrap.appendChild(label);

    if (prop && typeof prop.description === 'string' && prop.description) {
      const desc = document.createElement('div');
      desc.className = 'schema-form-help muted';
      desc.textContent = prop.description;
      wrap.appendChild(desc);
    }

    let inputEl;
    let getValue;
    let setValue;
    let focus;

    if (type === 'string' && Array.isArray(prop.enum)) {
      const select = document.createElement('select');
      select.id = 'sf-' + name;
      select.className = 'schema-form-select';

      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '— select —';
      placeholder.disabled = isRequired;
      placeholder.selected = true;
      select.appendChild(placeholder);

      prop.enum.forEach(function (v) {
        const opt = document.createElement('option');
        opt.value = String(v);
        opt.textContent = String(v);
        select.appendChild(opt);
      });

      inputEl = select;
      getValue = function () { return select.value; };
      setValue = function (v) { select.value = String(v); };
      focus = function () { select.focus(); };
    } else if (type === 'string') {
      const useTextarea = TEXTAREA_FIELD_NAMES.has(name);
      if (useTextarea) {
        const ta = document.createElement('textarea');
        ta.id = 'sf-' + name;
        ta.className = 'schema-form-textarea';
        ta.rows = 4;
        ta.spellcheck = true;
        inputEl = ta;
        getValue = function () { return ta.value.trim(); };
        setValue = function (v) { ta.value = String(v); };
        focus = function () { ta.focus(); };
      } else {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.id = 'sf-' + name;
        inp.className = 'schema-form-input';
        inputEl = inp;
        getValue = function () { return inp.value.trim(); };
        setValue = function (v) { inp.value = String(v); };
        focus = function () { inp.focus(); };
      }
    } else if (type === 'boolean') {
      const inp = document.createElement('input');
      inp.type = 'checkbox';
      inp.id = 'sf-' + name;
      inp.className = 'schema-form-toggle';
      inputEl = inp;
      getValue = function () { return Boolean(inp.checked); };
      setValue = function (v) { inp.checked = Boolean(v); };
      focus = function () { inp.focus(); };
    } else if (type === 'number' || type === 'integer') {
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.id = 'sf-' + name;
      inp.className = 'schema-form-input';
      if (type === 'integer') inp.step = '1';
      if (prop.minimum !== undefined && prop.minimum !== null) {
        inp.min = String(prop.minimum);
      }
      if (prop.maximum !== undefined && prop.maximum !== null) {
        inp.max = String(prop.maximum);
      }
      inputEl = inp;
      getValue = function () {
        const raw = inp.value.trim();
        if (raw === '') return '';
        const n = Number(raw);
        return Number.isFinite(n) ? n : '';
      };
      setValue = function (v) { inp.value = String(v); };
      focus = function () { inp.focus(); };
    } else {
      // Tipo no soportado: degradar a text input.
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.id = 'sf-' + name;
      inp.className = 'schema-form-input';
      inputEl = inp;
      getValue = function () { return inp.value.trim(); };
      setValue = function (v) { inp.value = String(v); };
      focus = function () { inp.focus(); };
    }

    wrap.appendChild(inputEl);

    let forcedRequired = false;

    function markError(on) {
      wrap.classList.toggle('schema-form-field-error', !!on);
    }

    function forceRequired() {
      if (forcedRequired) return;
      forcedRequired = true;
      if (!isRequired && !label.querySelector('.schema-form-required')) {
        const mark = document.createElement('span');
        mark.className = 'schema-form-required';
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = ' *';
        label.appendChild(mark);
      }
    }

    function isEffectivelyRequired() {
      // Booleans no se validan como "required": false es un valor valido.
      if (type === 'boolean') return false;
      return isRequired || forcedRequired;
    }

    return {
      name: name,
      type: type,
      el: wrap,
      getValue: getValue,
      setValue: setValue,
      focus: focus,
      markError: markError,
      forceRequired: forceRequired,
      isEffectivelyRequired: isEffectivelyRequired,
    };
  }

  // Render inicial.
  render();
  return root;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function findField(fields, name) {
  for (let i = 0; i < fields.length; i++) {
    if (fields[i].name === name) return fields[i];
  }
  return null;
}

function makeButton(text, className, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function makeBanner() {
  const banner = document.createElement('div');
  banner.className = 'schema-form-banner';
  banner.setAttribute('role', 'alert');
  banner.style.display = 'none';
  return banner;
}

function showBanner(banner, msg) {
  banner.textContent = msg;
  banner.style.display = 'block';
}

function hideBanner(banner) {
  banner.textContent = '';
  banner.style.display = 'none';
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, parsed: object } | { ok: false, parsed: object|null, reason: string }}
 */
function parseSchema(raw) {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: false, parsed: null, reason: 'no-schema' };
  }
  let p = raw;
  if (typeof raw === 'string') {
    try {
      p = JSON.parse(raw);
    } catch (e) {
      return { ok: false, parsed: null, reason: 'unparseable' };
    }
  }
  if (!p || typeof p !== 'object' || Array.isArray(p)) {
    return { ok: false, parsed: null, reason: 'not-object' };
  }
  const props =
    p.properties && typeof p.properties === 'object' && !Array.isArray(p.properties)
      ? p.properties
      : null;
  if (!props || Object.keys(props).length === 0) {
    return { ok: false, parsed: p, reason: 'no-properties' };
  }
  return { ok: true, parsed: p };
}

/**
 * Detecta el patron approve/reject §9.6: una prop "decision" o "action"
 * de tipo string con enum incluyendo "approved" y/o ("rejected"|"decline").
 */
function detectDecisionField(parsed) {
  if (!parsed || !parsed.properties) return null;
  const candidates = ['decision', 'action'];
  for (let i = 0; i < candidates.length; i++) {
    const key = candidates[i];
    const prop = parsed.properties[key];
    if (
      prop &&
      prop.type === 'string' &&
      Array.isArray(prop.enum) &&
      prop.enum.length > 0
    ) {
      const enums = prop.enum.map(String);
      const supportsApproved = enums.indexOf('approved') !== -1;
      const supportsRejected =
        enums.indexOf('rejected') !== -1 || enums.indexOf('decline') !== -1;
      if (supportsApproved || supportsRejected) {
        return {
          field: key,
          supportsApproved: supportsApproved,
          supportsRejected: supportsRejected,
        };
      }
    }
  }
  return null;
}

/**
 * Si plannerQuestions no se pasa, generamos una lista best-effort desde el
 * schema: "<field> — opt1 / opt2" para enums; solo "<field>" si no hay enum.
 */
function deriveQuestionsFromSchema(parsed) {
  if (!parsed || !parsed.properties) return [];
  const out = [];
  Object.keys(parsed.properties).forEach(function (name) {
    const prop = parsed.properties[name];
    const head = '<strong>' + escapeHtml(name) + '</strong>';
    if (prop && Array.isArray(prop.enum) && prop.enum.length > 0) {
      const opts = prop.enum
        .map(function (v) { return escapeHtml(String(v)); })
        .join(' / ');
      out.push(head + ' <span class="muted">— ' + opts + '</span>');
    } else {
      out.push(head);
    }
  });
  return out;
}
