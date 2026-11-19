'use strict';

const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const pet = document.getElementById('pet');

const DICTS = {
  zh: {
    greet: '嗨～我是鲸鱼娘，已经浮在桌面上了哦！',
    idle: [
      '呼——唔……主人在忙什么呢？',
      '我刚刚在深海里打了个盹～',
      '工作累了吗？记得休息一下眼睛哦。',
      '今天的风好适合游泳呀～',
      '有什么想让我陪你的吗？',
    ],
    pat: [
      '呀！被摸头了……好开心～',
      '噗噜噗噜～再摸一下嘛！',
      '你、你别乱摸啦……不过好舒服～',
      '嘿嘿，我最喜欢你啦！',
    ],
    drag: '哇——飞起来了！放在哪里好呢？',
    double: '下次想找我，就从托盘图标里点出来哦～',
  },
  en: {
    greet: 'Hi! I am the whale girl, floating on your desktop now!',
    idle: [
      'Hmm… what are you working on?',
      'I just took a nap in the deep sea.',
      'Tired of working? Rest your eyes for a bit.',
      'Today the wind is perfect for swimming.',
      'Want some company while you work?',
    ],
    pat: [
      'Eek! Head pats… I love them!',
      'Blub blub~ one more pat, please!',
      'Hey, no touching… okay, maybe a little more.',
      'Hehe, you are my favorite!',
    ],
    drag: 'Wah—I can fly! Where should I sit?',
    double: 'To bring me back later, click the tray icon.',
  },
};
const dict = (navigator.language ?? 'en').startsWith('zh') ? DICTS.zh : DICTS.en;

function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

let bubbleTimer = 0;
function say(text) {
  bubbleText.textContent = text;
  bubble.hidden = false;
  window.clearTimeout(bubbleTimer);
  bubbleTimer = window.setTimeout(() => { bubble.hidden = true; }, 5200);
}

say(dict.greet);
window.setInterval(() => {
  if (!bubble.hidden || pet.classList.contains('dragging')) return;
  say(pick(dict.idle));
}, 18000);

// The renderer only reports drag start and end; the main process tracks
// the real OS cursor, so window-relative coordinates never fight it.
const DRAG_THRESHOLD = 4;
let press = null;
let dragging = false;

pet.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
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
pet.addEventListener('pointerup', async () => {
  if (dragging) {
    dragging = false;
    pet.classList.remove('dragging');
    await window.whalePet.endDrag();
    return;
  }
  press = null;
  pet.classList.add('happy');
  say(pick(dict.pat));
  window.setTimeout(() => pet.classList.remove('happy'), 1600);
});

// Double-click hides her; the tray icon brings her back.
pet.addEventListener('dblclick', () => {
  say(dict.double);
  window.setTimeout(() => { window.whalePet.hide(); }, 1200);
});
