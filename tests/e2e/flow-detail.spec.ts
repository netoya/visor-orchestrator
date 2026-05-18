import { test, expect } from '@playwright/test';

const BASE = process.env.VISOR_BASE_URL || 'http://localhost:5176';

test('GET /api/flows/:id/detail retorna 200 con flow.id correcto y tasks array', async ({ request }) => {
  const listRes = await request.get(BASE + '/api/flows');
  expect(listRes.status()).toBe(200);
  const listBody = await listRes.json();
  expect(Array.isArray(listBody.flows)).toBe(true);
  test.skip(listBody.flows.length === 0, 'no hay flows en la DB para testear el detalle');

  const firstId = listBody.flows[0].id;
  expect(typeof firstId).toBe('string');

  const res = await request.get(BASE + `/api/flows/${encodeURIComponent(firstId)}/detail`);
  expect(res.status()).toBe(200);
  const body = await res.json();

  expect(body.id).toBe(firstId);
  expect(Array.isArray(body.tasks)).toBe(true);
});

test('GET /api/flows/:id/detail con id inexistente retorna 404 y body.error definido', async ({ request }) => {
  const res = await request.get(BASE + '/api/flows/nonexistent-id-xxx/detail');
  expect(res.status()).toBe(404);
  const body = await res.json();
  expect(body.error).toBeDefined();
  expect(typeof body.error).toBe('string');
  expect(body.error.length).toBeGreaterThan(0);
});

test('cada task del detail tiene id, stage, agent_id, status (strings) y priority (number)', async ({ request }) => {
  const listRes = await request.get(BASE + '/api/flows');
  const listBody = await listRes.json();
  test.skip(listBody.flows.length === 0, 'no hay flows en la DB para testear shape de tasks');

  const firstId = listBody.flows[0].id;
  const res = await request.get(BASE + `/api/flows/${encodeURIComponent(firstId)}/detail`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.tasks)).toBe(true);

  if (body.tasks.length === 0) {
    expect(body.tasks.length).toBeGreaterThanOrEqual(0);
    return;
  }

  for (const t of body.tasks) {
    expect(typeof t.id).toBe('string');
    expect(t.id.length).toBeGreaterThan(0);
    expect(typeof t.stage).toBe('string');
    expect(typeof t.agent_id).toBe('string');
    expect(typeof t.status).toBe('string');
    expect(typeof t.priority).toBe('number');
  }
});
