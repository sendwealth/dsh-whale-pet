'use strict';

// Conversation memory for the main process. Persists to
// userData/memory.json as { facts: [{key,text,updatedAt}], turns: [...] }.
// Facts are extracted by lightweight regex patterns from user messages only
// (no LLM calls, to save tokens); turns are a rolling window of recent
// dialogue. All writes are debounced to disk.

const fs = require('fs');
const path = require('path');

const MAX_TURNS = 40;
const FLUSH_DELAY_MS = 1500;

// Fact patterns: [factKey, regex with one capture group]. First match wins
// per key; a later match replaces the stored fact (updatedAt refreshed).
const FACT_PATTERNS = [
  ['name', /(?:我叫|我的名字是|称呼我|call me|i am|i'm|my name is)\s*([\p{L}\p{N}_-]{1,20})/iu],
  ['project', /(?:在做|在写|在开发|负责|维护)\s*(?:一个|一项)?\s*([\p{L}\p{N}_.-]{2,30})/u],
  ['projectEn', /(?:working on|building|maintaining)\s+(?:the\s+|my\s+)?([\p{L}\p{N}_.-]{2,30})/iu],
  ['wakeTime', /(?:我)?(?:一般|通常|平时)?(?:每天)?(\d{1,2})\s*[点:.：]\s*(\d{2})?\s*(?:起床|起来|醒来)/],
  ['sleepTime', /(?:我)?(?:一般|通常|平时)?(?:每天)?(?:晚上|夜里)?(\d{1,2})\s*[点:.：]?\s*(\d{2})?\s*(?:睡觉|睡|休息)/],
  ['likes', /(?:我喜欢|我爱|我最喜欢|我最爱|i (?:really )?(?:like|love))\s*([\p{L}\p{N}，、和与\s]{1,30}?)(?=[。.!！?？]|$)/iu],
  ['dislikes', /(?:我讨厌|我不喜欢|i (?:hate|dislike))\s*([\p{L}\p{N}，、和与\s]{1,30}?)(?=[。.!！?？]|$)/iu],
  ['coffee', /(?:我)?(?:每天|经常|常)?(?:要|会|喝)(?:喝)?(\d{1,2})\s*(?:杯)?(?:咖啡|coffee)/i],
];

function normalizeMatch(key, match) {
  if (match === null || match[1] === undefined) return null;
  const raw = match[0];
  if (key === 'wakeTime' || key === 'sleepTime') {
    const h = Number(match[1]);
    const m = match[2] !== undefined ? Number(match[2]) : 0;
    if (!Number.isFinite(h) || h > 23 || m > 59) return null;
    const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return key === 'wakeTime' ? `主人通常 ${time} 起床` : `主人通常 ${time} 睡觉`;
  }
  if (key === 'coffee') {
    const cups = Number(match[1]);
    if (!Number.isFinite(cups) || cups < 1 || cups > 20) return null;
    return `主人每天要喝 ${cups} 杯咖啡`;
  }
  let text = String(match[1]).trim().replace(/\s+/g, ' ');
  // Chinese "在做 X(这个)项目" phrasing lets the project filler leak into
  // the capture; strip the trailing 指示词+项目 suffix so the stored fact
  // is the bare project name.
  text = text.replace(/(?:这个|该|此|一?个)?项目$/, '').trim();
  if (text.length < 1 || text.length > 40) return null;
  const labels = {
    name: '主人叫',
    project: '主人在做',
    projectEn: '主人在做',
    likes: '主人喜欢',
    dislikes: '主人不喜欢',
  };
  if (!(key in labels)) return null;
  return `${labels[key]} ${text}`;
}

class Memory {
  /**
   * @param {string} userDataDir Electron app.getPath('userData')
   */
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'memory.json');
    this.facts = [];
    this.turns = [];
    this.flushTimer = null;
    this.load();
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(data.facts)) {
        this.facts = data.facts.filter((f) => f && typeof f.key === 'string' && typeof f.text === 'string');
      }
      if (Array.isArray(data.turns)) {
        this.turns = data.turns.filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string');
      }
    } catch (err) {
      // Missing or corrupt memory.json: start fresh.
    }
  }

  scheduleFlush() {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file, JSON.stringify({ facts: this.facts, turns: this.turns }, null, 2));
      } catch (err) {
        // Disk failure: memory keeps working in memory; next write retries.
      }
    }, FLUSH_DELAY_MS);
  }

  /** Extract and upsert facts from a user message (rule-based only). */
  extractFacts(userText) {
    const text = String(userText || '');
    for (const [key, re] of FACT_PATTERNS) {
      const fact = normalizeMatch(key, text.match(re));
      if (fact === null) continue;
      const existing = this.facts.find((f) => f.key === key);
      if (existing) {
        if (existing.text === fact) { existing.updatedAt = Date.now(); continue; }
        existing.text = fact;
        existing.updatedAt = Date.now();
      } else {
        this.facts.push({ key, text: fact, updatedAt: Date.now() });
      }
      this.scheduleFlush();
    }
  }

  /** Append one dialogue turn; drops the oldest beyond MAX_TURNS. */
  addTurn(role, text) {
    if (role !== 'user' && role !== 'assistant') return;
    this.turns.push({ role, text: String(text || '').slice(0, 2000), at: Date.now() });
    while (this.turns.length > MAX_TURNS) this.turns.shift();
    this.scheduleFlush();
  }

  /** The last `n` turns as chat-completions message objects. */
  recentTurns(n = 8) {
    return this.turns.slice(-n).map((t) => ({ role: t.role, content: t.text }));
  }

  /** Facts joined for the system prompt tail ("" when none). */
  factsBlock() {
    if (this.facts.length === 0) return '';
    return '你知道的关于主人的事：\n' + this.facts.map((f) => `- ${f.text}`).join('\n');
  }

  flushNow() {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({ facts: this.facts, turns: this.turns }, null, 2));
    } catch (err) { /* best effort final flush */ }
  }
}

module.exports = { Memory };
