'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('whalePet', {
  getPos: () => ipcRenderer.invoke('whale:get-pos'),
  moveTo: (x, y) => ipcRenderer.invoke('whale:move-to', x, y),
  hide: () => ipcRenderer.invoke('whale:hide'),
  quit: () => ipcRenderer.invoke('whale:quit'),
});
