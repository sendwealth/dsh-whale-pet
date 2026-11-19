'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('whalePet', {
  beginDrag: () => ipcRenderer.invoke('whale:begin-drag'),
  endDrag: () => ipcRenderer.invoke('whale:end-drag'),
  hide: () => ipcRenderer.invoke('whale:hide'),
  quit: () => ipcRenderer.invoke('whale:quit'),
});
