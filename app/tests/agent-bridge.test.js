'use strict';

// Regression tests for the agent bridge connection core (audit P0-3):
// toggling the agent off during `connecting` must not leak the runtime
// client, and no phantom status/approval may be emitted after the stop.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createAgentConnection } = require('../agent-bridge.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'fake-sdk.mjs');

function makeConn(events, query = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-agent-test-'));
  return {
    dir,
    conn: createAgentConnection({
      dshHome: path.join(dir, 'home'),
      cwd: path.join(dir, 'work'),
      sdkIndexUrl: pathToFileURL(FIXTURE).href + query,
      env: process.env,
      emit: (event, payload) => events.push({ event, ...payload }),
    }),
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('stop during the SDK import cancels start: no client is ever built', async () => {
  const events = [];
  const { conn, dir } = makeConn(events, '?delay=80');
  const starting = conn.start();
  await tick(); // start() is now awaiting the delayed module import
  await conn.stop();
  await starting;
  const mod = await import(pathToFileURL(FIXTURE).href + '?delay=80');
  assert.equal(mod.control.instances.length, 0, 'client must not be constructed');
  const phases = events.filter((e) => e.event === 'status').map((e) => e.phase);
  assert.deepEqual(phases, ['connecting', 'offline']);
  assert.equal(conn.phase, 'offline');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stop during initialize tears the spawned client down and stays offline', async () => {
  const events = [];
  const { conn, dir } = makeConn(events);
  let releaseInitialize;
  const mod = await import(pathToFileURL(FIXTURE).href);
  mod.control.initializeGate = new Promise((resolve) => { releaseInitialize = resolve; });
  const starting = conn.start();
  await tick();
  await tick();
  assert.equal(mod.control.instances.length, 1);
  assert.equal(mod.control.instances[0].started, true, 'runtime already spawned');
  await conn.stop();
  releaseInitialize();
  await starting;
  const c = mod.control.instances[0];
  assert.equal(c.closed, true, 'cancelled start must close the client');
  const phases = events.filter((e) => e.event === 'status').map((e) => e.phase);
  assert.equal(phases[phases.length - 1], 'offline');
  assert.ok(!phases.includes('idle'), `no phantom idle after stop: ${phases}`);
  assert.equal(conn.phase, 'offline');
  mod.control.initializeGate = null;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a normal start reaches idle, then stop closes the client', async () => {
  const events = [];
  const { conn, dir } = makeConn(events, '?case=normal');
  const mod = await import(pathToFileURL(FIXTURE).href + '?case=normal');
  await conn.start();
  assert.equal(mod.control.instances.length, 1);
  assert.equal(conn.phase, 'idle');
  const task = await conn.sendTask('hello');
  assert.deepEqual(task, { ok: true });
  await conn.stop();
  assert.equal(mod.control.instances[0].closed, true);
  const phases = events.filter((e) => e.event === 'status').map((e) => e.phase);
  assert.deepEqual(phases, ['connecting', 'idle', 'running', 'offline']);
  fs.rmSync(dir, { recursive: true, force: true });
});
