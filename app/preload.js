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
  // Sensors: subscribe toggles the main-process poll; data events below
  // deliver samples. All subscriptions return an unsubscribe fn.
  subscribeCursor: (on) => ipcRenderer.invoke('whale:cursor-subscribe', on),
  subscribeCpu: (on) => ipcRenderer.invoke('whale:cpu-subscribe', on),
  onCursorData: (listener) => {
    const handler = (_event, data) => listener(data);
    ipcRenderer.on('whale:cursor', handler);
    return () => { ipcRenderer.removeListener('whale:cursor', handler); };
  },
  onCpuLoad: (listener) => {
    const handler = (_event, load) => listener(load);
    ipcRenderer.on('whale:cpu', handler);
    return () => { ipcRenderer.removeListener('whale:cpu', handler); };
  },
  onFullscreenChanged: (listener) => {
    const handler = (_event, fullscreen) => listener(fullscreen);
    ipcRenderer.on('whale:fullscreen', handler);
    return () => { ipcRenderer.removeListener('whale:fullscreen', handler); };
  },
});
