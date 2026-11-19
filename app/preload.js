'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('whalePet', {
  moveBy: (dx, dy) => ipcRenderer.invoke('whale:move-by', dx, dy),
  hide: () => ipcRenderer.invoke('whale:hide'),
  quit: () => ipcRenderer.invoke('whale:quit'),
});
