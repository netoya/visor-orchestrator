import { test, expect } from '@playwright/test'

test('GET /api/health returns ok and read-only DB info', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.ok).toBe(true)
  expect(body.db_writable).toBe(false)
  expect(typeof body.db_size_kb).toBe('number')
  expect(body.db_size_kb).toBeGreaterThan(0)
  expect(typeof body.db_path).toBe('string')
  expect(body.db_path).toContain('orchestrator.db')
  expect(typeof body.uptime_s).toBe('number')
  expect(typeof body.node_version).toBe('string')
  expect(body.build_hash).toBe('dev')
})
