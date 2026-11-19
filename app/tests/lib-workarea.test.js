'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WIN_WIDTH, WIN_HEIGHT, clampPosition, isDisplayFullscreen, decideFullscreenSample } = require('../lib-workarea.js');

test('exports the pet window size used by main.js', () => {
  assert.equal(WIN_WIDTH, 200);
  assert.equal(WIN_HEIGHT, 240);
});

test('clampPosition keeps an in-bounds position unchanged (null)', () => {
  const bounds = { x: 0, y: 0, width: 1920, height: 1080 };
  assert.equal(clampPosition(100, 100, bounds, WIN_WIDTH, WIN_HEIGHT), null);
  assert.equal(clampPosition(0, 0, bounds, WIN_WIDTH, WIN_HEIGHT), null);
});

test('clampPosition pulls an off-screen window back inside', () => {
  const bounds = { x: 0, y: 0, width: 1920, height: 1080 };
  assert.deepEqual(clampPosition(1900, 500, bounds, WIN_WIDTH, WIN_HEIGHT), { x: 1720, y: 500 });
  assert.deepEqual(clampPosition(-50, 1200, bounds, WIN_WIDTH, WIN_HEIGHT), { x: 0, y: 840 });
});

test('clampPosition honors a non-origin display', () => {
  const bounds = { x: 1920, y: 0, width: 1280, height: 720 };
  assert.deepEqual(clampPosition(100, 100, bounds, WIN_WIDTH, WIN_HEIGHT), { x: 1920, y: 100 });
  assert.deepEqual(clampPosition(5000, 0, bounds, WIN_WIDTH, WIN_HEIGHT), { x: 3000, y: 0 });
});

test('isDisplayFullscreen detects workArea collapsed onto bounds', () => {
  const bounds = { width: 1920, height: 1080 };
  assert.equal(isDisplayFullscreen(bounds, { width: 1920, height: 1080 }), true);
  assert.equal(isDisplayFullscreen(bounds, { width: 1918, height: 1077 }), true); // inside slack
  assert.equal(isDisplayFullscreen(bounds, { width: 1920, height: 1040 }), false); // panel present
  assert.equal(isDisplayFullscreen(bounds, { width: 1840, height: 1080 }), false);
});

test('decideFullscreenSample: first sample becomes the baseline', () => {
  // Baseline true (panel-less desktop): never report fullscreen.
  assert.deepEqual(decideFullscreenSample(null, true), { baseline: true, value: false });
  assert.deepEqual(decideFullscreenSample(true, true), { baseline: true, value: false });
  // Baseline false (normal desktoped display): pass samples through.
  assert.deepEqual(decideFullscreenSample(null, false), { baseline: false, value: false });
  assert.deepEqual(decideFullscreenSample(false, true), { baseline: false, value: true });
  assert.deepEqual(decideFullscreenSample(false, false), { baseline: false, value: false });
});
