'use strict';

// L4 W2 offline smoke test: exercise the Electron-free core of
// app/agent-bridge.js under plain Node — spawn the `dsh --profile sdk`
// runtime, observe status notifications, send one task, and shut down.
//
// Without DEEPSEEK_API_KEY the LLM turn fails closed with
// MISSING_CREDENTIAL; nothing is faked. Run:
//
//   node app/agent-smoke.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const { createAgentConnection } = require('./agent-bridge');

const log = (tag, value) => console.log(`[${new Date().toISOString()}] ${tag} ${JSON.stringify(value)}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-agent-smoke-'));
const dshHome = path.join(tmp, 'dsh-home');
const cwd = path.join(tmp, 'work');

const events = [];
let settle;
const finished = new Promise((resolve) => { settle = resolve; });

function emit(event, payload) {
  events.push({ event, ...payload });
  log(event, payload);
  const status = payload.phase;
  // Success: a full honest cycle without a key — connecting -> idle ->
  // running -> idle(done, MISSING_CREDENTIAL) — then we shut down.
  if (event === 'status' && status === 'idle' && payload.done && payload.error?.code === 'MISSING_CREDENTIAL') {
    settle('cycle-complete');
  }
}

const conn = createAgentConnection({
  dshHome,
  cwd,
  // Same import path as the W1 PoC: the harness checkout's built SDK lib.
  sdkIndexUrl: '/home/rowan/Projects/deepseek-harness/packages/sdk/client/lib/index.js',
  env: process.env,
  emit,
});

const watchdog = setTimeout(() => settle('timeout'), 60000);

(async () => {
  let exitCode = 0;
  try {
    await conn.start();
    const task = await conn.sendTask('用一句话介绍你自己。');
    log('task', task);
    const verdict = await finished;
    clearTimeout(watchdog);
    log('verdict', { verdict });
    if (verdict !== 'cycle-complete') throw new Error(`watchdog ended with ${verdict}`);
    // Sanity: the pending-approval API exists even though no key means we
    // cannot trigger a real approval/request in this environment.
    log('approval-api', { approve: typeof conn.approve, reject: typeof conn.reject });
  } catch (err) {
    exitCode = 1;
    log('error', { name: err?.name, message: String(err?.message ?? err) });
  } finally {
    await conn.stop();
    log('phases', { final: conn.phase, observed: [...new Set(events.filter((e) => e.event === 'status').map((e) => e.phase))] });
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(exitCode);
  }
})();
