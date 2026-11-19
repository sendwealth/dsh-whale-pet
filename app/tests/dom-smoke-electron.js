'use strict';

// Electron DOM smoke entry, run as `electron tests/dom-smoke-electron.js`.
// Loads the real app/index.html with the real preload and asserts in the
// renderer that the [hidden] attribute actually hides panels whose CSS sets
// display (the exact class of bug where .chat-input { display: flex } defeats
// hidden). Prints one WHALE_DOM_SMOKE {json} line and exits 0/1.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Test hosts often have no usable GPU; software rendering is enough here.
app.disableHardwareAcceleration();

// The pet renderer invokes these at startup; main.js normally owns them.
// Minimal stubs keep the page script paths alive without spawning anything.
const STUBS = {
  'whale:begin-drag': () => ({ ok: true }),
  'whale:end-drag': () => ({ ok: true }),
  'whale:hide': () => true,
  'whale:quit': () => true,
  'whale:get-settings': () => ({ muted: false, talkativeness: 'normal', sensors: true, chat: true, agent: false }),
  'whale:set-setting': () => true,
  'whale:cursor-subscribe': () => true,
  'whale:cpu-subscribe': () => true,
  'whale:has-api-key': () => false,
  'whale:set-api-key': () => ({ ok: true }),
  'whale:open-key-dialog': () => true,
  'whale:chat': () => ({ ok: false, code: 'no-key', message: 'smoke stub' }),
  'whale:agent-start-task': () => ({ ok: false }),
  'whale:agent-approve': () => ({ ok: true }),
  'whale:agent-reject': () => ({ ok: true }),
};
for (const [channel, handler] of Object.entries(STUBS)) {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, handler);
}

// Runs in the renderer via executeJavaScript; CSP does not apply there.
const ASSERT_SCRIPT = `(() => {
  const failures = [];
  const panels = ['bubble', 'dots', 'approval-card', 'chat-input'];
  for (const id of panels) {
    const el = document.getElementById(id);
    if (el === null) { failures.push('missing #' + id); continue; }
    el.hidden = true;
    const display = getComputedStyle(el).display;
    if (display !== 'none') failures.push('#' + id + ' has hidden but computed display=' + display);
    if (el.offsetParent !== null) failures.push('#' + id + ' has hidden but offsetParent is not null');
  }
  // Un-hiding must restore layout: the [hidden] rule may not kill the
  // panels permanently.
  const input = document.getElementById('chat-input');
  input.hidden = false;
  const inputDisplay = getComputedStyle(input).display;
  if (inputDisplay !== 'flex') failures.push('#chat-input unhidden display=' + inputDisplay + ', expected flex');
  const bubble = document.getElementById('bubble');
  bubble.hidden = false;
  if (getComputedStyle(bubble).display === 'none') failures.push('#bubble unhidden stays display:none');
  bubble.hidden = true;
  input.hidden = true;
  // The stylesheet must carry an explicit [hidden] { display: none !important }
  // guard; class display rules must not be able to defeat the attribute.
  let hasGuard = false;
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (rule.selectorText && rule.selectorText.replace(/\\s+/g, '').includes('[hidden]')
        && rule.cssText.includes('none') && rule.cssText.includes('important')) hasGuard = true;
    }
  }
  if (!hasGuard) failures.push('pet.css lacks a [hidden] { display: none !important } rule');
  return { ok: failures.length === 0, failures };
})()`;

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 260,
    height: 340,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const fail = (message) => {
    console.log(`WHALE_DOM_SMOKE ${JSON.stringify({ ok: false, failures: [message] })}`);
    app.exit(1);
  };
  win.webContents.once('did-finish-load', async () => {
    try {
      // Give the page scripts one turn so startup errors surface in stderr.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const result = await win.webContents.executeJavaScript(ASSERT_SCRIPT, true);
      console.log(`WHALE_DOM_SMOKE ${JSON.stringify(result)}`);
      app.exit(result && result.ok ? 0 : 1);
    } catch (err) {
      fail(`executeJavaScript failed: ${err && err.message}`);
    }
  });
  win.webContents.once('render-process-gone', (_e, details) => fail(`renderer gone: ${details.reason}`));
  win.loadFile(path.join(__dirname, '..', 'index.html')).catch((err) => fail(`loadFile failed: ${err && err.message}`));
  // Hard watchdog: never hang the test runner.
  setTimeout(() => fail('timeout waiting for the page'), 20000);
});
