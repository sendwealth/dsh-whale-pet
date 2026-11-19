'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');

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
  win.on('closed', () => {
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

app.whenReady().then(() => {
  createWindow();

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
let settings = { muted: false, talkativeness: 'normal' };

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
      ],
    },
    { label: '显示 / Show', click: () => { win?.show(); } },
    { type: 'separator' },
    { label: '退出 / Quit', click: () => { quitRequested = true; app.quit(); } },
  ]));
}

function applySetting(key, value) {
  settings[key] = value;
  rebuildTrayMenu();
  if (win !== null && !win.isDestroyed()) win.webContents.send('whale:settings-changed', settings);
}

ipcMain.handle('whale:get-settings', () => settings);

ipcMain.handle('whale:set-setting', (_event, key, value) => {
  if (key !== 'muted' && key !== 'talkativeness') return;
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
