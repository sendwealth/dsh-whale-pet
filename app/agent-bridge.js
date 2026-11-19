'use strict';

// L4 W2: main-process agent bridge. The Electron pet becomes the avatar of
// a real DSH agent: a `dsh --profile sdk` runtime subprocess spawned and
// owned here, exactly like the W1 PoC (l4-poc/demo.mjs). The SDK client is
// an ESM module imported dynamically from the local harness checkout's
// built lib, so this file stays CommonJS like the rest of app/.
//
// The connection core (createAgentConnection) requires no Electron and is
// exercised by the offline smoke test (app/agent-smoke.js).

const fs = require('fs');
const path = require('path');

// Convention paths of the local DeepSeek Harness checkout. The runtime
// spawn resolves the same-version `dsh` bin inside the checkout, so the
// checkout path and its built artifacts are hard requirements (W1 finding).
const DEFAULT_DSH_CHECKOUT = '/home/rowan/Projects/deepseek-harness';
const AGENT_SESSION_ID = 'whale-pet';

/**
 * Resolve { dshCheckout, dshHome, sdkIndexUrl } from userData/config.json
 * (keys `dshCheckout` / `agentDshHome`) with the convention defaults.
 * Only the main process ever sees these paths.
 *
 * @param {string} userDataDir
 * @returns {{dshCheckout:string, dshHome:string, sdkIndexUrl:string}}
 */
function resolveAgentConfig(userDataDir) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(userDataDir, 'config.json'), 'utf8')); } catch (err) { /* defaults */ }
  const dshCheckout = typeof cfg.dshCheckout === 'string' && cfg.dshCheckout !== ''
    ? cfg.dshCheckout : DEFAULT_DSH_CHECKOUT;
  const dshHome = typeof cfg.agentDshHome === 'string' && cfg.agentDshHome !== ''
    ? cfg.agentDshHome : path.join(dshCheckout, '.whale-pet-dsh-home');
  return {
    dshCheckout,
    dshHome,
    sdkIndexUrl: path.join(dshCheckout, 'packages', 'sdk', 'client', 'lib', 'index.js'),
  };
}

/**
 * Create one agent runtime connection. Pure Node: no Electron imports.
 *
 * Emits `emit('status', {phase, done?, crashed?, error?})` with phase one of
 * connecting | idle | running | waiting-approval | waiting-question | error |
 * offline, and `emit('approval', {id, kind, toolName?, reason?, question?})`
 * with a display-only summary (never the raw JSON, which can be huge).
 *
 * @param {object} args
 * @param {string} args.dshHome absolute DSH_HOME for the runtime
 * @param {string} args.cwd working directory for the agent session
 * @param {string} args.sdkIndexUrl absolute path of the built SDK client ESM
 * @param {NodeJS.ProcessEnv} args.env environment for the runtime (carries
 *   DEEPSEEK_API_KEY when present; nothing is faked when absent)
 * @param {(event:'status'|'approval', payload:object)=>void} args.emit
 */
function createAgentConnection({ dshHome, cwd, sdkIndexUrl, env, emit }) {
  /** @type {import('/home/rowan/Projects/deepseek-harness/packages/sdk/client/lib/index.js').HarnessClient|null} */
  let client = null;
  let closing = false;
  let phase = 'offline';
  let taskInFlight = false;
  let lastTurnError = null; // {code, message} from turn/end, cleared on idle
  let interactionSeq = 0;
  /** @type {{kind:'approval'|'question', resolve:Function}|null} */
  let pending = null;

  function setPhase(next, extra) {
    phase = next;
    emit('status', { phase: next, ...extra });
  }

  function settlePending(decision) {
    if (pending === null) return;
    const p = pending;
    pending = null;
    p.resolve(decision);
    // The next session.status will correct this optimistic transition.
    if (phase === 'waiting-approval' || phase === 'waiting-question') phase = 'running';
    emit('status', { phase });
  }

  function handleApproval(params) {
    interactionSeq += 1;
    setPhase('waiting-approval');
    emit('approval', {
      id: interactionSeq,
      kind: 'approval',
      toolName: typeof params?.toolName === 'string' ? params.toolName : '',
      reason: typeof params?.reason === 'string' ? params.reason : '',
    });
    return new Promise((resolve) => { pending = { kind: 'approval', resolve }; });
  }

  function handleQuestion(request) {
    interactionSeq += 1;
    const first = Array.isArray(request?.questions) ? request.questions[0] : null;
    const question = first && typeof first.question === 'string' ? first.question
      : (typeof request?.header === 'string' ? request.header : '');
    const options = first && Array.isArray(first.options) && first.options.length > 0
      ? first.options.map((o) => o.label).filter((l) => typeof l === 'string').join(' / ')
      : '';
    setPhase('waiting-question');
    emit('approval', {
      id: interactionSeq,
      kind: 'question',
      question,
      reason: options,
    });
    return new Promise((resolve) => { pending = { kind: 'question', resolve, request }; });
  }

  function handleNotification(notification) {
    const params = notification.params ?? {};
    if (notification.method === 'session.status') {
      if (params.status === 'running') {
        if (pending === null) setPhase('running');
      } else if (params.status === 'idle') {
        // While we owe the server an answer the agent stays "waiting" even
        // though its loop went idle.
        if (pending !== null) return;
        const done = taskInFlight;
        taskInFlight = false;
        const error = lastTurnError;
        lastTurnError = null;
        setPhase('idle', { ...(done ? { done: true } : {}), ...(error ? { error } : {}) });
      }
      return;
    }
    // session.event: single events can reach tens of KB (tool schemas), so
    // everything except turn/end is dropped here before it can accumulate.
    if (notification.method === 'session.event' && params.event?.type === 'turn/end') {
      const reason = params.event.data?.reason;
      if (reason?.kind === 'error' && reason.error) {
        lastTurnError = {
          code: typeof reason.error.code === 'string' ? reason.error.code : 'ERROR',
          message: String(reason.error.message ?? '').slice(0, 300),
        };
      }
    }
  }

  async function start() {
    if (client !== null) return;
    closing = false;
    setPhase('connecting');
    let mod;
    try {
      mod = await import(sdkIndexUrl);
    } catch (err) {
      setPhase('error', { error: { code: 'SDK-LOAD', message: `Cannot load the DSH SDK client at ${sdkIndexUrl}` } });
      return;
    }
    try {
      fs.mkdirSync(dshHome, { recursive: true });
      fs.mkdirSync(cwd, { recursive: true });
    } catch (err) {
      setPhase('error', { error: { code: 'FS', message: String(err?.message ?? err) } });
      return;
    }
    const c = new mod.HarnessClient({
      dshHome,
      cwd,
      approvalRequests: true,
      env,
      // The callback must exist at construction so initialize declares
      // capabilities.userQuestions (W1 finding).
      onUserQuestion: (request) => handleQuestion(request),
    });
    client = c;
    const sub = c.subscribe((n) => n.method === 'session.status'
      || (n.method === 'session.event' && n.params?.event?.type === 'turn/end'));
    (async () => {
      try {
        for await (const n of sub) handleNotification(n);
      } catch (err) { /* subscription ends with the client; child exit below reports it */ }
    })();
    try {
      // Order matters: start() before onRequest() (W1 finding).
      c.start();
      c.onRequest(async (method, params) => {
        if (method === 'approval/request') return handleApproval(params);
        throw new Error(`whale-pet has no answer for ${method}`);
      });
      await c.initialize({
        cwd,
        provider: 'deepseek-official',
        model: 'deepseek-official',
        approvalRequests: true,
      });
    } catch (err) {
      client = null;
      closing = true;
      try { await c.close(); } catch (closeErr) { /* best-effort teardown */ }
      closing = false;
      setPhase('error', { error: { code: 'INIT', message: String(err?.message ?? err).slice(0, 300) } });
      return;
    }
    if (c.child) {
      c.child.once('exit', () => {
        if (closing || client !== c) return;
        client = null;
        taskInFlight = false;
        settlePending(pending?.kind === 'approval' ? { outcome: 'cancelled' } : { cancelled: true });
        setPhase('offline', { crashed: true });
      });
    }
    setPhase('idle');
  }

  async function sendTask(text) {
    if (client === null) return { ok: false, code: 'offline' };
    try {
      await client.request('session/prompt', {
        sessionId: AGENT_SESSION_ID,
        contentBlocks: [{ type: 'text', text }],
      });
      taskInFlight = true;
      if (phase === 'idle') setPhase('running');
      return { ok: true };
    } catch (err) {
      return { ok: false, code: 'error', message: String(err?.message ?? err).slice(0, 300) };
    }
  }

  function approve() {
    if (pending?.kind === 'approval') settlePending({ outcome: 'allowed-once' });
    else if (pending?.kind === 'question') {
      const request = pending.request;
      const answers = request.questions.map((q) => ({
        id: q.id,
        selected: Array.isArray(q.options) && q.options[0] ? [q.options[0].label] : [],
      }));
      settlePending({ answers });
    }
  }

  function reject() {
    if (pending?.kind === 'approval') settlePending({ outcome: 'rejected' });
    else if (pending?.kind === 'question') settlePending({ cancelled: true });
  }

  async function stop() {
    if (client === null) { setPhase('offline'); return; }
    const c = client;
    client = null;
    closing = true;
    // Fail-close anything still owed: the server treats a missing or
    // malformed answer as non-approval, and cancelling is the honest one.
    if (pending !== null) {
      const p = pending;
      pending = null;
      p.resolve(p.kind === 'approval' ? { outcome: 'cancelled' } : { cancelled: true });
    }
    try { await c.close(); } catch (err) { /* dispose ladder is best-effort */ }
    closing = false;
    setPhase('offline');
  }

  return {
    start, stop, sendTask, approve, reject,
    get phase() { return phase; },
  };
}

/**
 * Wire the agent bridge into the running Electron app: IPC handlers,
 * renderer pushes, and quit-time teardown.
 *
 * @param {object} deps
 * @param {import('electron').App} deps.app
 * @param {() => import('electron').BrowserWindow|null} deps.getWindow
 * @param {(payload:{phase:string})=>void} [deps.onPhase] tray/tooltip hook
 */
function registerAgentBridge({ app, getWindow, onPhase }) {
  const { ipcMain } = require('electron'); // lazy: core stays Node-testable
  const userDataDir = app.getPath('userData');
  const cfg = resolveAgentConfig(userDataDir);
  const cwd = path.join(userDataDir, 'agent-work');
  /** @type {ReturnType<createAgentConnection>|null} */
  let conn = null;

  function emit(event, payload) {
    if (event === 'status') {
      onPhase?.(payload);
      const win = getWindow();
      if (win !== null && !win.isDestroyed()) win.webContents.send('whale:agent-status', payload);
    } else {
      const win = getWindow();
      if (win !== null && !win.isDestroyed()) win.webContents.send('whale:agent-approval', payload);
    }
  }

  /**
   * @param {boolean} value settings key `agent`
   */
  async function setEnabled(value) {
    if (value && conn === null) {
      conn = createAgentConnection({
        dshHome: cfg.dshHome,
        cwd,
        sdkIndexUrl: cfg.sdkIndexUrl,
        env: process.env,
        emit,
      });
      await conn.start();
    } else if (!value && conn !== null) {
      const c = conn;
      conn = null;
      await c.stop();
    }
  }

  ipcMain.handle('whale:agent-start-task', async (_event, payload) => {
    const text = payload && typeof payload.text === 'string' ? payload.text.trim().slice(0, 4000) : '';
    if (text === '') return { ok: false, code: 'empty-input' };
    if (conn === null) return { ok: false, code: 'offline' };
    return conn.sendTask(text);
  });
  ipcMain.handle('whale:agent-approve', () => { conn?.approve(); return true; });
  ipcMain.handle('whale:agent-reject', () => { conn?.reject(); return true; });

  // App quit shuts the runtime down first (EOF -> SIGTERM -> SIGKILL
  // ladder inside the SDK), then lets the quit proceed.
  let quitTeardownStarted = false;
  app.on('before-quit', (event) => {
    if (quitTeardownStarted || conn === null) return;
    quitTeardownStarted = true;
    event.preventDefault();
    const c = conn;
    conn = null;
    c.stop().catch(() => {}).finally(() => { app.quit(); });
  });

  return {
    setEnabled,
    getPhase: () => (conn === null ? 'offline' : conn.phase),
    shutdown: async () => {
      if (conn === null) return;
      const c = conn;
      conn = null;
      await c.stop();
    },
  };
}

module.exports = { createAgentConnection, registerAgentBridge, resolveAgentConfig, DEFAULT_DSH_CHECKOUT, AGENT_SESSION_ID };
