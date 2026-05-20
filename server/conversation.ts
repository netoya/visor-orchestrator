import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ConversationMessage } from './types.js';

const DEFAULT_ORCHESTRATOR_CWD = '/home/angel/projects/autonomous-orchestrator';

function resolveSessionsDir(): string {
  return process.env.CLAUDE_SESSIONS_DIR ?? join(homedir(), '.claude', 'projects');
}

function resolveOrchestratorCwd(): string {
  return process.env.ORCHESTRATOR_CWD ?? DEFAULT_ORCHESTRATOR_CWD;
}

function slugifyCwd(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

function pickRole(record: Record<string, unknown>): string | null {
  const direct = record.role;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const message = record.message as Record<string, unknown> | undefined;
  if (message && typeof message === 'object') {
    const nested = message.role;
    if (typeof nested === 'string' && nested.length > 0) return nested;
  }
  return null;
}

function pickContent(record: Record<string, unknown>): { found: boolean; value: unknown } {
  if (Object.prototype.hasOwnProperty.call(record, 'content')) {
    return { found: true, value: record.content };
  }
  const message = record.message as Record<string, unknown> | undefined;
  if (message && typeof message === 'object' && Object.prototype.hasOwnProperty.call(message, 'content')) {
    return { found: true, value: message.content };
  }
  return { found: false, value: undefined };
}

function pickTimestamp(record: Record<string, unknown>): number | undefined {
  const message = record.message as Record<string, unknown> | undefined;
  const candidates: unknown[] = [
    record.timestamp,
    record.ts,
    message && typeof message === 'object' ? message.timestamp : undefined,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
    if (typeof c === 'string' && c.length > 0) {
      const parsed = Date.parse(c);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return undefined;
}

function findSessionFile(baseDir: string, primarySlug: string, sessionId: string): string | null {
  const primary = join(baseDir, primarySlug, `${sessionId}.jsonl`);
  if (existsSync(primary)) return primary;

  let slugs: string[];
  try {
    slugs = readdirSync(baseDir);
  } catch {
    return null;
  }
  for (const slug of slugs) {
    if (slug === primarySlug) continue;
    const candidate = join(baseDir, slug, `${sessionId}.jsonl`);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not present in this slug, keep searching
    }
  }
  return null;
}

export function readConversationMessages(sessionId: string): ConversationMessage[] {
  const baseDir = resolveSessionsDir();
  const cwdSlug = slugifyCwd(resolveOrchestratorCwd());
  const filePath = findSessionFile(baseDir, cwdSlug, sessionId);

  if (!filePath) return [];

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return [];
    throw err;
  }

  const lines = raw.split('\n');
  const messages: ConversationMessage[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      console.warn(`[conversation] skip malformed line ${i + 1} in ${filePath}`);
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const record = parsed as Record<string, unknown>;
    const role = pickRole(record);
    if (role === null) continue;
    const content = pickContent(record);
    if (!content.found) continue;
    const msg: ConversationMessage = { role, content: content.value };
    const ts = pickTimestamp(record);
    if (ts !== undefined) msg.timestamp = ts;
    messages.push(msg);
  }

  return messages;
}
