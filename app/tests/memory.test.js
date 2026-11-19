'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Memory } = require('../memory.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whale-memory-'));
}

// flushNow clears the debounce timer so the test process does not linger.
function teardown(mem) {
  mem.flushNow();
}

test('extractFacts: Chinese name, project, wake/sleep times, coffee', () => {
  const dir = tmpDir();
  const mem = new Memory(dir);
  mem.extractFacts('我叫小鲸，在做鲸鱼娘桌宠这个项目');
  // NOTE: the wakeTime pattern does not accept the "7点30分起床" phrasing
  // (missing 分 after minutes) — recorded in the test report as a suspected
  // bug; this test pins the currently supported forms only.
  mem.extractFacts('我每天7:30起床，晚上11点睡觉，每天要喝3杯咖啡');
  const texts = mem.facts.map((f) => f.text).sort();
  assert.ok(texts.includes('主人叫 小鲸'), texts.join('|'));
  assert.ok(texts.some((t) => t.startsWith('主人在做 鲸鱼娘桌宠')), texts.join('|'));
  assert.ok(texts.includes('主人通常 07:30 起床'), texts.join('|'));
  assert.ok(texts.includes('主人通常 11:00 睡觉'), texts.join('|'));
  assert.ok(texts.includes('主人每天要喝 3 杯咖啡'), texts.join('|'));
  teardown(mem);
});

test('extractFacts: English name, likes, dislikes', () => {
  const dir = tmpDir();
  const mem = new Memory(dir);
  mem.extractFacts("Hi! My name is Rowan.");
  mem.extractFacts('I really like coffee and ramen. I hate slow tests.');
  const texts = mem.facts.map((f) => f.text).sort();
  assert.ok(texts.includes('主人叫 Rowan'), texts.join('|'));
  assert.ok(texts.some((t) => t.startsWith('主人喜欢')), texts.join('|'));
  assert.ok(texts.some((t) => t.startsWith('主人不喜欢')), texts.join('|'));
  teardown(mem);
});

test('extractFacts: projectEn currently fails on ordinary English words (pinned; see report)', () => {
  const dir = tmpDir();
  const mem = new Memory(dir);
  mem.extractFacts("I'm working on the whale-pet project.");
  // The projectEn pattern lacks the `u` regex flag, so its \\p{L} class is a
  // literal character set and "whale-pet" does not match. Pins current
  // behavior; flagged as a suspected bug in the test report.
  assert.equal(mem.facts.some((f) => f.key === 'projectEn'), false);
  teardown(mem);
});

test('extractFacts: one fact per key, later match replaces earlier', () => {
  const dir = tmpDir();
  const mem = new Memory(dir);
  mem.extractFacts('我叫阿甲');
  mem.extractFacts('我叫阿乙');
  const names = mem.facts.filter((f) => f.key === 'name');
  assert.equal(names.length, 1);
  assert.equal(names[0].text, '主人叫 阿乙');
  teardown(mem);
});

test('extractFacts: invalid values are ignored', () => {
  const dir = tmpDir();
  const mem = new Memory(dir);
  mem.extractFacts('我25点起床');       // hour out of range
  mem.extractFacts('我每天要喝99杯咖啡'); // cups out of range
  mem.extractFacts(' completely unrelated text ');
  assert.equal(mem.facts.length, 0);
  teardown(mem);
});

test('addTurn caps turns at 40, dropping the oldest', () => {
  const dir = tmpDir();
  const mem = new Memory(dir);
  for (let i = 1; i <= 50; i++) mem.addTurn('user', `msg ${i}`);
  assert.equal(mem.turns.length, 40);
  assert.equal(mem.turns[0].text, 'msg 11');
  assert.equal(mem.turns[39].text, 'msg 50');
  teardown(mem);
});

test('addTurn rejects unknown roles; recentTurns returns the last n as messages', () => {
  const dir = tmpDir();
  const mem = new Memory(dir);
  mem.addTurn('system', 'nope');
  mem.addTurn('user', 'u1');
  mem.addTurn('assistant', 'a1');
  mem.addTurn('user', 'u2');
  assert.equal(mem.turns.length, 3);
  // u1 was pushed out: recentTurns(2) keeps chronological order.
  assert.deepEqual(mem.recentTurns(2), [
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'u2' },
  ]);
  // recentTurns(8) with fewer turns returns everything.
  assert.equal(mem.recentTurns(8).length, 3);
  teardown(mem);
});

test('factsBlock formats a bulleted block and is empty without facts', () => {
  const dir = tmpDir();
  const mem = new Memory(dir);
  assert.equal(mem.factsBlock(), '');
  mem.extractFacts('我叫小鲸');
  const block = mem.factsBlock();
  assert.ok(block.startsWith('你知道的关于主人的事：\n'), block);
  assert.ok(block.includes('- 主人叫 小鲸'), block);
  teardown(mem);
});

test('flushNow persists facts and turns; load restores them', () => {
  const dir = tmpDir();
  const mem = new Memory(dir);
  mem.extractFacts('我叫小鲸');
  mem.addTurn('user', 'hello');
  mem.flushNow();

  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'memory.json'), 'utf8'));
  assert.equal(raw.facts.length, 1);
  assert.equal(raw.turns.length, 1);

  const reloaded = new Memory(dir);
  assert.equal(reloaded.facts[0].text, '主人叫 小鲸');
  assert.equal(reloaded.recentTurns(8)[0].content, 'hello');
  teardown(reloaded);
});

test('debounced writes do not hit disk immediately; flushNow writes at once', () => {
  const dir = tmpDir();
  const mem = new Memory(dir);
  mem.addTurn('user', 'early');
  assert.equal(fs.existsSync(path.join(dir, 'memory.json')), false);
  mem.flushNow();
  assert.equal(fs.existsSync(path.join(dir, 'memory.json')), true);
  teardown(mem);
});

test('corrupt memory.json starts fresh instead of throwing', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'memory.json'), '{not json');
  const mem = new Memory(dir);
  assert.equal(mem.facts.length, 0);
  assert.equal(mem.turns.length, 0);
  teardown(mem);
});
