'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// requestChat is pure Node (only global fetch). registerChat lazily
// requires('electron'), so a stub in require.cache makes it testable.
const { requestChat, registerChat } = require('../chat-main.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whale-chat-'));
}

async function withFetchMock(mock, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

// ---- requestChat: mocked fetch -------------------------------------------

test('requestChat returns the reply on ok responses', async () => {
  const seen = {};
  await withFetchMock(async (url, init) => {
    seen.url = url;
    seen.auth = init.headers.Authorization;
    seen.body = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '  嗨～  ' } }] }),
    };
  }, async () => {
    const res = await requestChat({ apiKey: 'sk-test', baseUrl: 'http://example.test', messages: [], lang: 'zh' });
    assert.deepEqual(res, { ok: true, reply: '嗨～' });
    assert.equal(seen.url, 'http://example.test/chat/completions');
    assert.equal(seen.auth, 'Bearer sk-test');
    assert.equal(seen.body.model, 'deepseek-chat');
    assert.ok(seen.body.max_tokens <= 150, 'persona token budget must stay capped');
  });
});

test('requestChat maps HTTP errors to http-<status>', async () => {
  await withFetchMock(async () => ({ ok: false, status: 401, json: async () => ({}) }), async () => {
    const res = await requestChat({ apiKey: 'sk-test', baseUrl: 'http://example.test', messages: [], lang: 'zh' });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'http-401');
  });
});

test('requestChat maps empty replies to empty-reply', async () => {
  await withFetchMock(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '   ' } }] }) }), async () => {
    const res = await requestChat({ apiKey: 'sk-test', baseUrl: 'http://example.test', messages: [], lang: 'zh' });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'empty-reply');
  });
});

test('requestChat maps fetch rejection to network without leaking the key', async () => {
  await withFetchMock(async () => { throw new TypeError('fetch failed'); }, async () => {
    const res = await requestChat({ apiKey: 'sk-SECRET-VALUE', baseUrl: 'http://example.test', messages: [], lang: 'zh' });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'network');
    assert.equal(res.message.includes('sk-SECRET-VALUE'), false);
  });
});

test('requestChat maps abort to timeout', async () => {
  await withFetchMock(async () => {
    // Reject immediately with AbortError, as a timed-out request would.
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  }, async () => {
    const res = await requestChat({ apiKey: 'sk-test', baseUrl: 'http://example.test', messages: [], lang: 'zh' });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'timeout');
  });
});

// ---- registerChat with a stubbed electron --------------------------------

/** Install a fake `electron` module and return the captured IPC handlers. */
function stubElectron() {
  const handlers = {};
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      ipcMain: { handle: (channel, handler) => { handlers[channel] = handler; } },
      BrowserWindow: class FakeBrowserWindow {
        constructor() { this.isDestroyed = () => false; }
        loadFile() {}
        setMenu() {}
        focus() {}
        on() {}
      },
    },
  };
  return handlers;
}

function makeFakeApp(userDataDir) {
  const listeners = {};
  return {
    getPath: (name) => (name === 'userData' ? userDataDir : '/tmp'),
    on: (event, cb) => { (listeners[event] ||= []).push(cb); },
  };
}

test('whale:chat returns no-key when neither config.json nor env has a key', async () => {
  const dir = tmpDir();
  const prevKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  const handlers = stubElectron();
  try {
    registerChat({ app: makeFakeApp(dir), getWindow: () => null });
    const res = await handlers['whale:chat'](null, { text: '你好', lang: 'zh' });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'no-key');
  } finally {
    if (prevKey !== undefined) process.env.DEEPSEEK_API_KEY = prevKey;
  }
});

test('whale:chat rejects empty input before any credentials lookup', async () => {
  const dir = tmpDir();
  const handlers = stubElectron();
  registerChat({ app: makeFakeApp(dir), getWindow: () => null });
  const res = await handlers['whale:chat'](null, { text: '   ', lang: 'zh' });
  assert.equal(res.code, 'empty-input');
});

test('whale:chat with a configured key returns network failure without leaking the key', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    deepseekApiKey: 'sk-SECRET-VALUE',
    deepseekBaseUrl: 'http://127.0.0.1:1', // nothing listens here
  }));
  const prevKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  const prevFetch = globalThis.fetch;
  // Keep the real fetch: the unreachable loopback address exercises the
  // genuine network-failure path end to end.
  try {
    const handlers = stubElectron();
    registerChat({ app: makeFakeApp(dir), getWindow: () => null });
    const res = await handlers['whale:chat'](null, { text: '你好', lang: 'zh' });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'network');
    assert.equal(JSON.stringify(res).includes('sk-SECRET-VALUE'), false);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey !== undefined) process.env.DEEPSEEK_API_KEY = prevKey;
  }
});

test('whale:has-api-key reports presence without returning the key', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ deepseekApiKey: 'sk-x' }));
  const handlers = stubElectron();
  registerChat({ app: makeFakeApp(dir), getWindow: () => null });
  assert.equal(await handlers['whale:has-api-key'](), true);
});
