#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';
import readline from 'node:readline';

const PLAN_PROMPT = `You are the planner half of a Prewalk handoff.
Work on the user's task normally, but front-load the difficult reasoning before implementation.

1. Explore the repository enough to understand the relevant architecture, conventions, tests, and failure modes.
2. Use the plan/todo facility before implementation. Keep it compact: 3-8 concrete items. Every implementation item must include an explicit validation step or be paired with one.
3. Do not stop after writing a plan. Begin implementation yourself.
4. Make the smallest high-confidence first code edit that demonstrates the intended implementation pattern.
5. Continue naturally after that edit unless the harness interrupts you for handoff.

Do not write a prose handoff document. The executor will inherit this same thread trajectory, tool results, plan state, and your first successful edit.`;

const EXECUTOR_PROMPT = `You are the executor half of a Prewalk handoff.
The same thread was just explored and planned by a stronger model, and at least one successful file edit has already landed.
Continue directly from that trajectory. Do not restart repository reconnaissance or rewrite the plan from scratch unless new evidence requires it.
Use the existing plan as the source of truth, complete the remaining implementation, run the validations called for by the plan, fix failures, and finish the user's task.`;

function usage() {
  return `Usage: prewalk [options] <task>\n\nOptions:\n  --planner <model>          Planner model (default: gpt-5.6-sol)\n  --executor <model>         Executor model (default: gpt-5.6-luna)\n  --planner-effort <level>   Planner reasoning effort (default: high)\n  --executor-effort <level>  Executor reasoning effort (default: medium)\n  --cwd <path>               Working directory (default: current directory)\n  --help                     Show this help`;
}

function parseArgs(argv) {
  const out = {
    planner: process.env.CODEX_PREWALK_PLANNER || 'gpt-5.6-sol',
    executor: process.env.CODEX_PREWALK_EXECUTOR || 'gpt-5.6-luna',
    plannerEffort: process.env.CODEX_PREWALK_PLANNER_EFFORT || 'high',
    executorEffort: process.env.CODEX_PREWALK_EXECUTOR_EFFORT || 'medium',
    cwd: process.cwd(),
    task: '',
  };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };
    if (arg === '--planner') out.planner = next();
    else if (arg === '--executor') out.executor = next();
    else if (arg === '--planner-effort') out.plannerEffort = next();
    else if (arg === '--executor-effort') out.executorEffort = next();
    else if (arg === '--cwd') out.cwd = next();
    else rest.push(arg);
  }
  out.task = rest.join(' ').trim();
  return out;
}

class AppServerClient {
  constructor(cwd) {
    this.cwd = cwd;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.stderr = '';
  }

  async start() {
    this.proc = spawn('codex', ['app-server', '--listen', 'stdio://'], {
      cwd: this.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: process.platform === 'win32',
    });
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', chunk => { this.stderr += chunk; });
    this.proc.on('error', err => this.failAll(err));
    this.proc.on('exit', (code, signal) => {
      if (code !== 0 && this.pending.size) {
        this.failAll(new Error(`codex app-server exited (${signal || code})${this.stderr.trim() ? `: ${this.stderr.trim()}` : ''}`));
      }
    });

    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on('line', line => this.handleLine(line));
    this.rl = rl;

    await this.request('initialize', {
      clientInfo: { name: 'codex-prewalk', title: 'Codex Prewalk', version: '0.1.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.notify('initialized', {});
  }

  failAll(error) {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  handleLine(line) {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); }
    catch { return; }

    if (msg.id !== undefined && msg.method) {
      this.handleServerRequest(msg);
      return;
    }
    if (msg.id !== undefined) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else pending.resolve(msg.result ?? {});
      return;
    }
    if (msg.method) {
      for (const listener of this.listeners) listener(msg);
    }
  }

  handleServerRequest(msg) {
    // The nested run stays workspace-sandboxed and uses approvalPolicy=never. If a
    // model/provider still emits an approval request, only accept ordinary file/
    // command approval requests; do not grant extra permissions or elicitations.
    if (msg.method === 'item/commandExecution/requestApproval' || msg.method === 'item/fileChange/requestApproval') {
      this.send({ id: msg.id, result: { decision: 'accept' } });
      return;
    }
    if (msg.method === 'item/permissions/requestApproval') {
      this.send({ id: msg.id, result: { scope: 'turn', permissions: {} } });
      return;
    }
    if (msg.method === 'mcpServer/elicitation/request' || msg.method === 'item/tool/requestUserInput') {
      this.send({ id: msg.id, result: { action: 'decline', content: null } });
      return;
    }
    this.send({ id: msg.id, error: { code: -32601, message: `Unsupported server request: ${msg.method}` } });
  }

  send(message) {
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }
  notify(method, params = {}) { this.send({ method, params }); }
  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ id, method, params });
    });
  }
  onNotification(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async close() {
    this.rl?.close();
    if (this.proc && !this.proc.killed) {
      this.proc.stdin.end();
      this.proc.kill('SIGTERM');
    }
  }
}

function collaborationMode(model, effort, developerInstructions) {
  return {
    mode: 'default',
    settings: {
      model,
      reasoning_effort: effort,
      developer_instructions: developerInstructions,
    },
  };
}

async function runTurn(client, params, { onEvent } = {}) {
  let turnId;
  let doneResolve;
  let doneReject;
  const done = new Promise((resolve, reject) => { doneResolve = resolve; doneReject = reject; });
  const stop = client.onNotification(message => {
    const p = message.params ?? {};
    if (turnId && p.turnId && p.turnId !== turnId) return;
    onEvent?.(message, turnId);
    if (message.method === 'turn/completed' && (!turnId || p.turn?.id === turnId || p.turnId === turnId)) {
      const turn = p.turn ?? p;
      if (turn.status === 'failed') doneReject(new Error(turn.error?.message || 'Codex turn failed'));
      else doneResolve(turn);
    }
    if (message.method === 'error' && (!turnId || p.turnId === turnId)) {
      doneReject(new Error(p.error?.message || 'Codex app-server error'));
    }
  });
  try {
    const started = await client.request('turn/start', params);
    turnId = started.turn?.id;
    if (!turnId) throw new Error('turn/start did not return a turn id');
    const turn = await done;
    return { turnId, turn };
  } finally {
    stop();
  }
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(error.message); console.error(usage()); process.exitCode = 2; return; }
  if (args.help) { console.log(usage()); return; }
  if (!args.task) { console.error('A task is required.'); console.error(usage()); process.exitCode = 2; return; }

  const client = new AppServerClient(args.cwd);
  await client.start();
  try {
    console.error(`[prewalk] planner: ${args.planner} (${args.plannerEffort})`);
    console.error(`[prewalk] executor: ${args.executor} (${args.executorEffort})`);

    const threadStart = await client.request('thread/start', {
      model: args.planner,
      cwd: args.cwd,
      approvalPolicy: 'never',
      sandbox: 'workspaceWrite',
      serviceName: 'codex-prewalk',
    });
    const threadId = threadStart.thread?.id;
    if (!threadId) throw new Error('thread/start did not return a thread id');

    let planReady = false;
    let handoffRequested = false;
    let plannerTurnId;

    const plannerPromise = runTurn(client, {
      threadId,
      input: [{ type: 'text', text: args.task }],
      model: args.planner,
      effort: args.plannerEffort,
      collaborationMode: collaborationMode(args.planner, args.plannerEffort, PLAN_PROMPT),
    }, {
      onEvent(message, activeTurnId) {
        plannerTurnId = activeTurnId || plannerTurnId;
        const p = message.params ?? {};
        if (message.method === 'turn/plan/updated' && Array.isArray(p.plan) && p.plan.length > 0) {
          planReady = true;
          console.error(`[prewalk] plan ready (${p.plan.length} items)`);
        }
        if (message.method === 'item/completed') {
          const item = p.item;
          if (item?.type === 'fileChange' && item.status === 'completed') {
            const paths = Array.isArray(item.changes) ? item.changes.map(change => change.path).filter(Boolean) : [];
            console.error(`[prewalk] planner edit landed${paths.length ? `: ${paths.join(', ')}` : ''}`);
            if (planReady && !handoffRequested && plannerTurnId) {
              handoffRequested = true;
              console.error('[prewalk] handoff boundary reached; interrupting planner');
              client.request('turn/interrupt', { threadId, turnId: plannerTurnId }).catch(() => {});
            }
          }
        }
      },
    });

    await plannerPromise;

    if (!handoffRequested) {
      console.error('[prewalk] planner finished before a todo-gated edit boundary; no executor handoff was needed.');
      return;
    }

    console.error(`[prewalk] switched trajectory to ${args.executor}`);
    let finalMessage = '';
    await runTurn(client, {
      threadId,
      input: [],
      model: args.executor,
      effort: args.executorEffort,
      collaborationMode: collaborationMode(args.executor, args.executorEffort, EXECUTOR_PROMPT),
    }, {
      onEvent(message) {
        const item = message.params?.item;
        if (message.method === 'item/completed' && item?.type === 'agentMessage' && typeof item.text === 'string') {
          finalMessage = item.text;
        }
      },
    });

    if (finalMessage.trim()) console.log(finalMessage.trim());
    else console.log('Prewalk completed.');
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error(`[prewalk] ${error.stack || error.message || String(error)}`);
  process.exitCode = 1;
});
