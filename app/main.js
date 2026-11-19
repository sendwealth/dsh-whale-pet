'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, powerMonitor } = require('electron');
const os = require('os');
const path = require('path');
const { registerChat } = require('./chat-main');
const { registerAgentBridge } = require('./agent-bridge');

/** Whether the current display server accepts transparent windows. */
let win = null;
let tray = null;
let quitRequested = false;

const WIN_WIDTH = 200;
// Figure (~173 px) plus headroom above her for the chat bubble. A taller
// window would put invisible space above her head and stop her short of
// the screen top.
const WIN_HEIGHT = 240;

function createWindow() {
  win = new BrowserWindow({
    width: WIN_WIDTH,
    height: WIN_HEIGHT,
    transparent: true,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile('index.html');

  // Keep her inside the visible desktop after display changes.
  win.on('moved', clampToWorkArea);
  screen.on('display-metrics-changed', clampToWorkArea);
  // Sensor polls run only while she is visible; hiding her stops them.
  win.on('show', restartSensorPolls);
  win.on('hide', stopSensorPolls);
  win.on('closed', () => {
    stopSensorPolls();
    if (dragState !== null && dragState.timer !== null) clearTimeout(dragState.timer);
    dragState = null;
    win = null;
  });
}

function clampToWorkArea() {
  if (win === null || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  const bounds = screen.getDisplayNearestPoint({ x, y }).bounds;
  const nx = Math.min(Math.max(x, bounds.x), bounds.x + bounds.width - WIN_WIDTH);
  const ny = Math.min(Math.max(y, bounds.y), bounds.y + bounds.height - WIN_HEIGHT);
  if (nx !== x || ny !== y) win.setPosition(nx, ny);
}

let chatApi = null;
let agentApi = null;

app.whenReady().then(() => {
  createWindow();
  chatApi = registerChat({ app, getWindow: () => win });
  agentApi = registerAgentBridge({ app, getWindow: () => win, onPhase: updateTrayForPhase });

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'whale-girl-small.png')).resize({ width: 32, height: 32 }));
  tray.setToolTip('鲸鱼娘桌宠 / Whale pet');
  rebuildTrayMenu();

  // Closing the pet window only hides her; the tray stays. Quit from the tray.
  win.on('close', (event) => {
    if (!quitRequested) {
      event.preventDefault();
      win.hide();
    }
  });
  app.on('window-all-closed', () => { /* keep running in the tray */ });
});

// The renderer owns the settings (persisted in localStorage) and pushes them
// here; the tray menu mirrors them and its clicks push changes back.
let settings = { muted: false, talkativeness: 'normal', sensors: true, chat: true, agent: false };

// The tray tooltip doubles as the agent badge: the phase name travels with
// the ordinary tooltip text (no extra icon assets needed).
const PHASE_LABELS = {
  connecting: '连接中 / connecting',
  idle: '空闲 / idle',
  running: '干活中 / working',
  'waiting-approval': '等你批准 / awaiting approval',
  'waiting-question': '等你回答 / awaiting answer',
  error: '出错了 / error',
  offline: '',
};

function updateTrayForPhase(payload) {
  if (tray === null) return;
  const label = PHASE_LABELS[payload.phase] ?? '';
  tray.setToolTip(label === ''
    ? '鲸鱼娘桌宠 / Whale pet'
    : `鲸鱼娘桌宠 / Whale pet — 助手 ${label}`);
}

function rebuildTrayMenu() {
  if (tray === null) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: '设置 / Settings',
      submenu: [
        {
          label: '静音闲聊 / Mute chatter',
          type: 'checkbox',
          checked: settings.muted,
          click: () => { applySetting('muted', !settings.muted); },
        },
        {
          label: '话痨程度 / Talkativeness',
          submenu: [
            { label: '话痨 / Talkative', type: 'radio', checked: settings.talkativeness === 'talkative', click: () => { applySetting('talkativeness', 'talkative'); } },
            { label: '正常 / Normal', type: 'radio', checked: settings.talkativeness === 'normal', click: () => { applySetting('talkativeness', 'normal'); } },
            { label: '安静 / Quiet', type: 'radio', checked: settings.talkativeness === 'quiet', click: () => { applySetting('talkativeness', 'quiet'); } },
          ],
        },
        {
          label: '传感器 / Sensors',
          type: 'checkbox',
          checked: settings.sensors,
          click: () => { applySetting('sensors', !settings.sensors); },
        },
        {
          label: '对话 / Chat',
          type: 'checkbox',
          checked: settings.chat,
          click: () => { applySetting('chat', !settings.chat); },
        },
        {
          label: '连接助手 / Connect agent',
          type: 'checkbox',
          checked: settings.agent,
          click: () => { applySetting('agent', !settings.agent); },
        },
        { label: '配置 API Key… / Configure API Key…', click: () => { chatApi?.openKeyDialog(); } },
      ],
    },
    { label: '和她说话 / Chat', click: () => { if (windowUsable()) win.webContents.send('whale:open-chat'); } },
    { label: '显示 / Show', click: () => { win?.show(); } },
    { type: 'separator' },
    { label: '退出 / Quit', click: () => { quitRequested = true; app.quit(); } },
  ]));
}

function applySetting(key, value) {
  settings[key] = value;
  rebuildTrayMenu();
  // Toggling the agent owns the runtime subprocess lifecycle.
  if (key === 'agent') agentApi?.setEnabled(value);
  // The renderer owns the sensor subscriptions; turning them off from the
  // tray is forwarded through the settings push below.
  if (win !== null && !win.isDestroyed()) win.webContents.send('whale:settings-changed', settings);
}

ipcMain.handle('whale:get-settings', () => settings);

ipcMain.handle('whale:set-setting', (_event, key, value) => {
  if (key !== 'muted' && key !== 'talkativeness' && key !== 'sensors' && key !== 'chat' && key !== 'agent') return;
  applySetting(key, value);
});

// Dragging runs in the main process: renderer-side coordinates are
// window-relative, so every window move distorts them and the window
// chases its own error. The main process instead polls the real OS
// cursor position and keeps the grab offset constant.
let dragState = null;

ipcMain.handle('whale:begin-drag', () => {
  if (win === null || win.isDestroyed() || dragState !== null) return;
  const cursor = screen.getCursorScreenPoint();
  const [x, y] = win.getPosition();
  dragState = { offX: cursor.x - x, offY: cursor.y - y, timer: null };
  const step = () => {
    if (dragState === null || win === null || win.isDestroyed()) return;
    const point = screen.getCursorScreenPoint();
    win.setPosition(point.x - dragState.offX, point.y - dragState.offY);
    dragState.timer = setTimeout(step, 16);
  };
  step();
});

ipcMain.handle('whale:end-drag', () => {
  if (dragState === null) return;
  if (dragState.timer !== null) clearTimeout(dragState.timer);
  dragState = null;
});

ipcMain.handle('whale:hide', () => {
  win?.hide();
});

ipcMain.handle('whale:quit', () => {
  quitRequested = true;
  app.quit();
});

// ---- Sensors (cursor proximity, system idle, CPU load, fullscreen) --------
//
// All polls are main-process timers gated on (a) at least one renderer
// subscription and (b) the window being visible, so a hidden pet or sensors
// turned off never leaves a spinning timer.

const CURSOR_POLL_MS = 200;
const CPU_POLL_MS = 1000;

let cursorClients = 0;
let cursorTimer = null;
let fullscreenState = null;
let fullscreenTick = 0;

let cpuClients = 0;
let cpuTimer = null;
let cpuPrevTimes = null;

function windowUsable() {
  return win !== null && !win.isDestroyed() && win.isVisible();
}

// Fullscreen approximation: an exclusive-fullscreen app makes the display's
// workArea collapse onto the full bounds. Limitation: a desktop environment
// with an auto-hiding panel (or no panel at all) also reports
// workArea == bounds, so she may fade on panel-less setups; and a fullscreen
// window on another display is only detected via that display's workArea.
// Lock-screen events from powerMonitor are treated as fullscreen too.
function computeFullscreen() {
  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  return display.bounds.width - display.workArea.width < 4
    && display.bounds.height - display.workArea.height < 4;
}

function pushFullscreen(value) {
  if (fullscreenState === value) return;
  fullscreenState = value;
  if (windowUsable()) win.webContents.send('whale:fullscreen', value);
}

function cursorTick() {
  if (!windowUsable()) { stopSensorPolls(); return; }
  const point = screen.getCursorScreenPoint();
  const [winX, winY] = win.getPosition();
  let idleSeconds = 0;
  try { idleSeconds = powerMonitor.getSystemIdleTime(); } catch (err) { /* powerMonitor unavailable on some DEs; report 0 */ }
  win.webContents.send('whale:cursor', { x: point.x, y: point.y, winX, winY, idle: idleSeconds });
  // Reuse the cursor poll for a ~1 Hz fullscreen check.
  if (++fullscreenTick >= 5) {
    fullscreenTick = 0;
    pushFullscreen(computeFullscreen());
  }
}

function cpuTick() {
  if (!windowUsable()) { stopSensorPolls(); return; }
  const times = os.cpus().map((c) => c.times);
  let load = 0;
  if (cpuPrevTimes !== null && times.length === cpuPrevTimes.length) {
    let idle = 0;
    let total = 0;
    for (let i = 0; i < times.length; i++) {
      const prev = cpuPrevTimes[i];
      const cur = times[i];
      total += (cur.user - prev.user) + (cur.nice - prev.nice) + (cur.sys - prev.sys)
        + (cur.idle - prev.idle) + (cur.irq - prev.irq);
      idle += cur.idle - prev.idle;
    }
    if (total > 0) load = 1 - idle / total;
  }
  cpuPrevTimes = times;
  win.webContents.send('whale:cpu', load);
}

function startSensorPolls() {
  if (cursorClients > 0 && cursorTimer === null) {
    cursorTimer = setInterval(cursorTick, CURSOR_POLL_MS);
  }
  if (cpuClients > 0 && cpuTimer === null) {
    cpuPrevTimes = null;
    cpuTimer = setInterval(cpuTick, CPU_POLL_MS);
  }
}

function stopSensorPolls() {
  if (cursorTimer !== null) { clearInterval(cursorTimer); cursorTimer = null; }
  if (cpuTimer !== null) { clearInterval(cpuTimer); cpuTimer = null; }
}

function restartSensorPolls() {
  stopSensorPolls();
  if (windowUsable()) startSensorPolls();
}

ipcMain.handle('whale:cursor-subscribe', (_event, on) => {
  cursorClients = Math.max(0, cursorClients + (on ? 1 : -1));
  if (cursorClients === 0 && cpuClients === 0) fullscreenState = null;
  restartSensorPolls();
});

ipcMain.handle('whale:cpu-subscribe', (_event, on) => {
  cpuClients = Math.max(0, cpuClients + (on ? 1 : -1));
  restartSensorPolls();
});

// Lock screens read as fullscreen so she fades with the session.
powerMonitor.on('lock-screen', () => { pushFullscreen(true); });
powerMonitor.on('unlock-screen', () => {
  if (windowUsable()) pushFullscreen(computeFullscreen());
  else fullscreenState = null;
});
