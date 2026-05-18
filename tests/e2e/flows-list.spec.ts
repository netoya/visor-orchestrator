import { test, expect } from '@playwright/test';

const BASE = process.env.VISOR_BASE_URL || 'http://localhost:5176';

test('GET /api/flows retorna 200 con body.flows array', async ({ request }) => {
  const res = await request.get(BASE + '/api/flows');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.flows)).toBe(true);
});

test('cada flow tiene id, name, status, task_counts con total>=0', async ({ request }) => {
  const res = await request.get(BASE + '/api/flows');
  const body = await res.json();
  for (const f of body.flows) {
    expect(typeof f.id).toBe('string');
    expect(typeof f.name).toBe('string');
    expect(typeof f.status).toBe('string');
    expect(f.task_counts).toBeTruthy();
    expect(typeof f.task_counts.total).toBe('number');
    expect(f.task_counts.total).toBeGreaterThanOrEqual(0);
  }
});

test('GET /api/stats retorna 200 con flows.total y tasks.total numericos', async ({ request }) => {
  const res = await request.get(BASE + '/api/stats');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(typeof body.flows.total).toBe('number');
  expect(typeof body.tasks.total).toBe('number');
});

test('GET /api/flows?status=done filtra correctamente', async ({ request }) => {
  const res = await request.get(BASE + '/api/flows?status=done');
  expect(res.status()).toBe(200);
  const body = await res.json();
  for (const f of body.flows) {
    expect(f.status).toBe('done');
  }
});
