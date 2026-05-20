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

export async function launchConfirm(opts: {
  prepareFlowId: string;
}): Promise<{ executeFlowId: string; executeCoordinatorTaskId: string }> {
  const prompt = `EJECUCION del plan firme generado por el flow de planner ${opts.prepareFlowId}.

Lee state/conversations/PLAN-FINAL.md (o PLAN-PROPOSAL.md si no existe el final) — debe estar en Status: PLAN_READY.

Descompon el plan en tasks ejecutivas (impl/test/verify segun corresponda) y arranca el flow de implementacion.

Emite <<COORDINATOR_DONE>> cuando hayas creado las tasks.`;
  const { stdout, stderr, exitCode } = await spawnCoordinate(prompt);
  if (exitCode !== 0) throw new Error(`confirm exit=${exitCode}: ${stderr}`);
  const parsed = parsePlannerOutput(stdout);
  if (!parsed) throw new Error(`unexpected output: ${stdout}`);
  return {
    executeFlowId: parsed.flowId,
    executeCoordinatorTaskId: parsed.coordinatorTaskId,
  };
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
      const proc = spawn('npx', ['orchestrator', '--help'], {
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
