'use strict';

// Electron behavior regression tests for app/pet.js, run as
// `electron tests/pet-behavior-electron.js`. Loads the real index.html with
// the real preload and recording IPC stubs, then drives the renderer
// (chat input, keydown events, agent status pushes, dblclick) and asserts
// the fixes for audit P0-1, P0-2, P1-4 (IME), P1-4-chat-over-approval,
// P1-5 (dblclick) and P1-3 (sleep bubble readability).
// Prints one WHALE_PET_BEHAVIOR {json} line and exits 0/1.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();

const calls = { chat: 0, agentStartTask: 0, hide: 0 };
const STUBS = {
  'whale:begin-drag': () => ({ ok: true }),
  'whale:end-drag': () => ({ ok: true }),
  'whale:hide': () => { calls.hide += 1; return true; },
  'whale:quit': () => true,
  'whale:get-settings': () => ({ muted: false, talkativeness: 'normal', sensors: true, chat: true, agent: false }),
  'whale:set-setting': () => true,
  'whale:cursor-subscribe': () => true,
  'whale:cpu-subscribe': () => true,
  'whale:has-api-key': () => false,
  'whale:set-api-key': () => ({ ok: true }),
  'whale:open-key-dialog': () => true,
  'whale:chat': () => { calls.chat += 1; return { ok: true, reply: '这是一段足够长的回复，打字机需要一会儿才能打完，方便测试中途打断。'.repeat(2) }; },
  'whale:agent-start-task': () => { calls.agentStartTask += 1; return { ok: true }; },
  'whale:agent-approve': () => true,
  'whale:agent-reject': () => true,
};
for (const [channel, handler] of Object.entries(STUBS)) {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, handler);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const failures = [];
  const check = (ok, label) => { if (!ok) failures.push(label); };
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
  const js = (script) => win.webContents.executeJavaScript(script, true);
  const send = (channel, payload) => { win.webContents.send(channel, payload); };

  await new Promise((resolve) => {
    win.webContents.once('did-finish-load', resolve);
    win.loadFile(path.join(__dirname, '..', 'index.html')).catch(resolve);
  });
  await sleep(400); // let the page scripts settle

  const dbg = 'window.__whalePetDebug';
  const $ = (id) => `document.getElementById('${id}')`;

  // ---- P0-1: agent task receipt must end the conversation --------------
  send('whale:settings-changed', { muted: false, talkativeness: 'normal', sensors: false, chat: true, agent: true });
  await sleep(100);
  await js(`${dbg}.requestState('idle', true)`);
  send('whale:open-chat');
  await sleep(100);
  check(await js(`${$('chat-input')}.hidden === false`) === true, 'P0-1: chat input opens in agent mode');
  await js(`${$('chat-text')}.value = '帮我写个脚本'; void 0`);
  await js(`${$('chat-text')}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`);
  await sleep(250); // agentStartTask receipt + ack bubble
  check(await js(`${dbg}.chatting`) === false, 'P0-1: chatting reset after accepted agent task');
  check(await js(`${$('bubble')}.hidden === false && ${$('bubble-text')}.textContent.length > 0`) === true, 'P0-1: ack bubble visible');
  check(calls.agentStartTask === 1, `P0-1: task dispatched once (got ${calls.agentStartTask})`);

  // ---- IME: Enter with isComposing must not send ------------------------
  send('whale:settings-changed', { agent: false, chat: true });
  await sleep(100);
  await js(`${dbg}.requestState('idle', true)`);
  send('whale:open-chat');
  await sleep(100);
  await js(`${$('chat-text')}.value = 'nihao'`);
  await js(`(() => {
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'isComposing', { value: true });
    ${$('chat-text')}.dispatchEvent(ev);
  })()`);
  await sleep(150);
  check(await js(`${$('chat-input')}.hidden === false`) === true, 'IME: input stays open after composing Enter');
  check(await js(`${dbg}.chatting`) === true, 'IME: round not started by composing Enter');
  check(calls.chat === 0, `IME: no chat round dispatched (got ${calls.chat})`);
  // Escape closes the input and ends the round.
  await js(`${$('chat-text')}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  await sleep(50);

  // ---- P0-2: approval card interrupting the typewriter resets chatting --
  await js(`${dbg}.requestState('idle', true)`);
  send('whale:open-chat');
  await sleep(100);
  await js(`${$('chat-text')}.value = '你好呀'`);
  await js(`${$('chat-text')}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`);
  await sleep(150); // reply is mid-typewriter here
  check(await js(`${dbg}.chatting`) === true, 'P0-2: chatting true mid-typewriter');
  check(await js(`${$('bubble-text')}.classList.contains('typing')`) === true, 'P0-2: typewriter active');
  send('whale:agent-approval', { id: 1, kind: 'approval', toolName: 'shell', reason: 'rm -rf /tmp/x' });
  await sleep(100);
  check(await js(`${dbg}.chatting`) === false, 'P0-2: chatting reset when approval interrupts the typewriter');
  check(await js(`${$('bubble')}.hidden === true`) === true, 'P0-2: bubble hidden by the approval card');
  check(await js(`${dbg}.approvalUp`) === true, 'P0-2: approval card is up');
  check(await js(`${$('approval-card')}.hidden === false`) === true, 'P0-2: approval card visible');
  // Mirror the runtime's phase flip so the renderer tracks waiting-approval.
  send('whale:agent-status', { phase: 'waiting-approval' });
  await sleep(100);

  // ---- openChatInput must be blocked while the approval card is up ------
  send('whale:open-chat');
  await sleep(100);
  check(await js(`${$('chat-input')}.hidden === true`) === true, 'approval: chat input stays closed under a pending approval');

  // ---- dblclick must not hide under approval / agent busy ---------------
  await js(`${$('pet')}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await sleep(1400);
  check(calls.hide === 0, `dblclick: no hide under approval (got ${calls.hide})`);

  send('whale:agent-status', { phase: 'running' }); // approval resolved, agent busy
  await sleep(100);
  check(await js(`${dbg}.approvalUp`) === false, 'approval: card cleared when the agent resumes');
  await js(`${$('pet')}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await sleep(1400);
  check(calls.hide === 0, `dblclick: no hide while the agent is busy (got ${calls.hide})`);

  // Idle again: dblclick from a rest state still hides (feature intact).
  send('whale:agent-status', { phase: 'idle' });
  await sleep(100);
  await js(`${dbg}.requestState('idle', true)`);
  await js(`${$('pet')}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await sleep(1500);
  check(calls.hide === 1, `dblclick: hides from idle when nothing is pending (got ${calls.hide})`);

  // ---- sleep must not fade urgent agent bubbles (CSS) -------------------
  const opacity = await js(`(() => {
    const pet = ${$('pet')};
    const bubble = ${$('bubble')};
    const bt = ${$('bubble-text')};
    bubble.hidden = false;
    bt.classList.remove('typing');
    bt.style.transition = 'none';
    pet.classList.add('sleep');
    bt.classList.remove('urgent');
    const asleep = getComputedStyle(bt).opacity;
    bt.classList.add('urgent');
    const urgent = getComputedStyle(bt).opacity;
    pet.classList.remove('sleep');
    bt.classList.remove('urgent');
    bubble.hidden = true;
    return { asleep, urgent };
  })()`);
  check(opacity && opacity.asleep === '0.25', `css: sleep fades ordinary bubbles (got ${opacity && opacity.asleep})`);
  check(opacity && opacity.urgent === '1', `css: urgent bubbles stay readable in sleep (got ${opacity && opacity.urgent})`);

  console.log(`WHALE_PET_BEHAVIOR ${JSON.stringify({ ok: failures.length === 0, failures })}`);
  app.exit(failures.length === 0 ? 0 : 1);
});

// Hard watchdog: never hang the test runner.
setTimeout(() => {
  console.log(`WHALE_PET_BEHAVIOR ${JSON.stringify({ ok: false, failures: ['timeout'] })}`);
  app.exit(1);
}, 30000);
