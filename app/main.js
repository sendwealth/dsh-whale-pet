'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');

/** Whether the current display server accepts transparent windows. */
let win = null;
let tray = null;
let quitRequested = false;

const WIN_WIDTH = 200;
const WIN_HEIGHT = 330;

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
}

function clampToWorkArea() {
  if (win === null || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  const area = screen.getDisplayNearestPoint({ x, y }).workArea;
  const nx = Math.min(Math.max(x, area.x), area.x + area.width - WIN_WIDTH);
  const ny = Math.min(Math.max(y, area.y), area.y + area.height - WIN_HEIGHT);
  if (nx !== x || ny !== y) win.setPosition(nx, ny);
}

app.whenReady().then(() => {
  createWindow();

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'whale-girl-small.png')).resize({ width: 32, height: 32 }));
  tray.setToolTip('鲸鱼娘桌宠 / Whale pet');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 / Show', click: () => { win?.show(); } },
    { type: 'separator' },
    { label: '退出 / Quit', click: () => { quitRequested = true; app.quit(); } },
  ]));

  // Closing the pet window only hides her; the tray stays. Quit from the tray.
  win.on('close', (event) => {
    if (!quitRequested) {
      event.preventDefault();
      win.hide();
    }
  });
  app.on('window-all-closed', () => { /* keep running in the tray */ });
});

// The renderer drives window dragging by absolute position: it reads the
// window position once at drag start, then moves to dragStart + pointer
// offset. Incremental deltas oscillate because moving the window shifts
// the pointer's client coordinates under pointer capture.
ipcMain.handle('whale:get-pos', () => {
  if (win === null || win.isDestroyed()) return [0, 0];
  return win.getPosition();
});

ipcMain.handle('whale:move-to', (_event, x, y) => {
  if (win === null || win.isDestroyed()) return;
  win.setPosition(Math.round(x), Math.round(y));
});

ipcMain.handle('whale:hide', () => {
  win?.hide();
});

ipcMain.handle('whale:quit', () => {
  quitRequested = true;
  app.quit();
});
