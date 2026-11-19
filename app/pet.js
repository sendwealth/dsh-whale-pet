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

// Drag by absolute window positioning: read the window position once at
// drag start, then move to dragStart + (pointer offset since press).
// Incremental deltas fight the window's own movement and jitter.
const DRAG_THRESHOLD = 4;
let drag = null;

pet.addEventListener('pointerdown', async (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  pet.setPointerCapture(event.pointerId);
  const [winX, winY] = await window.whalePet.getPos();
  drag = { moved: false, startClientX: event.clientX, startClientY: event.clientY, winX, winY };
});
pet.addEventListener('pointermove', (event) => {
  if (drag === null) return;
  const offsetX = event.clientX - drag.startClientX;
  const offsetY = event.clientY - drag.startClientY;
  if (!drag.moved && Math.hypot(offsetX, offsetY) < DRAG_THRESHOLD) return;
  if (!drag.moved) { drag.moved = true; pet.classList.add('dragging'); say(dict.drag); }
  window.whalePet.moveTo(drag.winX + offsetX, drag.winY + offsetY);
});
pet.addEventListener('pointerup', () => {
  const wasDrag = drag !== null && drag.moved;
  drag = null;
  pet.classList.remove('dragging');
  if (wasDrag) return;
  pet.classList.add('happy');
  say(pick(dict.pat));
  window.setTimeout(() => pet.classList.remove('happy'), 1600);
});

// Double-click hides her; the tray icon brings her back.
pet.addEventListener('dblclick', () => {
  say(dict.double);
  window.setTimeout(() => { window.whalePet.hide(); }, 1200);
});
