'use strict';

// DOM smoke test wrapper for node --test: spawns the real Electron binary on
// tests/dom-smoke-electron.js and asserts its JSON verdict. Set
// WHALE_SKIP_DOM=1 to skip (e.g. on CI runners without a display server).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const ELECTRON_BIN = require('electron'); // resolves to the binary path in Node

const SKIP = process.env.WHALE_SKIP_DOM === '1';

function runElectronSmoke() {
  return new Promise((resolve, reject) => {
    const child = spawn(ELECTRON_BIN, ['--no-sandbox', path.join(__dirname, 'dom-smoke-electron.js')], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const killer = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.on('error', (err) => { clearTimeout(killer); reject(err); });
    child.on('close', (code, signal) => {
      clearTimeout(killer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

(SKIP ? test.skip : test)('DOM smoke: [hidden] hides chat-input/bubble/dots/approval-card in the real page', async () => {
  const { code, signal, stdout, stderr } = await runElectronSmoke();
  const line = stdout.split('\n').find((l) => l.startsWith('WHALE_DOM_SMOKE '));
  assert.ok(line, `no WHALE_DOM_SMOKE line in output; exit=${code}/${signal} stderr=${stderr.slice(0, 2000)}`);
  const result = JSON.parse(line.slice('WHALE_DOM_SMOKE '.length));
  assert.equal(result.ok, true, `DOM smoke failures: ${JSON.stringify(result.failures)}`);
  assert.equal(code, 0, `electron exited with ${code}`);
});
