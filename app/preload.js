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
  // ---- L3 chat ----
  // One conversation round. The API key stays in the main process; only
  // { ok, reply } or { ok: false, code, message } comes back.
  chat: (text, lang) => ipcRenderer.invoke('whale:chat', { text, lang }),
  hasApiKey: () => ipcRenderer.invoke('whale:has-api-key'),
  setApiKey: (key) => ipcRenderer.invoke('whale:set-api-key', key),
  onKeyConfigured: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('whale:key-configured', handler);
    return () => { ipcRenderer.removeListener('whale:key-configured', handler); };
  },
  // Tray "Chat" entry asks the renderer to open the input line.
  onOpenChat: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('whale:open-chat', handler);
    return () => { ipcRenderer.removeListener('whale:open-chat', handler); };
  },
  // ---- L4 W2 agent bridge ----
  // The runtime path/env stay in the main process; only task receipts,
  // status phases, and display-only approval summaries travel over IPC.
  agentStartTask: (text) => ipcRenderer.invoke('whale:agent-start-task', { text }),
  agentApprove: () => ipcRenderer.invoke('whale:agent-approve'),
  agentReject: () => ipcRenderer.invoke('whale:agent-reject'),
  onAgentStatus: (listener) => {
    const handler = (_event, status) => listener(status);
    ipcRenderer.on('whale:agent-status', handler);
    return () => { ipcRenderer.removeListener('whale:agent-status', handler); };
  },
  onAgentApproval: (listener) => {
    const handler = (_event, summary) => listener(summary);
    ipcRenderer.on('whale:agent-approval', handler);
    return () => { ipcRenderer.removeListener('whale:agent-approval', handler); };
  },
});
