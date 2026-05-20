import { spawn } from 'node:child_process';

function getOrchestratorDir(): string {
  const d = process.env.ORCHESTRATOR_DIR;
  if (!d) throw new Error('ORCHESTRATOR_DIR not configured');
  return d;
}

export function buildPlannerPrompt(
  idea: string,
  answers?: Record<string, unknown>,
  previousFlowId?: string,
  customResponse?: string,
): string {
  const isReplan = Boolean(answers || customResponse);
  const parts: string[] = [];

  parts.push(
    `PLANNER MODE — Analizar idea del operador. NO crear plan ejecutable${isReplan ? ' (re-plan tras clarificaciones)' : ''}.`,
  );
  parts.push('');
  parts.push(
    `REGLAS CRITICAS:
- NO crees tasks de impl/test/verify/etc. NO descompongas la idea en plan ejecutable.
- Crea EXACTAMENTE 1 task: slug planner-analyze, agente softwarefactory_roman.
- Esa task hace TODO el planner-work: lee codebase, escribe doc en state/conversations/ (PLAN-PROPOSAL.md o PLAN-FINAL.md), crea waiter pasivo si detecta ambiguedades.
- Tras crear la task, emite <<COORDINATOR_DONE: planner-analyze task created>>. NADA mas.`,
  );
  parts.push('');
  parts.push(`IDEA del operador:\n"${idea}"`);

  if (answers) {
    parts.push('');
    parts.push(
      `DECISIONES YA RESUELTAS POR EL OPERADOR:\n${JSON.stringify(answers, null, 2)}`,
    );
  }

  if (customResponse) {
    parts.push('');
    parts.push(
      `REINTERPRETACION DEL OPERADOR:\nEl operador descarto las preguntas anteriores y aclara:\n"${customResponse}"\n\nConsidera esto como sobrescritura/clarificacion de la idea original.`,
    );
  }

  if (previousFlowId) {
    parts.push('');
    parts.push(`Flow de prepare anterior (contexto): ${previousFlowId}`);
  }

  parts.push('');
  parts.push(
    `DESCOMPON en exactamente 1 task. Slug literal: planner-analyze. Agente: softwarefactory_roman. Prioridad 10, max-turns 80, estimated-minutes 25. Sin depends-on.`,
  );
  parts.push(
    `Ver autonomous-orchestrator/docs/planner-mode.md para el prompt completo de la task (caminos A: PLAN_READY, B: BLOCKED-BY-WAITER con un solo waiter kind=clarification).`,
  );

  return parts.join('\n');
}

export function parsePlannerOutput(
  stdout: string,
): { flowId: string; coordinatorTaskId: string } | null {
  const m1 = stdout.match(/Flow created:\s*([A-Z0-9]+)/);
  const m2 = stdout.match(/Coordinator task:\s*([A-Z0-9]+)/);
  if (!m1 || !m2) return null;
  return { flowId: m1[1], coordinatorTaskId: m2[1] };
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function spawnCoordinate(prompt: string): Promise<SpawnResult> {
  const orchDir = getOrchestratorDir();
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['orchestrator', 'coordinate', prompt], {
      cwd: orchDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => {
      stdout += c.toString();
    });
    proc.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    proc.on('error', (e) => reject(new Error(`spawn-error: ${e.message}`)));
    proc.on('close', (exit) => resolve({ stdout, stderr, exitCode: exit }));
  });
}

export async function launchPrepare(opts: {
  idea: string;
  previousFlowId?: string;
  answers?: Record<string, unknown>;
  customResponse?: string;
}): Promise<{ flowId: string; plannerTaskId: string }> {
  const prompt = buildPlannerPrompt(
    opts.idea,
    opts.answers,
    opts.previousFlowId,
    opts.customResponse,
  );
  const { stdout, stderr, exitCode } = await spawnCoordinate(prompt);
  if (exitCode !== 0) throw new Error(`prepare exit=${exitCode}: ${stderr}`);
  const parsed = parsePlannerOutput(stdout);
  if (!parsed) throw new Error(`unexpected output: ${stdout}`);
  return { flowId: parsed.flowId, plannerTaskId: parsed.coordinatorTaskId };
}

/**
 * ADR-007: launchConfirm delega al CLI `orchestrator flow confirm <id>`.
 * El CLI hace todas las validaciones (prepare existe, status completed,
 * archivo PLAN-FINAL existe, contiene PLAN_READY) y setea parent_flow_id
 * en el nuevo flow. Esto reemplaza el spawn manual de coordinate con
 * prompt inline que existía antes.
 */
export async function launchConfirm(opts: {
  prepareFlowId: string;
}): Promise<{ executeFlowId: string; executeCoordinatorTaskId: string }> {
  const orchDir = getOrchestratorDir();

  return new Promise((resolve, reject) => {
    const proc = spawn(
      'npx',
      ['orchestrator', 'flow', 'confirm', opts.prepareFlowId],
      {
        cwd: orchDir,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      },
    );
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => (stdout += c.toString()));
    proc.stderr.on('data', (c) => (stderr += c.toString()));
    proc.on('error', (e) => reject(new Error(`spawn-error: ${e.message}`)));
    proc.on('close', (exit) => {
      if (exit !== 0) {
        // El CLI imprime el error específico a stderr o stdout (validaciones).
        return reject(new Error(`confirm exit=${exit}: ${stderr || stdout}`));
      }
      // CLI output esperado (parsear lineas):
      //   Plan confirmed.
      //     Plan source: <path>
      //     Prepare flow: <id>
      //     Execute flow: <newId>
      //     Coordinator task: <taskId>
      const flowMatch = stdout.match(/Execute flow:\s*([A-Z0-9]+)/);
      const taskMatch = stdout.match(/Coordinator task:\s*([A-Z0-9]+)/);
      if (!flowMatch || !taskMatch) {
        return reject(new Error(`unexpected confirm output: ${stdout}`));
      }
      resolve({
        executeFlowId: flowMatch[1]!,
        executeCoordinatorTaskId: taskMatch[1]!,
      });
    });
  });
}

export async function fulfillWaiter(opts: {
  waiterId: string;
  value: Record<string, unknown>;
}): Promise<{ ok: true }> {
  const orchDir = getOrchestratorDir();
  const jsonStr = JSON.stringify(opts.value);

  return new Promise((resolve, reject) => {
    const proc = spawn(
      'npx',
      ['orchestrator', 'waiter', 'fulfill', opts.waiterId, '--json', jsonStr],
      {
        cwd: orchDir,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      },
    );
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => {
      stdout += c.toString();
    });
    proc.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    proc.on('error', (e) => reject(new Error(`spawn-error: ${e.message}`)));
    proc.on('close', (exit) => {
      if (exit !== 0) {
        return reject(new Error(`fulfill exit=${exit}: ${stderr || stdout}`));
      }
      if (!stdout.includes('fulfilled')) {
        return reject(new Error(`unexpected fulfill output: ${stdout}`));
      }
      resolve({ ok: true });
    });
  });
}

// ADR-006: cancel + reject + audit via CLI spawn.

/**
 * Cancela un flow via `npx orchestrator flow cancel <id> [--reason "..."]`.
 * Idempotente: si flow ya está terminal, retorna { alreadyTerminal: true }.
 */
export async function cancelFlow(opts: {
  flowId: string;
  reason?: string;
}): Promise<{ ok: true; alreadyTerminal: boolean; output: string }> {
  const orchDir = getOrchestratorDir();
  const args = ['orchestrator', 'flow', 'cancel', opts.flowId];
  if (opts.reason) args.push('--reason', opts.reason);

  return new Promise((resolve, reject) => {
    const proc = spawn('npx', args, {
      cwd: orchDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => (stdout += c.toString()));
    proc.stderr.on('data', (c) => (stderr += c.toString()));
    proc.on('error', (e) => reject(new Error(`spawn-error: ${e.message}`)));
    proc.on('close', (exit) => {
      if (exit !== 0) {
        return reject(new Error(`cancel exit=${exit}: ${stderr || stdout}`));
      }
      const alreadyTerminal = stdout.includes('already in a terminal state');
      resolve({ ok: true, alreadyTerminal, output: stdout });
    });
  });
}

/**
 * Rechaza un waiter via `npx orchestrator waiter reject <id> --reason "..."`.
 * --reason es obligatorio.
 */
export async function rejectWaiter(opts: {
  waiterId: string;
  reason: string;
}): Promise<{ ok: true; alreadyTerminal: boolean; output: string }> {
  if (!opts.reason || opts.reason.trim().length === 0) {
    throw new Error('reason is required');
  }
  const orchDir = getOrchestratorDir();

  return new Promise((resolve, reject) => {
    const proc = spawn(
      'npx',
      ['orchestrator', 'waiter', 'reject', opts.waiterId, '--reason', opts.reason],
      {
        cwd: orchDir,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      },
    );
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => (stdout += c.toString()));
    proc.stderr.on('data', (c) => (stderr += c.toString()));
    proc.on('error', (e) => reject(new Error(`spawn-error: ${e.message}`)));
    proc.on('close', (exit) => {
      if (exit !== 0) {
        return reject(new Error(`reject exit=${exit}: ${stderr || stdout}`));
      }
      const alreadyTerminal = stdout.includes('already in a terminal state');
      resolve({ ok: true, alreadyTerminal, output: stdout });
    });
  });
}

/**
 * Lista los waiters de una task via `npx orchestrator task waiters <id> --json`.
 * Retorna array de WaiterRow estructurados.
 */
export async function listTaskWaiters(opts: { taskId: string }): Promise<unknown[]> {
  const orchDir = getOrchestratorDir();

  return new Promise((resolve, reject) => {
    const proc = spawn(
      'npx',
      ['orchestrator', 'task', 'waiters', opts.taskId, '--json'],
      {
        cwd: orchDir,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      },
    );
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => (stdout += c.toString()));
    proc.stderr.on('data', (c) => (stderr += c.toString()));
    proc.on('error', (e) => reject(new Error(`spawn-error: ${e.message}`)));
    proc.on('close', (exit) => {
      if (exit !== 0) {
        return reject(new Error(`task waiters exit=${exit}: ${stderr || stdout}`));
      }
      try {
        const parsed = JSON.parse(stdout);
        if (!Array.isArray(parsed)) {
          return reject(new Error(`task waiters did not return array`));
        }
        resolve(parsed);
      } catch (err) {
        // Caso "no waiters for task" → output no es JSON, retornar []
        if (stdout.includes('no waiters for task')) return resolve([]);
        reject(new Error(`task waiters parse error: ${(err as Error).message}`));
      }
    });
  });
}

export function checkCliReachable(): Promise<boolean> {
  const orchDir = process.env.ORCHESTRATOR_DIR;
  if (!orchDir) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const proc = spawn('npx', ['orchestrator', 'status'], {
        cwd: orchDir,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 3_000,
      });
      proc.on('error', () => done(false));
      proc.on('close', (exit) => done(exit === 0));
    } catch {
      done(false);
    }
  });
}
