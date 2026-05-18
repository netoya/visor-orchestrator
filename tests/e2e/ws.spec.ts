import { test, expect } from '@playwright/test';
import WebSocket from 'ws';

const WS_URL = 'ws://localhost:5176/api/ws';
const HELLO_TIMEOUT_MS = 2000;
const STATS_TIMEOUT_MS = 5000;

interface AnyEvent {
  type: string;
  ts?: string;
  payload?: unknown;
}

test('WS /api/ws streams hello + stats', async () => {
  const ws = new WebSocket(WS_URL);
  const messages: AnyEvent[] = [];
  const connectedAt = Date.now();
  let helloAt: number | null = null;
  let statsAt: number | null = null;

  await new Promise<void>((resolve, reject) => {
    const overall = setTimeout(
      () => reject(new Error(`no stats event in ${STATS_TIMEOUT_MS + 1000}ms`)),
      STATS_TIMEOUT_MS + 1000,
    );

    ws.on('message', (raw: Buffer | string) => {
      let ev: AnyEvent;
      try {
        ev = JSON.parse(raw.toString()) as AnyEvent;
      } catch (err) {
        clearTimeout(overall);
        reject(new Error(`invalid JSON from server: ${String(err)}`));
        return;
      }
      messages.push(ev);
      if (ev.type === 'hello' && helloAt === null) helloAt = Date.now();
      if (ev.type === 'stats' && statsAt === null) statsAt = Date.now();
      if (statsAt !== null) {
        clearTimeout(overall);
        resolve();
      }
    });

    ws.on('error', (e: Error) => {
      clearTimeout(overall);
      reject(e);
    });
  });

  await new Promise<void>((resolve) => {
    ws.once('close', () => resolve());
    ws.close();
  });

  const hello = messages.find((m) => m.type === 'hello');
  expect(hello, 'expected a hello event').toBeTruthy();
  expect(typeof hello!.ts).toBe('string');
  const helloDate = new Date(hello!.ts as string);
  expect(Number.isNaN(helloDate.getTime())).toBe(false);
  expect(helloAt).not.toBeNull();
  expect(helloAt! - connectedAt).toBeLessThan(HELLO_TIMEOUT_MS);

  const stats = messages.find((m) => m.type === 'stats');
  expect(stats, 'expected at least one stats event').toBeTruthy();
  expect(stats!.payload).toBeTruthy();
  const payload = stats!.payload as { flows?: unknown; tasks?: unknown };
  expect(payload.flows, 'stats.payload.flows').toBeTruthy();
  expect(payload.tasks, 'stats.payload.tasks').toBeTruthy();
  const flows = payload.flows as Record<string, unknown>;
  const tasks = payload.tasks as Record<string, unknown>;
  for (const key of ['total', 'queued', 'running', 'done', 'failed']) {
    expect(typeof flows[key], `flows.${key} numeric`).toBe('number');
    expect(typeof tasks[key], `tasks.${key} numeric`).toBe('number');
  }
  expect(statsAt).not.toBeNull();
  expect(statsAt! - connectedAt).toBeLessThan(STATS_TIMEOUT_MS);
});
