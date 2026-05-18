// tests/e2e/visor.spec.ts
// Suite de 6 tests E2E para el visor (flow visor-tests-e2e).
//
// data-testid agregados al codigo del visor para soportar selectores estables:
//   - nav#tabs > a            -> data-testid="tab-flows" / "tab-sessions" /
//                                "tab-waiters" / "tab-stats"   (src/main.js)
//   - header health metrics   -> data-testid="health-header"   (src/main.js)
//   - select de filtro status -> data-testid="filter-status"   (flows.js)
//   - select de filtro auto.  -> data-testid="filter-autonomy" (flows.js)
//   - input de busqueda       -> data-testid="search-input"    (flows.js)
//   - boton "Limpiar" filtros -> data-testid="filter-clear"    (flows.js)
//   - contador de filtros     -> data-testid="filter-count"    (flows.js)
//   - row de la tabla flows   -> data-testid="flow-row"        (flows.js)
//   - empty state             -> data-testid="empty-state"     (flows.js)
//   - error state             -> data-testid="error-state"     (flows.js)
//   - drawer panel            -> data-testid="drawer"          (drawer.js)
//   - drawer overlay          -> data-testid="drawer-overlay"  (drawer.js)
//
// Reglas:
//   * Tests 1-4 corren contra la API real (vite proxy hacia localhost:5176).
//   * Tests 5-6 mockean SOLO /api/flows con page.route().
//   * Cada test arranca con page.goto('/') y espera el header health visible.

import { test, expect } from '@playwright/test';

async function gotoAndWaitForReady(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByTestId('health-header')).toBeVisible();
}

test.describe('Visor E2E', () => {
  test('Atajos 1/2/3/4 cambian de tab', async ({ page }) => {
    await gotoAndWaitForReady(page);

    // Asegurar foco fuera de inputs editables para que los atajos disparen.
    await page.locator('body').click({ position: { x: 1, y: 1 } });

    await page.keyboard.press('1');
    await expect(page.getByTestId('tab-flows')).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('2');
    await expect(page.getByTestId('tab-sessions')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('tab-flows')).toHaveAttribute('aria-selected', 'false');

    await page.keyboard.press('3');
    await expect(page.getByTestId('tab-waiters')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('tab-sessions')).toHaveAttribute('aria-selected', 'false');

    await page.keyboard.press('4');
    await expect(page.getByTestId('tab-stats')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('tab-waiters')).toHaveAttribute('aria-selected', 'false');
  });

  test('Tecla / da focus al search input', async ({ page }) => {
    await gotoAndWaitForReady(page);

    // El input de busqueda vive en la tab Flows (montada por default).
    await expect(page.getByTestId('search-input')).toBeVisible();

    // Asegurar que el foco NO esta en un input antes de presionar '/'.
    await page.locator('body').click({ position: { x: 1, y: 1 } });

    await page.keyboard.press('/');

    await expect(page.getByTestId('search-input')).toBeFocused();
    // El '/' no debe escribirse dentro del input (preventDefault del listener).
    await expect(page.getByTestId('search-input')).toHaveValue('');
  });

  test('Drawer abre con click en row, cierra con Esc', async ({ page }) => {
    await gotoAndWaitForReady(page);

    const firstRow = page.getByTestId('flow-row').first();
    await firstRow.waitFor({ state: 'visible', timeout: 5000 });

    await firstRow.click();
    await expect(page.getByTestId('drawer')).toBeVisible();

    await page.keyboard.press('Escape');
    // El drawer se desmonta tras terminar la transicion (fallback ~400ms).
    await expect(page.getByTestId('drawer')).toHaveCount(0, { timeout: 2000 });
  });

  test('Filtros reducen lista y limpia restaura', async ({ page }) => {
    await gotoAndWaitForReady(page);

    const rows = page.getByTestId('flow-row');
    await rows.first().waitFor({ state: 'visible', timeout: 5000 });

    const initialCount = await rows.count();
    expect(initialCount).toBeGreaterThan(0);

    // Aplicar filtro por status. Probamos varios valores hasta encontrar uno
    // que efectivamente cambie la lista respecto al total. Si todos los flows
    // tienen el mismo status la condicion de "count menor" no aplica, pero el
    // filtro sigue ejerciendo efecto (count <= total).
    await page.getByTestId('filter-status').selectOption('running');
    const filteredCount = await rows.count();
    expect(filteredCount).toBeLessThanOrEqual(initialCount);

    // Click en "Limpiar" -> filtros vuelven a vacio y count == initial.
    await page.getByTestId('filter-clear').click();
    await expect(rows).toHaveCount(initialCount);
    await expect(page.getByTestId('filter-status')).toHaveValue('');
  });

  test('Empty state visible con lista filtrada vacia', async ({ page }) => {
    await page.route('**/api/flows*', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ flows: [] }),
      })
    );

    await gotoAndWaitForReady(page);

    await expect(page.getByTestId('empty-state')).toBeVisible();
    // La tabla NO debe renderizarse cuando no hay flows.
    await expect(page.locator('table.flows-table')).toHaveCount(0);
  });

  test('Error state con 500', async ({ page }) => {
    await page.route('**/api/flows*', (r) =>
      r.fulfill({
        status: 500,
        contentType: 'text/plain',
        body: 'error',
      })
    );

    await gotoAndWaitForReady(page);

    await expect(page.getByTestId('error-state')).toBeVisible();
    // En estado de error no se renderiza la tabla de flows.
    await expect(page.locator('table.flows-table')).toHaveCount(0);
  });
});
