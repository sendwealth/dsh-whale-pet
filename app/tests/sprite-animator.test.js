'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const SpriteAnimator = require('../sprite-animator.js');

// Fake clock: `now()` is injectable so tick() needs no real timers.
function fakeClock() {
  let t = 0;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('sprite-animator: play emits frame 0, ticks advance one frame per 1/fps', () => {
  const clock = fakeClock();
  const frames = [];
  const anim = SpriteAnimator.create({ fps: 12, frameCount: 8, loop: true, now: clock.now, onFrame: (i) => frames.push(i) });
  anim.play();
  assert.deepEqual(frames, [0]);
  clock.advance(84); // 1000/12 ≈ 83.3ms per frame: past one boundary
  anim.tick();
  assert.deepEqual(frames, [0, 1]);
  clock.advance(84);
  anim.tick();
  assert.deepEqual(frames, [0, 1, 2]);
});

test('sprite-animator: a single tick catches up several elapsed frames', () => {
  const clock = fakeClock();
  const frames = [];
  const anim = SpriteAnimator.create({ fps: 10, frameCount: 5, loop: false, now: clock.now, onFrame: (i) => frames.push(i) });
  anim.play();
  clock.advance(350); // 3.5 frame durations at 100ms/frame
  anim.tick(); // catches up to frame 3; skipped 1 and 2 are not emitted
  assert.deepEqual(frames, [0, 3]);
});

test('sprite-animator: loop wraps around to frame 0', () => {
  const clock = fakeClock();
  const frames = [];
  const anim = SpriteAnimator.create({ fps: 10, frameCount: 3, loop: true, now: clock.now, onFrame: (i) => frames.push(i) });
  anim.play();
  for (let i = 0; i < 3; i += 1) { clock.advance(100); anim.tick(); }
  assert.deepEqual(frames, [0, 1, 2, 0]);
  assert.equal(anim.running, true);
});

test('sprite-animator: non-loop holds the last frame, then onFinish stops the run', () => {
  const clock = fakeClock();
  const frames = [];
  let finished = 0;
  const anim = SpriteAnimator.create({
    fps: 8, frameCount: 4, loop: false, now: clock.now,
    onFrame: (i) => frames.push(i),
    onFinish: () => { finished += 1; },
  });
  anim.play();
  const dur = 1000 / 8; // 125ms — think-group fps
  for (let i = 0; i < 3; i += 1) { clock.advance(dur); anim.tick(); }
  assert.deepEqual(frames, [0, 1, 2, 3]);
  assert.equal(finished, 0); // last frame still holding
  clock.advance(dur);
  anim.tick();
  assert.equal(finished, 1);
  assert.equal(anim.running, false);
  // Further ticks after finish are inert.
  clock.advance(1000);
  anim.tick();
  assert.equal(finished, 1);
  assert.deepEqual(frames, [0, 1, 2, 3]);
});

test('sprite-animator: fps is respected (8 vs 12 advance at different steps)', () => {
  const clock = fakeClock();
  const seen = [];
  const slow = SpriteAnimator.create({ fps: 8, frameCount: 3, loop: true, now: clock.now, onFrame: (i) => seen.push(i) });
  slow.play();
  clock.advance(100); // < 125ms: no advance at 8fps
  slow.tick();
  assert.deepEqual(seen, [0]);
  clock.advance(25); // now one full frame duration
  slow.tick();
  assert.deepEqual(seen, [0, 1]);

  const fast = SpriteAnimator.create({ fps: 12, frameCount: 3, loop: true, now: clock.now, onFrame: (i) => seen.push('f' + i) });
  assert.deepEqual(seen, [0, 1]); // slow only so far
  fast.play(); // emits 'f0'
  clock.advance(84); // ≥ 83.3ms: advances at 12fps
  fast.tick();
  assert.deepEqual(seen.slice(-2), ['f0', 'f1']);
});

test('sprite-animator: play() overrides fps/frameCount/loop/onFinish and restarts', () => {
  const clock = fakeClock();
  const frames = [];
  let finished = 0;
  const anim = SpriteAnimator.create({ fps: 10, frameCount: 2, loop: true, now: clock.now, onFrame: (i) => frames.push(i) });
  anim.play();
  clock.advance(100);
  anim.tick();
  assert.deepEqual(frames, [0, 1]);
  anim.play({ fps: 2, frameCount: 3, loop: false, onFinish: () => { finished += 1; } });
  assert.equal(anim.frame, 0);
  assert.equal(anim.fps, 2);
  clock.advance(500); // one frame at 2fps
  anim.tick();
  assert.deepEqual(frames, [0, 1, 0, 1]);
  clock.advance(1000); // two more frames: 2 then finish hold
  anim.tick();
  clock.advance(500);
  anim.tick();
  assert.equal(finished, 1);
  assert.equal(anim.running, false);
});

test('sprite-animator: stop() freezes; tick without play is inert', () => {
  const clock = fakeClock();
  const frames = [];
  const anim = SpriteAnimator.create({ fps: 10, frameCount: 4, loop: true, now: clock.now, onFrame: (i) => frames.push(i) });
  clock.advance(500);
  anim.tick(); // never played: nothing happens
  assert.deepEqual(frames, []);
  anim.play();
  anim.stop();
  clock.advance(1000);
  anim.tick();
  assert.deepEqual(frames, [0]);
  assert.equal(anim.running, false);
});
