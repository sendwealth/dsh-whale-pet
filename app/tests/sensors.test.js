'use strict';

// Unit tests for app/sensors.js setEnabled reset semantics (audit P1-9):
// turning sensors off mid-worry must reset the internal latches and
// announce cpu-calm so the pet drops the worried pose instead of shivering
// until the next poke.

const { test } = require('node:test');
const assert = require('node:assert/strict');

// sensors.js is a renderer script: install the window/document shims it
// touches at load and during CPU handling before requiring it.
function loadSensors() {
  const calls = { subscribeCursor: [], subscribeCpu: [] };
  const listeners = { cursor: [], cpu: [], fullscreen: [] };
  global.window = {
    whalePet: {
      subscribeCursor: (on) => { calls.subscribeCursor.push(on); },
      subscribeCpu: (on) => { calls.subscribeCpu.push(on); },
      onCursorData: (cb) => { listeners.cursor.push(cb); },
      onCpuLoad: (cb) => { listeners.cpu.push(cb); },
      onFullscreenChanged: (cb) => { listeners.fullscreen.push(cb); },
    },
  };
  global.document = {
    getElementById: () => ({ getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }) }),
  };
  delete require.cache[require.resolve('../sensors.js')];
  const Sensors = require('../sensors.js');
  return { Sensors, calls, listeners };
}

// Pump sustained high CPU load so the busy latch fires, using a fake clock.
function pumpCpuBusy(listeners, load = 0.95) {
  const realNow = Date.now;
  let t = 1000000;
  Date.now = () => t;
  try {
    for (let i = 0; i < 6; i++) {
      t += 4000;
      listeners.cpu.forEach((cb) => cb(load));
    }
  } finally {
    Date.now = realNow;
  }
}

test('setEnabled(false) after cpu-busy emits cpu-calm and resets the latches', () => {
  const { Sensors, calls, listeners } = loadSensors();
  const events = [];
  Sensors.on('cpu-busy', () => events.push('busy'));
  Sensors.on('cpu-calm', () => events.push('calm'));

  Sensors.setEnabled(true);
  assert.deepEqual(calls.subscribeCursor, [true]);
  assert.deepEqual(calls.subscribeCpu, [true]);

  pumpCpuBusy(listeners);
  assert.deepEqual(events, ['busy']);

  Sensors.setEnabled(false);
  assert.deepEqual(events, ['busy', 'calm'], 'disabling must announce calm');

  // Re-enable and stay calm: the old busy latch must not survive.
  events.length = 0;
  Sensors.setEnabled(true);
  const realNow = Date.now;
  Date.now = () => 5000000;
  try {
    listeners.cpu.forEach((cb) => cb(0.9));
  } finally {
    Date.now = realNow;
  }
  assert.deepEqual(events, [], 'no immediate busy after re-enable');
});

test('setEnabled(false) while calm stays silent', () => {
  const { Sensors } = loadSensors();
  const events = [];
  Sensors.on('cpu-calm', () => events.push('calm'));
  Sensors.setEnabled(true);
  Sensors.setEnabled(false);
  assert.deepEqual(events, []);
});

test('setEnabled is idempotent: no duplicate subscribes', () => {
  const { Sensors, calls } = loadSensors();
  Sensors.setEnabled(true);
  Sensors.setEnabled(true);
  assert.deepEqual(calls.subscribeCpu, [true]);
  Sensors.setEnabled(false);
  Sensors.setEnabled(false);
  assert.deepEqual(calls.subscribeCpu, [true, false]);
});
