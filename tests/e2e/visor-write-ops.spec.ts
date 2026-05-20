// tests/e2e/visor-write-ops.spec.ts
// E2E tests del flujo write operations del visor (spec
// docs/specs/v1-write-operations.md §7). Cubre:
//
//   Test 1 — Prepare -> Confirm (caso A, sin ambigüedad).
//   Test 2 — Prepare con ambigüedad -> waiter -> fulfill -> re-prepare -> confirm.
//   Test 3 — Respond differently genera un flowId nuevo distinto del anterior.
//   Test 4 — Fulfill waiter pasivo desde el drawer de la tab Waiters.
//
// Smoke (siempre):
//   Render tab Coordinate sin error y muestra textarea + boton Prepare.
//
// Gating: tests 1-4 gastan tokens reales (spawn del planner Roman o CLI del
// orchestrator). Por defecto se SKIP. Para correrlos:
//
//   PLAYWRIGHT_REAL_PLANNER=1 npx playwright test visor-write-ops
//
// Requisitos para PLAYWRIGHT_REAL_PLANNER=1:
//   - Backend visor + frontend vite arrancados (lo hace playwright.config.ts).
//   - Dispatcher del autonomous-orchestrator corriendo con AGENT_RUNNER=claude.
//   - ORCHESTRATOR_DIR apuntando a la raiz del autonomous-orchestrator.
//
// Selectores estables usados:
//   - tab Coordinate          -> [data-testid=tab-coordinate]
//   - textarea de idea        -> textarea[data-coord="idea"]
//   - boton Prepare           -> button[data-coord-action="prepare"]
//   - boton Confirm           -> button[data-coord-action="confirm"]
//   - SchemaForm (mountado)   -> [data-testid="schema-form"]
//   - flow del prepare actual -> data-coord-elapsed para preparing,
//                                .coord-md para proposal-ready,
//                                .coord-blocked + .coord-questions para waiter.

import { test, expect, type Page } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REAL_PLANNER = process.env.PLAYWRIGHT_REAL_PLANNER === '1';

const ORCHESTRATOR_DIR =
  process.env.ORCHESTRATOR_DIR ||
  '/Users/macbookpro/project/autonomous-orchestrator';

// Tiempos: el planner real tarda 30s-90s, asi que aumentamos el timeout de
// los tests gated por REAL_PLANNER de forma local (override del timeout
// global de 30s definido en playwright.config.ts).
const REAL_PLANNER_TEST_TIMEOUT_MS = 5 * 60_000;
const PREPARE_STATE_POLL_TIMEOUT_MS = 120_000;
const CONFIRM_TIMEOUT_MS = 60_000;

// Selectores estables.
const SEL = {
  tabCoordinate: '[data-testid="tab-coordinate"]',
  tabWaiters: '[data-testid="tab-waiters"]',
  tabFlows: '[data-testid="tab-flows"]',
  textareaIdea: 'textarea[data-coord="idea"]',
  btnPrepare: 'button[data-coord-action="prepare"]',
  btnConfirm: 'button[data-coord-action="confirm"]',
  btnEditIdea: 'button[data-coord-action="edit-idea"]',
  btnCancel: 'button[data-coord-action="cancel"]',
  cardIdle: '.coord-idle',
  cardPreparing: '.coord-preparing',
  cardProposal: '.coord-proposal',
  cardBlocked: '.coord-blocked',
  cardConfirming: '.coord-confirming',
  cardExecuting: '.coord-executing',
  cardError: '.coord-error',
  mdBlock: '.coord-md',
  schemaForm: '[data-testid="schema-form"]',
  drawer: '[data-testid="drawer"]',
  waiterRow: '.waiter-row',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function gotoCoordinateTab(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('health-header')).toBeVisible();
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.locator(SEL.tabCoordinate).click();
  await expect(page.locator(SEL.tabCoordinate)).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

async function pasteIdea(page: Page, idea: string) {
  const ta = page.locator(SEL.textareaIdea);
  await ta.waitFor({ state: 'visible' });
  await ta.fill(idea);
  await expect(page.locator(SEL.btnPrepare)).toBeEnabled();
}

async function clickPrepare(page: Page) {
  await page.locator(SEL.btnPrepare).click();
  await expect(page.locator(SEL.cardPreparing)).toBeVisible();
}

/**
 * Espera a que el polling de prepare-state transicione a uno de los estados
 * terminales del flujo. Devuelve cual fue.
 */
async function waitForPrepareTransition(
  page: Page,
  timeoutMs = PREPARE_STATE_POLL_TIMEOUT_MS,
): Promise<'proposal-ready' | 'blocked-by-waiter' | 'error'> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.locator(SEL.cardProposal).count() > 0) return 'proposal-ready';
    if (await page.locator(SEL.cardBlocked).count() > 0) return 'blocked-by-waiter';
    if (await page.locator(SEL.cardError).count() > 0) return 'error';
    await page.waitForTimeout(1000);
  }
  throw new Error(
    `Timeout (${timeoutMs}ms) esperando transicion desde preparing. ` +
      `URL=${page.url()}`,
  );
}

/**
 * Lee el flowId mas reciente desde localStorage. CoordinateTab persiste cada
 * prepare en `visor.coordinate.recent` (array, mas reciente al inicio), asi
 * que esta es la fuente fiable independientemente del estado renderizado.
 */
async function readLatestFlowIdFromStorage(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    try {
      const raw = localStorage.getItem('visor.coordinate.recent');
      const arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr) || arr.length === 0) return null;
      return arr[0]?.flowId ?? null;
    } catch {
      return null;
    }
  });
}

/**
 * Verifica el spawn del CLI del orchestrator. Si no esta disponible,
 * devolvemos false para que el test que lo necesita haga skip dinamico.
 */
function orchestratorCliAvailable(): boolean {
  if (!existsSync(ORCHESTRATOR_DIR)) return false;
  const bin = resolve(ORCHESTRATOR_DIR, 'bin/orchestrator.mjs');
  if (!existsSync(bin)) return false;
  try {
    const res = spawnSync('node', [bin], {
      cwd: ORCHESTRATOR_DIR,
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return res.status === 1 || res.status === 0;
  } catch {
    return false;
  }
}

/**
 * Crea via CLI un flow que produce un waiter pasivo. Lanza `coordinate` con
 * una idea intencionalmente ambigua para que el planner deje un waiter
 * `clarification` en estado `waiting`. Devuelve el flowId resultante.
 *
 * Esto es lo que usa Test 4 en beforeAll cuando REAL_PLANNER=1.
 */
function spawnCoordinatePlannerForTestWaiter(idea: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'npx',
      ['orchestrator', 'coordinate', idea],
      {
        cwd: ORCHESTRATOR_DIR,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000,
      },
    );
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => (stdout += c.toString()));
    proc.stderr.on('data', (c) => (stderr += c.toString()));
    proc.on('error', (e) => reject(new Error(`spawn-error: ${e.message}`)));
    proc.on('close', (exit) => {
      if (exit !== 0) {
        return reject(
          new Error(`coordinate exit=${exit}: ${stderr || stdout}`),
        );
      }
      const m = stdout.match(/Flow created:\s*([A-Z0-9]+)/);
      if (!m) {
        return reject(new Error(`unexpected coordinate output: ${stdout}`));
      }
      resolve(m[1]);
    });
  });
}

// ---------------------------------------------------------------------------
// Smoke test (siempre)
// ---------------------------------------------------------------------------

test.describe('Visor write operations — smoke', () => {
  test('Tab Coordinate monta sin error: textarea + Prepare disabled', async ({ page }) => {
    await gotoCoordinateTab(page);
    await expect(page.locator(SEL.cardIdle)).toBeVisible();
    await expect(page.locator(SEL.textareaIdea)).toBeVisible();
    // El boton Prepare arranca disabled (idea vacia < 20 chars).
    await expect(page.locator(SEL.btnPrepare)).toBeDisabled();
    // No debe haber spinner ni error en mount.
    await expect(page.locator(SEL.cardPreparing)).toHaveCount(0);
    await expect(page.locator(SEL.cardError)).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Tests reales (gated por PLAYWRIGHT_REAL_PLANNER=1)
// ---------------------------------------------------------------------------

test.describe('Visor write operations — real planner (gated)', () => {
  // El planner real tarda 30s-90s por iteracion. Subimos el timeout via
  // describe.configure (scope = este describe).
  test.describe.configure({ timeout: REAL_PLANNER_TEST_TIMEOUT_MS });

  test.skip(
    !REAL_PLANNER,
    'Set PLAYWRIGHT_REAL_PLANNER=1 to run (consumes real tokens).',
  );

  // -----------------------------------------------------------------------
  // Test 1 — Prepare -> Confirm (caso A: sin ambigüedad)
  // -----------------------------------------------------------------------
  test('Test 1 — Prepare con idea concreta -> proposal-ready -> Confirm -> redirige a Flows', async ({ page }) => {
    await gotoCoordinateTab(page);

    const idea =
      'En src/lib/api-utils.ts del repo Geolinks, renombrar la variable ' +
      'foo a bar. Solo eso, sin cambios adicionales.';
    await pasteIdea(page, idea);
    await clickPrepare(page);

    const next = await waitForPrepareTransition(page);
    expect(next).toBe('proposal-ready');

    // Verifica que se renderiza markdown con PLAN_READY.
    const md = page.locator(SEL.mdBlock);
    await expect(md).toBeVisible();
    const mdText = (await md.textContent()) || '';
    expect(mdText).toContain('PLAN_READY');

    // Click Confirm and execute.
    await page.locator(SEL.btnConfirm).click();
    await expect(page.locator(SEL.cardConfirming)).toBeVisible();

    // Tras confirm el frontend redirige a la tab Flows con drawer.
    await expect.poll(
      async () => page.url(),
      { timeout: CONFIRM_TIMEOUT_MS, intervals: [500, 1000, 2000] },
    ).toContain('#flows');

    await expect(page.locator(SEL.tabFlows)).toHaveAttribute('aria-selected', 'true');
  });

  // -----------------------------------------------------------------------
  // Test 2 — Prepare con ambigüedad -> waiter -> fulfill -> re-prepare -> confirm
  // -----------------------------------------------------------------------
  test('Test 2 — Idea ambigua -> waiter -> Submit answers -> proposal-ready -> Confirm', async ({ page }) => {
    await gotoCoordinateTab(page);

    const idea =
      'Crear un comando para ver estado. Necesito algo simple para chequear ' +
      'que cosas estan corriendo y cuales bloqueadas en el sistema.';
    await pasteIdea(page, idea);
    await clickPrepare(page);

    const first = await waitForPrepareTransition(page);
    expect(first).toBe('blocked-by-waiter');

    // SchemaForm debe estar montado en la card blocked.
    const blocked = page.locator(SEL.cardBlocked);
    await expect(blocked).toBeVisible();
    const form = blocked.locator(SEL.schemaForm);
    await expect(form).toBeVisible();

    // Rellenar TODOS los campos visibles del form de forma best-effort:
    // selects -> primera opcion no-vacia; text inputs -> "test"; textareas
    // -> "test response"; checkboxes -> check.
    const fields = await form.locator('.schema-form-field').all();
    expect(fields.length).toBeGreaterThan(0);
    for (const f of fields) {
      const type = await f.getAttribute('data-field-type');
      if (type === 'string') {
        const select = f.locator('select');
        if (await select.count() > 0) {
          const optionValues = await select.locator('option').evaluateAll(
            (opts) =>
              (opts as HTMLOptionElement[])
                .map((o) => o.value)
                .filter((v) => v !== ''),
          );
          if (optionValues.length > 0) await select.selectOption(optionValues[0]);
        } else if (await f.locator('textarea').count() > 0) {
          await f.locator('textarea').fill('test response');
        } else {
          await f.locator('input[type="text"]').fill('test');
        }
      } else if (type === 'boolean') {
        const cb = f.locator('input[type="checkbox"]');
        if (await cb.count() > 0) await cb.check();
      } else if (type === 'number' || type === 'integer') {
        await f.locator('input[type="number"]').fill('1');
      } else {
        // best effort: rellenar primer input encontrado.
        const inp = f.locator('input').first();
        if (await inp.count() > 0) await inp.fill('test');
      }
    }

    // Click Submit answers (boton dentro del SchemaForm).
    await form.locator('button.btn-primary', { hasText: /Submit answers|Approve/ })
      .first()
      .click();

    // Tras Submit deberiamos volver a preparing y luego proposal-ready.
    await expect(page.locator(SEL.cardPreparing)).toBeVisible();
    const second = await waitForPrepareTransition(page);
    expect(second).toBe('proposal-ready');

    const md = page.locator(SEL.mdBlock);
    const mdText = (await md.textContent()) || '';
    expect(mdText).toContain('PLAN_READY');

    await page.locator(SEL.btnConfirm).click();
    await expect(page.locator(SEL.cardConfirming)).toBeVisible();
  });

  // -----------------------------------------------------------------------
  // Test 3 — Respond differently produce nuevo flowId distinto
  // -----------------------------------------------------------------------
  test('Test 3 — Respond differently -> nuevo flowId distinto del anterior', async ({ page }) => {
    await gotoCoordinateTab(page);

    const idea =
      'Necesito algo para gestionar el estado del sistema, no se exactamente ' +
      'que forma deberia tener, pero algo util para el dia a dia.';
    await pasteIdea(page, idea);
    await clickPrepare(page);

    const first = await waitForPrepareTransition(page);
    expect(first).toBe('blocked-by-waiter');

    const firstFlowId = await readLatestFlowIdFromStorage(page);
    expect(firstFlowId).toBeTruthy();

    const form = page.locator(SEL.cardBlocked).locator(SEL.schemaForm);
    await expect(form).toBeVisible();

    // Click "Respond differently" dentro del SchemaForm.
    await form.locator('button', { hasText: 'Respond differently' }).click();

    // Verifica que el bloque "The planner asked" esta visible arriba.
    const ref = form.locator('.schema-form-respond-reference');
    await expect(ref).toBeVisible();
    const refTitle = form.locator('.schema-form-respond-reference-title');
    await expect(refTitle).toHaveText(/The planner asked/);

    // Textarea libre para escribir respuesta custom.
    const ta = form.locator('textarea.schema-form-respond-textarea');
    await expect(ta).toBeVisible();
    await ta.fill(
      'En realidad quiero un endpoint HTTP en el visor que devuelva ' +
        'JSON con el estado actual del flow para consumirlo desde scripts.',
    );

    // Click "Send custom response".
    await form.locator('button.btn-primary', { hasText: 'Send custom response' }).click();

    // Tras send custom response: re-preparing con nuevo flowId.
    await expect(page.locator(SEL.cardPreparing)).toBeVisible();

    // Esperar a que el nuevo flowId aparezca al frente de
    // localStorage.visor.coordinate.recent. CoordinateTab hace addRecent()
    // tras postPrepare(), asi que en cuanto el backend responde se persiste.
    await expect.poll(
      async () => {
        const id = await readLatestFlowIdFromStorage(page);
        if (!id) return null;
        if (firstFlowId && id === firstFlowId) return null;
        return id;
      },
      { timeout: 30_000, intervals: [500, 1000, 2000] },
    ).not.toBeNull();

    const secondFlowId = await readLatestFlowIdFromStorage(page);
    expect(secondFlowId).toBeTruthy();
    expect(secondFlowId).not.toBe(firstFlowId);
  });

  // -----------------------------------------------------------------------
  // Test 4 — Fulfill waiter pasivo directo desde tab Waiters
  // -----------------------------------------------------------------------
  test.describe('Test 4 — Tab Waiters drawer', () => {
    let testWaiterId: string | null = null;

    test.beforeAll(async () => {
      if (!REAL_PLANNER) return;
      if (!orchestratorCliAvailable()) {
        throw new Error(
          `Orchestrator CLI no disponible en ORCHESTRATOR_DIR=${ORCHESTRATOR_DIR}`,
        );
      }
      // Crea via CLI un flow que produzca un waiter pasivo waiting.
      const idea =
        'EXPERIMENT-VISOR-E2E: crear un comando para ver estado del sistema. ' +
        'Idea ambigua intencional para producir un waiter clarification.';
      const flowId = await spawnCoordinatePlannerForTestWaiter(idea);
      // Polling al endpoint /api/waiters hasta detectar el waiter.
      // Necesitamos un page para hacer request? — usamos fetch global.
      const baseUrl = 'http://localhost:5173';
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        try {
          const res = await fetch(baseUrl + '/api/waiters');
          if (res.ok) {
            const body: any = await res.json().catch(() => ({}));
            const list: any[] = Array.isArray(body?.waiters) ? body.waiters : [];
            const found = list.find(
              (w) =>
                w &&
                w.flow_id === flowId &&
                w.status === 'waiting' &&
                w.mode === 'passive',
            );
            if (found) {
              testWaiterId = found.id;
              return;
            }
          }
        } catch {
          // siguiente intento.
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      throw new Error(
        `beforeAll timeout: el flow ${flowId} no produjo un waiter pasivo en 180s`,
      );
    });

    test('Fulfill desde drawer -> waiter pasa a fulfilled', async ({ page }) => {
      if (!testWaiterId) {
        test.skip(true, 'No se creo el waiter de prueba en beforeAll.');
      }

      await page.goto('/#waiters');
      await expect(page.getByTestId('health-header')).toBeVisible();
      await expect(page.locator(SEL.tabWaiters)).toHaveAttribute(
        'aria-selected',
        'true',
      );

      // Encontrar la fila del waiter recien creado.
      const row = page.locator(
        `${SEL.waiterRow}[data-waiter-id="${testWaiterId}"]`,
      );
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.click();

      // Drawer abre con SchemaForm.
      const drawer = page.locator(SEL.drawer);
      await expect(drawer).toBeVisible();
      const form = drawer.locator(SEL.schemaForm);
      await expect(form).toBeVisible();

      // Rellenar campos best-effort (mismo patron que Test 2).
      const fields = await form.locator('.schema-form-field').all();
      for (const f of fields) {
        const type = await f.getAttribute('data-field-type');
        if (type === 'string') {
          const select = f.locator('select');
          if (await select.count() > 0) {
            const optionValues = await select.locator('option').evaluateAll(
              (opts) =>
                (opts as HTMLOptionElement[])
                  .map((o) => o.value)
                  .filter((v) => v !== ''),
            );
            if (optionValues.length > 0) await select.selectOption(optionValues[0]);
          } else if (await f.locator('textarea').count() > 0) {
            await f.locator('textarea').fill('test response');
          } else {
            await f.locator('input[type="text"]').fill('test');
          }
        } else if (type === 'boolean') {
          const cb = f.locator('input[type="checkbox"]');
          if (await cb.count() > 0) await cb.check();
        } else if (type === 'number' || type === 'integer') {
          await f.locator('input[type="number"]').fill('1');
        } else {
          const inp = f.locator('input').first();
          if (await inp.count() > 0) await inp.fill('test');
        }
      }

      // Click "Submit answers" (o el primer boton primary disponible).
      const submit = form
        .locator('button.btn-primary', { hasText: /Submit answers|Approve/ })
        .first();
      await submit.click();

      // Esperar a que el waiter cambie de status en /api/waiters.
      await expect.poll(
        async () => {
          const res = await page.request.get('/api/waiters');
          if (!res.ok()) return null;
          const body = await res.json().catch(() => ({}));
          const list: any[] = Array.isArray(body?.waiters) ? body.waiters : [];
          const w = list.find((x) => x && x.id === testWaiterId);
          return w ? w.status : null;
        },
        { timeout: 60_000, intervals: [1000, 2000, 3000] },
      ).toBe('fulfilled');
    });
  });
});
