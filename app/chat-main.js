'use strict';

// Main-process chat agent for L3 real conversation. The DeepSeek API key
// never crosses into the renderer: it is read here from (in priority
// order) userData/config.json or the DEEPSEEK_API_KEY environment
// variable, and only request outcomes travel over IPC.

const fs = require('fs');
const path = require('path');
const { Memory } = require('./memory');

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const MODEL = 'deepseek-chat';
const MAX_TOKENS = 100;          // persona budget
const HARD_MAX_TOKENS = 150;     // never exceed, even if config changes
const REQUEST_TIMEOUT_MS = 30000;

const PERSONA = {
  zh: '你是鲸鱼娘，DeepSeek 官方吉祥物，浮在主人的桌面上陪主人。性格：温柔、元气、有点小傲娇，非常关心主人的工作和健康。规则：每次回复最多 2 句话；口语化、亲切；可以用"～"和少量颜文字；禁止长篇大论；禁止 markdown 格式；禁止自称 AI 助手或人工智能；你是一只鲸鱼娘。',
  en: 'You are the whale girl, the official DeepSeek mascot, floating on your master\'s desktop. Personality: gentle, energetic, a little tsundere, deeply caring about your master\'s work and health. Rules: reply in at most 2 sentences; conversational and warm; "~" and a few kaomoji are okay; no long lectures; no markdown; never call yourself an AI assistant; you are a whale girl.',
};

/**
 * Read { deepseekApiKey, deepseekBaseUrl } from userData/config.json.
 * @returns {{deepseekApiKey?: string, deepseekBaseUrl?: string}}
 */
function readUserConfig(userDataDir) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(userDataDir, 'config.json'), 'utf8'));
    const cfg = {};
    if (typeof data.deepseekApiKey === 'string' && data.deepseekApiKey.length > 0) cfg.deepseekApiKey = data.deepseekApiKey;
    if (typeof data.deepseekBaseUrl === 'string' && /^https?:\/\//.test(data.deepseekBaseUrl)) {
      cfg.deepseekBaseUrl = data.deepseekBaseUrl.replace(/\/+$/, '');
    }
    return cfg;
  } catch (err) {
    return {}; // missing or corrupt config.json: fall back to env
  }
}

function writeUserConfig(userDataDir, patch) {
  const file = path.join(userDataDir, 'config.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { /* start fresh */ }
  Object.assign(data, patch);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/**
 * Send one chat completion request. Exported for standalone Node testing.
 *
 * @param {object} args
 * @param {string} args.apiKey
 * @param {string} args.baseUrl
 * @param {{role:string,content:string}[]} args.messages full message list
 * @param {string} args.lang 'zh' | 'en'
 * @returns {Promise<{ok:true,reply:string} | {ok:false,code:string,message:string}>}
 */
async function requestChat({ apiKey, baseUrl, messages, lang }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: Math.min(MAX_TOKENS, HARD_MAX_TOKENS),
        temperature: 0.8,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, code: `http-${res.status}`, message: `DeepSeek API responded with status ${res.status}` };
    }
    const data = await res.json();
    const reply = data && data.choices && data.choices[0] && data.choices[0].message
      && typeof data.choices[0].message.content === 'string' ? data.choices[0].message.content.trim() : '';
    if (reply === '') return { ok: false, code: 'empty-reply', message: 'DeepSeek API returned an empty reply' };
    return { ok: true, reply };
  } catch (err) {
    const message = err.name === 'AbortError' ? 'DeepSeek API request timed out' : 'Cannot reach the DeepSeek API';
    return { ok: false, code: err.name === 'AbortError' ? 'timeout' : 'network', message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wire the chat IPC handlers into the running app.
 *
 * @param {object} deps
 * @param {import('electron').App} deps.app Electron app (for userData path)
 * @param {() => import('electron').BrowserWindow|null} deps.getWindow main pet window getter
 */
function registerChat({ app, getWindow }) {
  // Required lazily so requestChat stays testable under plain Node.
  const { BrowserWindow, ipcMain } = require('electron');
  const userDataDir = app.getPath('userData');
  const memory = new Memory(userDataDir);

  function credentials() {
    const cfg = readUserConfig(userDataDir);
    const apiKey = cfg.deepseekApiKey || process.env.DEEPSEEK_API_KEY || '';
    const baseUrl = cfg.deepseekBaseUrl || process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL;
    return { apiKey, baseUrl };
  }

  function systemPrompt(lang) {
    const persona = PERSONA[lang === 'zh' ? 'zh' : 'en'];
    const facts = memory.factsBlock();
    return facts === '' ? persona : `${persona}\n\n${facts}`;
  }

  let keyWindow = null;

  function openKeyDialog() {
    if (keyWindow !== null && !keyWindow.isDestroyed()) { keyWindow.focus(); return; }
    keyWindow = new BrowserWindow({
      width: 420,
      height: 200,
      title: 'DeepSeek API Key',
      resizable: false,
      minimizable: false,
      maximizable: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    keyWindow.setMenu(null);
    keyWindow.loadFile('key-dialog.html');
    keyWindow.on('closed', () => { keyWindow = null; });
  }

  // Renderer -> main: one conversation round. `payload` = { text, lang }.
  // The API key, config contents, and raw HTTP errors never travel back.
  ipcMain.handle('whale:chat', async (_event, payload) => {
    const text = payload && typeof payload.text === 'string' ? payload.text.trim().slice(0, 2000) : '';
    const lang = payload && payload.lang === 'zh' ? 'zh' : 'en';
    if (text === '') return { ok: false, code: 'empty-input', message: 'Nothing to send' };
    const { apiKey, baseUrl } = credentials();
    if (apiKey === '') return { ok: false, code: 'no-key', message: 'No DeepSeek API key configured' };

    memory.extractFacts(text);
    const result = await requestChat({
      apiKey,
      baseUrl,
      lang,
      messages: [{ role: 'system', content: systemPrompt(lang) }, ...memory.recentTurns(8), { role: 'user', content: text }],
    });
    if (result.ok) {
      memory.addTurn('user', text);
      memory.addTurn('assistant', result.reply);
    }
    return result;
  });

  // Availability probe; leaks only whether a key exists, never the key.
  ipcMain.handle('whale:has-api-key', () => credentials().apiKey !== '');

  // Tray-invoked key dialog: a tiny window with its own form (no native
  // prompt, no clipboard round-trip). The key is written by the main
  // process from the dialog's IPC; it never enters the pet renderer.
  ipcMain.handle('whale:open-key-dialog', () => { openKeyDialog(); return true; });
  ipcMain.handle('whale:set-api-key', (_event, key) => {
    const value = typeof key === 'string' ? key.trim() : '';
    if (value === '') return { ok: false };
    writeUserConfig(userDataDir, { deepseekApiKey: value });
    const win = getWindow();
    if (win !== null && !win.isDestroyed()) win.webContents.send('whale:key-configured');
    return { ok: true };
  });

  app.on('before-quit', () => memory.flushNow());

  return { memory, openKeyDialog };
}

module.exports = { registerChat, requestChat, readUserConfig, PERSONA };
