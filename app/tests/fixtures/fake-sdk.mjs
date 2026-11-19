'use strict';

// Fake DSH SDK client used by app/tests/agent-bridge.test.js. Mirrors the
// surface createAgentConnection touches: constructor opts, subscribe(),
// start(), onRequest(), initialize(), child.once(), close().
//
// Each distinct import URL (differing query string) is a fresh module
// instance, so every test gets isolated state via the exported `control`.

export const control = {
  initializeGate: null, // when set, initialize() waits for this promise
  instances: [],
};

const params = new URL(import.meta.url).searchParams;
const delayMs = Number(params.get('delay') ?? '0');
if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

export class HarnessClient {
  constructor(opts) {
    this.opts = opts;
    this.started = false;
    this.closed = false;
    this.initialized = false;
    this.requestHandler = null;
    this.child = { once: () => {} };
    control.instances.push(this);
  }

  subscribe() {
    return (async function* empty() {})();
  }

  start() { this.started = true; }

  onRequest(handler) { this.requestHandler = handler; }

  async initialize() {
    if (control.initializeGate) await control.initializeGate;
    this.initialized = true;
  }

  async request(method, params) {
    this.lastRequest = { method, params };
    return { ok: true };
  }

  async close() { this.closed = true; }
}
