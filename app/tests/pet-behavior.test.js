'use strict';

// node --test wrapper for tests/pet-behavior-electron.js: spawns the real
// Electron binary on the behavior entry and asserts its JSON verdict.
// Set WHALE_SKIP_DOM=1 to skip (same opt-out as the DOM smoke test).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const ELECTRON_BIN = require('electron');

const SKIP = process.env.WHALE_SKIP_DOM === '1';

function runElectronBehavior() {
  return new Promise((resolve, reject) => {
    const child = spawn(ELECTRON_BIN, ['--no-sandbox', path.join(__dirname, 'pet-behavior-electron.js')], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const killer = setTimeout(() => child.kill('SIGKILL'), 45000);
    child.on('error', (err) => { clearTimeout(killer); reject(err); });
    child.on('close', (code, signal) => {
      clearTimeout(killer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

(SKIP ? test.skip : test)('pet behavior: agent receipt, approval interrupt, IME, dblclick guards, sleep CSS', async () => {
  const { code, signal, stdout, stderr } = await runElectronBehavior();
  const line = stdout.split('\n').find((l) => l.startsWith('WHALE_PET_BEHAVIOR '));
  assert.ok(line, `no WHALE_PET_BEHAVIOR line in output; exit=${code}/${signal} stderr=${stderr.slice(0, 2000)}`);
  const result = JSON.parse(line.slice('WHALE_PET_BEHAVIOR '.length));
  assert.equal(result.ok, true, `behavior failures: ${JSON.stringify(result.failures)}`);
  assert.equal(code, 0, `electron exited with ${code}`);
});
