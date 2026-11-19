'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('whalePet', {
  beginDrag: () => ipcRenderer.invoke('whale:begin-drag'),
  endDrag: () => ipcRenderer.invoke('whale:end-drag'),
  hide: () => ipcRenderer.invoke('whale:hide'),
  quit: () => ipcRenderer.invoke('whale:quit'),
  getSettings: () => ipcRenderer.invoke('whale:get-settings'),
  setSetting: (key, value) => ipcRenderer.invoke('whale:set-setting', key, value),
  // Subscribe to tray-driven settings changes; returns an unsubscribe fn.
  onSettingsChanged: (listener) => {
    const handler = (_event, settings) => listener(settings);
    ipcRenderer.on('whale:settings-changed', handler);
    return () => { ipcRenderer.removeListener('whale:settings-changed', handler); };
  },
});
