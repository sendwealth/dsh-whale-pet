'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const WhaleStates = require('../pet-states.js');

// Fake clock: tests advance time explicitly instead of sleeping.
function makeClock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('starts in idle and reports minDur per state', () => {
  const m = WhaleStates.create({}, makeClock().now);
  assert.equal(m.current, 'idle');
  assert.equal(m.minDur('idle'), 4000);
  assert.equal(m.minDur('sleep'), 8000);
});

test('rejects transition inside the current state minDur window', () => {
  const clock = makeClock();
  const m = WhaleStates.create({}, clock.now);
  assert.equal(m.request('curious'), false); // idle minDur 4000 not elapsed
  assert.equal(m.current, 'idle');
  clock.advance(3999);
  assert.equal(m.request('curious'), false); // still inside the window
  clock.advance(1);
  assert.equal(m.request('curious'), true); // exactly at minDur boundary
  assert.equal(m.current, 'curious');
});

test('force bypasses the minDur window', () => {
  const clock = makeClock();
  const m = WhaleStates.create({}, clock.now);
  assert.equal(m.request('sleep'), false);
  assert.equal(m.request('sleep', { force: true }), true);
  assert.equal(m.current, 'sleep');
  clock.advance(1);
  // Force works even one tick into a new state's own minDur window.
  assert.equal(m.request('angry', { force: true }), true);
  assert.equal(m.current, 'angry');
});

test('rejects unknown states and re-requesting the current state', () => {
  const clock = makeClock();
  const m = WhaleStates.create({}, clock.now);
  assert.equal(m.request('nope'), false);
  assert.equal(m.request('idle'), false); // already idle
  clock.advance(5000);
  assert.equal(m.request('idle'), false); // still idle after the window
});

test('new state restarts its own minDur window', () => {
  const clock = makeClock();
  const m = WhaleStates.create({}, clock.now);
  clock.advance(10000);
  assert.equal(m.request('talk'), true); // talk minDur 3000
  clock.advance(2999);
  assert.equal(m.request('curious'), false); // talk window still open
  clock.advance(1);
  assert.equal(m.request('curious'), true);
});

test('fires onExit(prev) then onEnter(name, prev) in order', () => {
  const clock = makeClock();
  const calls = [];
  const m = WhaleStates.create({
    onExit: (prev) => calls.push(['exit', prev]),
    onEnter: (name, prev) => calls.push(['enter', name, prev]),
  }, clock.now);
  clock.advance(10000);
  m.request('happy');
  assert.deepEqual(calls, [['exit', 'idle'], ['enter', 'happy', 'idle']]);
});

test('heldFor tracks injected clock time since entry', () => {
  const clock = makeClock();
  const m = WhaleStates.create({}, clock.now);
  clock.advance(10000);
  m.request('shy');
  assert.equal(m.heldFor, 0);
  clock.advance(250);
  assert.equal(m.heldFor, 250);
});

test('STATES exposes css classes and CSS_CLASSES excludes null', () => {
  assert.equal(WhaleStates.STATES.idle.css, null);
  assert.equal(WhaleStates.STATES.curious.css, 'curious');
  assert.ok(!WhaleStates.CSS_CLASSES.includes(null));
  for (const name of Object.keys(WhaleStates.STATES)) {
    const css = WhaleStates.STATES[name].css;
    if (css !== null) assert.ok(WhaleStates.CSS_CLASSES.includes(css));
  }
});
