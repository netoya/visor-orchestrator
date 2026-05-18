/**
 * Scanner of running `claude -p` processes via `ps`.
 *
 * Env vars:
 *   PROCESS_SCAN_CACHE_MS  TTL (ms) of the in-memory snapshot. Default: 5000.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ClaudeProcess } from './types.js';

const pexec = promisify(exec);

interface CacheEntry {
  ts: number;
  data: ClaudeProcess[];
}

let cache: CacheEntry | null = null;

function ttlMs(): number {
  const raw = process.env.PROCESS_SCAN_CACHE_MS ?? '5000';
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5000;
}

const LINE_RE = /^\s*(\d+)\s+(\d+)\s+(\d+\.?\d*)\s+(\S+)\s+(.*)$/;
const CLAUDE_RE = /\bclaude\b/;
const RESUME_RE = /--resume\s+([a-zA-Z0-9_-]+)/;

export async function listClaudeProcesses(): Promise<ClaudeProcess[]> {
  const now = Date.now();
  if (cache && now - cache.ts < ttlMs()) return cache.data;

  let stdout: string;
  try {
    const res = await pexec('ps -eo pid,rss,pcpu,etime,args --no-headers');
    stdout = res.stdout;
  } catch (err) {
    console.warn('[processes] ps failed:', (err as Error).message);
    cache = { ts: now, data: [] };
    return [];
  }

  const procs: ClaudeProcess[] = [];
  for (const line of stdout.split('\n')) {
    if (!line) continue;
    if (!CLAUDE_RE.test(line)) continue;
    if (!line.includes(' -p')) continue;
    const m = line.match(LINE_RE);
    if (!m) continue;

    const pid = parseInt(m[1], 10);
    const rssKb = parseInt(m[2], 10);
    const cpu = parseFloat(m[3]);
    const etime = m[4];
    const argv = m[5];

    const proc: ClaudeProcess = {
      pid,
      etime,
      rss_mb: Math.round((rssKb / 1024) * 10) / 10,
      cpu_pct: Number.isFinite(cpu) ? cpu : 0,
      argv_string: argv,
    };

    const rm = argv.match(RESUME_RE);
    if (rm) proc.resume_session_id = rm[1];

    procs.push(proc);
  }

  cache = { ts: now, data: procs };
  return procs;
}
