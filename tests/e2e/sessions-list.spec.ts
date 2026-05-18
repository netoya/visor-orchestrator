import { test, expect } from '@playwright/test';

test('GET /api/sessions retorna lista', async ({ request }) => {
  const res = await request.get('http://localhost:5176/api/sessions');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('sessions');
  expect(Array.isArray(body.sessions)).toBe(true);
  if (body.sessions.length > 0) {
    const s = body.sessions[0];
    expect(s).toHaveProperty('session_id');
    expect(s).toHaveProperty('agent_id');
    expect(s).toHaveProperty('process_status');
    expect(['alive', 'zombie', 'finished']).toContain(s.process_status);
  }
});

test('GET /api/sessions?status=alive filtra', async ({ request }) => {
  const res = await request.get('http://localhost:5176/api/sessions?status=alive');
  expect(res.status()).toBe(200);
  const body = await res.json();
  for (const s of body.sessions) expect(s.process_status).toBe('alive');
});
