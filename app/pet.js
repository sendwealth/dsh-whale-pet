'use strict';

const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const pet = document.getElementById('pet');
const petImg = document.getElementById('pet-img');

// Condition-tagged lines. `when` is a list of context tags (time slot,
// long-idle, weekday/weekend); entries without `when` fit any context.
const DICTS = {
  zh: {
    greet: '嗨～我是鲸鱼娘，已经浮在桌面上了哦！',
    morningGreet: [
      '早上好～昨晚在桌面睡得可香了，今天也一起加油吧！',
      '唔哇……早安！海面的阳光好刺眼呀～',
    ],
    woken: [
      '唔……Zzz……人家在睡觉啦……',
      '别吵嘛……再吵我要生气了哦……',
    ],
    drag: '哇——飞起来了！放在哪里好呢？',
    double: '下次想找我，就从托盘图标里点出来哦～',
    idle: [
      { t: '呼——唔……主人在忙什么呢？' },
      { t: '我刚刚在深海里打了个盹～' },
      { t: '工作累了吗？记得休息一下眼睛哦。' },
      { t: '有什么想让我陪你的吗？' },
      { t: '今天的风好适合游泳呀～', when: ['morning', 'afternoon'] },
      { t: '午后的阳光晒得尾巴暖洋洋的～', when: ['afternoon'] },
      { t: '晚上的桌面好安静，适合发呆……', when: ['evening'] },
      { t: '夜深了，主人的屏幕光像月光一样……', when: ['night'] },
      { t: '主人是不是把我忘了……戳我一下嘛。', when: ['long-idle'] },
      { t: '连鲸鱼都知道，工作日要好好干活哦。', when: ['weekday'] },
      { t: '周末就该浮在海面上什么都不想～', when: ['weekend'] },
    ],
    head: [
      '呀！被摸头了……好开心～',
      '噗噜噗噜～再摸一下嘛！',
      '嘿嘿，我最喜欢你啦！',
    ],
    face: [
      '你、你盯着人家的脸看什么啦……',
      '呜……脸被摸红了啦……',
      '别、别捏脸颊呀……好害羞……',
    ],
    belly: [
      '噗咚！不许戳肚子！',
      '再戳我要喷水了哦！',
      '肚子是鲸鱼娘的逆鳞！生气了！',
    ],
    mouseApproach: [
      { t: '呀！你悄悄靠近想干什么～' },
      { t: '哇！来得好快！有什么事吗？', when: ['morning', 'afternoon'] },
      { t: '深夜突袭……吓我一跳啦！', when: ['night'] },
    ],
    mouseNear: [
      { t: '就一直停在这里看着我……我帮你盯着屏幕好啦。' },
      { t: '你在我旁边待了好久，是在陪我吗？', when: ['evening', 'night'] },
    ],
    doze: [
      { t: '主人好久没动了……我先眯一会儿……', when: ['weekday'] },
      { t: '大家都去哪儿了呀……Zzz……', when: ['weekend'] },
      { t: '安静得像深海……我打个小盹哦。' },
    ],
    cpuBusy: [
      { t: '呜……电脑好烫，我仿佛在热汤里游泳！' },
      { t: '主机在喘粗气！要不要歇一歇再战？', when: ['weekday'] },
      { t: '风扇声好吵，我都有点担心你了……', when: ['night'] },
    ],
  },
  en: {
    greet: 'Hi! I am the whale girl, floating on your desktop now!',
    morningGreet: [
      'Good morning~ I slept so well on your desktop. Let\'s do our best today!',
      'Mmwa… morning! The sunlight on the sea surface is so bright~',
    ],
    woken: [
      'Mmh… Zzz… I was sleeping…',
      'Stop it… keep poking and I will get grumpy…',
    ],
    drag: 'Wah—I can fly! Where should I sit?',
    double: 'To bring me back later, click the tray icon.',
    idle: [
      { t: 'Hmm… what are you working on?' },
      { t: 'I just took a nap in the deep sea.' },
      { t: 'Tired of working? Rest your eyes for a bit.' },
      { t: 'Want some company while you work?' },
      { t: 'Today the wind is perfect for swimming.', when: ['morning', 'afternoon'] },
      { t: 'The afternoon sun makes my tail all warm~', when: ['afternoon'] },
      { t: 'The desktop is so quiet at night, nice for daydreaming…', when: ['evening'] },
      { t: 'It is late… your screen glows like moonlight…', when: ['night'] },
      { t: 'Did you forget about me…? Poke me!', when: ['long-idle'] },
      { t: 'Even whales know: work hard on weekdays.', when: ['weekday'] },
      { t: 'Weekends are for floating on the sea, thinking of nothing~', when: ['weekend'] },
    ],
    head: [
      'Eek! Head pats… I love them!',
      'Blub blub~ one more pat, please!',
      'Hehe, you are my favorite!',
    ],
    face: [
      'W-why are you staring at my face…',
      'Aww… you made my cheeks red…',
      'D-do not pinch my cheeks… so embarrassing…',
    ],
    belly: [
      'Boing! No poking my belly!',
      'Poke me again and I will spout water!',
      'The belly is a whale girl\'s weak spot! Hmph!',
    ],
    mouseApproach: [
      { t: 'Eek! Sneaking up on me~ what is it?' },
      { t: 'Whoa, that was fast! Anything I can help with?', when: ['morning', 'afternoon'] },
      { t: 'A midnight ambush… you startled me!', when: ['night'] },
    ],
    mouseNear: [
      { t: 'You have been hovering here a while… I will keep the screen company.' },
      { t: 'Staying by my side this long? That is sweet.', when: ['evening', 'night'] },
    ],
    doze: [
      { t: 'No one has moved for ages… just a tiny nap…', when: ['weekday'] },
      { t: 'Where did everybody go… Zzz…', when: ['weekend'] },
      { t: 'Quiet as the deep sea… dozing off for a bit.' },
    ],
    cpuBusy: [
      { t: 'Phew… the computer is boiling, I feel like swimming in soup!' },
      { t: 'Your PC is panting! Maybe take a breather?', when: ['weekday'] },
      { t: 'The fans are so loud… I am a little worried about you.', when: ['night'] },
    ],
  },
};
const dict = (navigator.language ?? 'en').startsWith('zh') ? DICTS.zh : DICTS.en;
const dictLang = dict === DICTS.zh ? 'zh' : 'en';

// L3 fallbacks: local lines when the API is unreachable or chat is off.
const CHAT_DICTS = {
  zh: {
    fail: ['（呜……脑子里进海水了，连不上了……）', '（噗噜……联系不上深海的海流，等一下再聊嘛）'],
    off: '（现在不想用脑子聊天啦，摸摸我就好～）',
    noKey: '（还没有配置 API Key 哦，托盘里可以设置～）',
  },
  en: {
    fail: ['(Blub… seawater got into my head, I cannot connect…)', '(Cannot reach the deep-sea current… let us chat later?)'],
    off: '(I am off-duty for chatting now—pat me instead~)',
    noKey: '(No API key configured yet—set one from the tray menu~)',
  },
};
const chatDict = CHAT_DICTS[dictLang];

function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

const LONG_IDLE_MS = 5 * 60 * 1000;
let lastInteract = Date.now();

function contextTags() {
  const now = new Date();
  const h = now.getHours();
  let slot;
  if (h >= 5 && h < 11) slot = 'morning';
  else if (h < 18) slot = 'afternoon';
  else if (h < 23) slot = 'evening';
  else slot = 'night';
  const tags = [slot, now.getDay() === 0 || now.getDay() === 6 ? 'weekend' : 'weekday'];
  if (Date.now() - lastInteract > LONG_IDLE_MS) tags.push('long-idle');
  return tags;
}

let lastLine = '';
function pickCtx(list) {
  const tags = contextTags();
  const fit = list.filter((e) => e.when === undefined || e.when.some((w) => tags.includes(w)));
  const pool = (fit.length > 0 ? fit : list.filter((e) => e.when === undefined)).filter((e) => e.t !== lastLine);
  const chosen = pick(pool.length > 0 ? pool : list);
  lastLine = chosen.t;
  return chosen.t;
}

let bubbleTimer = 0;
// Set while an approval card is up; ordinary bubbles step aside.
let approvalUp = false;
/**
 * Show a bubble for `ms` (default 5.2 s; chat replies stay 10 s).
 * @param {string} text
 * @param {number} [ms]
 */
function say(text, ms = 5200) {
  if (approvalUp) return;
  bubbleText.textContent = text;
  bubbleText.classList.remove('typing');
  bubble.hidden = false;
  window.clearTimeout(bubbleTimer);
  bubbleTimer = window.setTimeout(() => { bubble.hidden = true; }, ms);
}

// ---- State machine wiring -------------------------------------------------

const machine = WhaleStates.create({
  onEnter(name) {
    const css = WhaleStates.STATES[name].css;
    if (css !== null) pet.classList.add(css);
    // Any real state change ends a sensor-induced doze/lean/worry pose.
    pet.classList.remove('doze', 'leaning', 'worried');
  },
  onExit(name) {
    const css = WhaleStates.STATES[name].css;
    if (css !== null) pet.classList.remove(css);
  },
});

function isNight() {
  const h = new Date().getHours();
  return h >= 23 || h < 7;
}

// Morning greeting fires on the first interaction of the morning; remember
// the greeted date so a relaunch does not repeat it.
let morningGreetPending = false;
function refreshMorningPending() {
  const h = new Date().getHours();
  const today = new Date().toDateString();
  const greeted = window.localStorage.getItem('whale-morning-date');
  if (h >= 7 && h < 11 && greeted !== today) morningGreetPending = true;
}
refreshMorningPending();
function markMorningGreeted() {
  morningGreetPending = false;
  window.localStorage.setItem('whale-morning-date', new Date().toDateString());
}

// Sleep rhythm: fall asleep late at night, wake up after 07:00.
window.setInterval(() => {
  if (isNight()) {
    if (machine.current !== 'sleep') {
      window.clearTimeout(bubbleTimer);
      bubble.hidden = true;
      machine.request('sleep', { force: true });
    }
  } else if (machine.current === 'sleep') {
    machine.request('idle', { force: true });
    refreshMorningPending();
  }
}, 15000);
if (isNight()) machine.request('sleep', { force: true });

let wakeTimer = 0;
// Interactions wake her briefly at night, then she goes back to sleep.
function wakeFromSleep() {
  window.clearTimeout(wakeTimer);
  machine.request('angry', { force: true });
  say(pick(dict.woken));
  wakeTimer = window.setTimeout(() => {
    window.clearTimeout(bubbleTimer);
    bubble.hidden = true;
    machine.request('sleep', { force: true });
  }, machine.minDur('angry'));
}

function zoneFor(y) {
  const rect = petImg.getBoundingClientRect();
  const ratio = (y - rect.top) / rect.height;
  if (ratio < 1 / 3) return { state: 'happy', lines: dict.head };
  if (ratio < 2 / 3) return { state: 'shy', lines: dict.face };
  return { state: 'angry', lines: dict.belly };
}

// ---- Settings (renderer-owned, synced with the tray via IPC) --------------

const SETTINGS_KEY = 'whale-pet-settings';
const TALK_INTERVALS = { talkative: 9000, normal: 18000, quiet: 45000 };
const settings = { muted: false, talkativeness: 'normal', sensors: true, chat: true, agent: false };
try { Object.assign(settings, JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (err) { /* fall back to defaults on corrupt storage */ }
if (!(settings.talkativeness in TALK_INTERVALS)) settings.talkativeness = 'normal';

function saveSettings() {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
function pushSetting(key, value) {
  settings[key] = value;
  saveSettings();
  window.whalePet.setSetting(key, value);
}

// Push the persisted settings once so the tray checkmarks match.
for (const key of Object.keys(settings)) window.whalePet.setSetting(key, settings[key]);
window.whalePet.onSettingsChanged((remote) => {
  Object.assign(settings, remote);
  saveSettings();
  Sensors.setEnabled(settings.sensors !== false);
  updateModeTag();
  scheduleIdleChatter();
});

// ---- Idle chatter ----------------------------------------------------------

// While a fullscreen app (or the lock screen) owns the display she fades out
// and stays quiet until it goes away.
let fullscreenHidden = false;

// True while a chat input is open or a reply is pending/typing; idle
// chatter waits it out.
let chatting = false;

let idleTimer = 0;
function scheduleIdleChatter() {
  window.clearTimeout(idleTimer);
  if (fullscreenHidden) return;
  idleTimer = window.setTimeout(idleChatter, TALK_INTERVALS[settings.talkativeness]);
}
function idleChatter() {
  if (fullscreenHidden || chatting || agentBusy() || !bubble.hidden || machine.current === 'sleep' || pet.classList.contains('dragging')) {
    scheduleIdleChatter();
    return;
  }
  if (!settings.muted) {
    say(pickCtx(dict.idle));
    machine.request('talk');
  }
  scheduleIdleChatter();
}

// ---- Pointer interactions --------------------------------------------------

// The renderer only reports drag start and end; the main process tracks
// the real OS cursor, so window-relative coordinates never fight it.
const DRAG_THRESHOLD = 4;
let press = null;
let dragging = false;

pet.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || fullscreenHidden) return;
  event.preventDefault();
  pet.setPointerCapture(event.pointerId);
  press = { x: event.clientX, y: event.clientY };
});
pet.addEventListener('pointermove', (event) => {
  if (press === null || dragging) return;
  const dx = event.clientX - press.x;
  const dy = event.clientY - press.y;
  if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
  dragging = true;
  press = null;
  pet.classList.add('dragging');
  say(dict.drag);
  window.whalePet.beginDrag();
});
pet.addEventListener('pointerup', async (event) => {
  lastInteract = Date.now();
  if (dragging) {
    dragging = false;
    pet.classList.remove('dragging');
    await window.whalePet.endDrag();
    return;
  }
  press = null;
  if (machine.current === 'sleep') { wakeFromSleep(); return; }
  if (morningGreetPending) {
    markMorningGreeted();
    machine.request('talk', { force: true });
    say(pick(dict.morningGreet));
    return;
  }
  const zone = zoneFor(event.clientY);
  machine.request(zone.state);
  say(pick(zone.lines));
});
pet.addEventListener('pointercancel', async () => {
  if (dragging) {
    dragging = false;
    pet.classList.remove('dragging');
    await window.whalePet.endDrag();
  }
  press = null;
});

// Double-click hides her; the tray icon brings her back.
pet.addEventListener('dblclick', () => {
  say(dict.double);
  window.setTimeout(() => { window.whalePet.hide(); }, 1200);
});

say(dict.greet);
scheduleIdleChatter();

// ---- Sensors (L2: local system awareness) ----------------------------------

// A lean pose lasts a few seconds on its own, independent of the machine.
let leanTimer = 0;
function leanIn() {
  window.clearTimeout(leanTimer);
  pet.classList.add('leaning');
  leanTimer = window.setTimeout(() => { pet.classList.remove('leaning'); }, 6000);
}

Sensors.on('mouse-approach', () => {
  if (fullscreenHidden || machine.current === 'sleep') return;
  machine.request('curious');
  say(pickCtx(dict.mouseApproach));
});

Sensors.on('mouse-near', () => {
  if (fullscreenHidden || machine.current === 'sleep') return;
  machine.request('curious');
  leanIn();
  say(pickCtx(dict.mouseNear));
});

// Long system idle makes her doze; the real night sleep (higher priority,
// forced by the sleep rhythm interval) still wins over this visual doze.
Sensors.on('idle-long', () => {
  if (fullscreenHidden || machine.current === 'sleep' || pet.classList.contains('doze')) return;
  pet.classList.add('doze');
  say(pickCtx(dict.doze));
});

Sensors.on('cpu-busy', () => {
  if (fullscreenHidden || machine.current === 'sleep') return;
  pet.classList.add('worried');
  say(pickCtx(dict.cpuBusy));
});

Sensors.on('cpu-calm', () => {
  pet.classList.remove('worried');
});

Sensors.on('fullscreen-changed', (fullscreen) => {
  fullscreenHidden = fullscreen;
  if (fullscreen) {
    window.clearTimeout(idleTimer);
    pet.classList.add('gone');
  } else {
    pet.classList.remove('gone');
    scheduleIdleChatter();
  }
});

if (settings.sensors !== false) Sensors.setEnabled(true);

// ---- L3 chat: talk to her for real -----------------------------------------

const chatInput = document.getElementById('chat-input');
const chatText = document.getElementById('chat-text');
const chatSend = document.getElementById('chat-send');
const dots = document.getElementById('dots');

let typewriterTimer = 0;
let chatSeq = 0; // increments per send; stale replies are dropped

function stopTypewriter() {
  window.clearInterval(typewriterTimer);
  typewriterTimer = 0;
}

function showThinking() {
  stopTypewriter();
  bubbleText.textContent = '';
  bubbleText.classList.remove('typing');
  dots.hidden = false;
  bubble.hidden = false;
  window.clearTimeout(bubbleTimer);
}

function endConversationBubble(ms) {
  chatting = false;
  dots.hidden = true;
  window.clearTimeout(bubbleTimer);
  bubbleTimer = window.setTimeout(() => { bubble.hidden = true; scheduleIdleChatter(); }, ms);
}

function showChatReply(text) {
  dots.hidden = true;
  bubbleText.textContent = '';
  bubbleText.classList.add('typing');
  bubble.hidden = false;
  let i = 0;
  typewriterTimer = window.setInterval(() => {
    i += 1;
    bubbleText.textContent = text.slice(0, i);
    if (i >= text.length) {
      bubbleText.classList.remove('typing');
      stopTypewriter();
      // The full reply stays readable for a while after the typing ends.
      endConversationBubble(10000);
    }
  }, 35);
}

function closeChatInput() {
  chatInput.hidden = true;
  if (chatting && dots.hidden && typewriterTimer === 0) chatting = false;
}

function openChatInput() {
  if (fullscreenHidden || machine.current === 'sleep') return;
  // Agent mode reuses the input even when persona chat is off.
  if (settings.agent === false && settings.chat === false) {
    machine.request('talk', { force: true });
    say(chatDict.off);
    return;
  }
  chatting = true;
  chatInput.hidden = false;
  chatText.value = '';
  chatText.focus();
}

async function sendChat() {
  const text = chatText.value.trim();
  if (text === '' || !chatting) return;
  chatInput.hidden = true;
  chatText.value = '';
  lastInteract = Date.now();
  machine.request('talk', { force: true });
  // Agent mode (L4 W2): the input dispatches a task to the DSH runtime
  // instead of the persona chat; her later phase changes tell the story.
  if (settings.agent) {
    const result = await window.whalePet.agentStartTask(text);
    if (result && result.ok) {
      say(dictLang === 'zh' ? '收到任务！我去忙啦～' : 'Got it! On it~', 5000);
    } else {
      say(dictLang === 'zh' ? '（助手还没连上……托盘“设置 → 连接助手”里开启哦）' : '(The agent is not connected—enable it under tray Settings.)', 8000);
      chatting = false;
      scheduleIdleChatter();
    }
    return;
  }
  showThinking();
  const seq = ++chatSeq;
  const result = await window.whalePet.chat(text, dictLang);
  if (seq !== chatSeq) return; // a newer send superseded this round
  if (result && result.ok) {
    showChatReply(result.reply.slice(0, 600));
  } else {
    const line = result && result.code === 'no-key' ? chatDict.noKey : pick(chatDict.fail);
    say(line, 10000);
    chatting = false;
    scheduleIdleChatter();
  }
}

chatSend.addEventListener('click', sendChat);
chatText.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); sendChat(); }
  else if (event.key === 'Escape') { event.preventDefault(); closeChatInput(); }
});

// Ctrl+Shift+K opens the chat input from anywhere over the pet.
window.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.shiftKey && (event.key === 'K' || event.key === 'k')) {
    event.preventDefault();
    if (chatInput.hidden) openChatInput();
    else chatText.focus();
  }
});

// Tray menu: "和她说话 / Chat".
window.whalePet.onOpenChat(() => { openChatInput(); });
// After a key is configured, tell her she can think again.
window.whalePet.onKeyConfigured(() => {
  if (!chatInput.hidden) return;
  machine.request('talk', { force: true });
  say(dictLang === 'zh' ? '（海流接通了！现在可以好好聊天啦～）' : '(The current is connected! Now we can really chat~)', 6000);
});

// ---- L4 W2: agent avatar + approval bubble ----------------------------------

const approvalCard = document.getElementById('approval-card');
const approvalTitle = document.getElementById('approval-title');
const approvalBody = document.getElementById('approval-body');
const approvalAllow = document.getElementById('approval-allow');
const approvalDeny = document.getElementById('approval-deny');
const modeTag = document.getElementById('chat-mode');

const AGENT_DICT = {
  zh: {
    modeChat: '聊天', modeTask: '派任务',
    approveTitle: '需要你批准', questionTitle: '她有问题问你',
    allow: '允许一次', deny: '拒绝',
    done: '任务完成了～',
    offline: '（和助手的连接断开了……托盘里可以重新开启）',
    crashed: '（助手进程退出了……需要的话从托盘重新连接哦）',
    errorPrefix: '（助手出错了：',
    missingKey: '（任务的深海海流没接通——runtime 缺少 DEEPSEEK_API_KEY，没法真的干活哦）',
  },
  en: {
    modeChat: 'chat', modeTask: 'task',
    approveTitle: 'Approval needed', questionTitle: 'She has a question',
    allow: 'Allow once', deny: 'Deny',
    done: 'Task done~',
    offline: '(Lost the connection to the agent… reconnect from the tray.)',
    crashed: '(The agent runtime exited… reconnect from the tray if needed.)',
    errorPrefix: '(Agent error: ',
    missingKey: '(The deep-sea current is not connected—the runtime has no DEEPSEEK_API_KEY, so it cannot really work.)',
  },
};
const ad = AGENT_DICT[dictLang];

let agentPhase = 'offline';
const agentNoticed = { offline: false, crashed: false, error: false };

function agentBusy() {
  return agentPhase === 'connecting' || agentPhase === 'running'
    || agentPhase === 'waiting-approval' || agentPhase === 'waiting-question';
}

function updateModeTag() {
  modeTag.textContent = settings.agent ? ad.modeTask : ad.modeChat;
  modeTag.classList.toggle('task', settings.agent === true);
  chatText.placeholder = settings.agent
    ? (dictLang === 'zh' ? '给她派个任务…' : 'Give her a task…')
    : '和她说点什么… / Say something…';
}
updateModeTag();

function hideBubbleNow() {
  window.clearTimeout(bubbleTimer);
  stopTypewriter();
  dots.hidden = true;
  bubble.hidden = true;
}

function showApprovalCard(summary) {
  hideBubbleNow();
  approvalTitle.textContent = summary.kind === 'question' ? ad.questionTitle : ad.approveTitle;
  const lines = [];
  if (summary.kind !== 'question' && summary.toolName) lines.push(`🔧 ${summary.toolName}`);
  if (summary.reason) lines.push(summary.kind === 'question' ? `💬 ${summary.reason}` : summary.reason);
  if (summary.question) lines.push(`❓ ${summary.question}`);
  if (lines.length === 0) lines.push(summary.kind === 'question' ? '…' : '…');
  approvalBody.textContent = lines.join('\n');
  approvalUp = true;
  approvalCard.hidden = false;
}

function hideApprovalCard() {
  approvalCard.hidden = true;
  approvalUp = false;
}

approvalAllow.addEventListener('click', async () => {
  hideApprovalCard();
  await window.whalePet.agentApprove();
});
approvalDeny.addEventListener('click', async () => {
  hideApprovalCard();
  await window.whalePet.agentReject();
});

// Summary pushes arrive next to (or before) the waiting-* phase flip; the
// card is the single source of truth for what is pending.
window.whalePet.onAgentApproval((summary) => { showApprovalCard(summary); });

window.whalePet.onAgentStatus((status) => {
  const prev = agentPhase;
  agentPhase = status.phase;
  // Working pose only while the agent is actually running.
  pet.classList.toggle('working', status.phase === 'running');
  if (status.phase === 'waiting-approval' || status.phase === 'waiting-question') {
    hideBubbleNow();
    machine.request('curious', { force: true });
  } else if ((prev === 'waiting-approval' || prev === 'waiting-question')
    && status.phase !== 'waiting-approval' && status.phase !== 'waiting-question') {
    hideApprovalCard();
  }
  if (status.done) {
    machine.request('talk', { force: true });
    say(ad.done, 8000);
  }
  if (status.error) {
    const line = status.error.code === 'MISSING_CREDENTIAL'
      ? ad.missingKey
      : `${ad.errorPrefix}${status.error.code})`;
    say(line, 10000);
  }
  // Offline/error/crash get one bubble each, never a stream of them.
  if (status.phase === 'offline' && !agentNoticed.offline) {
    agentNoticed.offline = true;
    agentNoticed.crashed = false;
    if (prev !== 'offline') say(status.crashed ? ad.crashed : ad.offline, 8000);
  }
});
