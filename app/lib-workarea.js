'use strict';

// Pure geometry/decision helpers extracted from main.js so they can be unit
// tested under plain Node. main.js supplies the Electron screen/window APIs.

const WIN_WIDTH = 200;
const WIN_HEIGHT = 240;
// workArea collapse threshold: exclusive-fullscreen apps make the work area
// cover the full bounds; panels that auto-hide or do not exist read the same
// all the time (handled by the baseline in decideFullscreenSample).
const FULLSCREEN_SLACK_PX = 4;

/**
 * Clamp a window position into a display's bounds.
 *
 * @param {number} x window x
 * @param {number} y window y
 * @param {{x:number,y:number,width:number,height:number}} bounds display bounds
 * @param {number} width window width
 * @param {number} height window height
 * @returns {{x:number,y:number}|null} new position, or null when unchanged
 */
function clampPosition(x, y, bounds, width, height) {
  const nx = Math.min(Math.max(x, bounds.x), bounds.x + bounds.width - width);
  const ny = Math.min(Math.max(y, bounds.y), bounds.y + bounds.height - height);
  if (nx === x && ny === y) return null;
  return { x: nx, y: ny };
}

/**
 * Fullscreen approximation: an exclusive-fullscreen app collapses the
 * display's workArea onto the full bounds.
 *
 * @param {{width:number,height:number}} bounds display bounds
 * @param {{width:number,height:number}} workArea display workArea
 * @returns {boolean}
 */
function isDisplayFullscreen(bounds, workArea) {
  return bounds.width - workArea.width < FULLSCREEN_SLACK_PX
    && bounds.height - workArea.height < FULLSCREEN_SLACK_PX;
}

/**
 * Baseline-guarded fullscreen decision. The first sample is a baseline: a
 * display that reads fullscreen from the start never had panels to lose and
 * must be treated as never-fullscreen so the pet cannot fade forever there.
 *
 * @param {boolean|null} baseline previous baseline (null before first sample)
 * @param {boolean} current raw isDisplayFullscreen sample
 * @returns {{baseline:boolean, value:boolean}} updated baseline and the
 *   fullscreen value to push to the renderer
 */
function decideFullscreenSample(baseline, current) {
  const nextBaseline = baseline === null ? current : baseline;
  return { baseline: nextBaseline, value: nextBaseline ? false : current };
}

/**
 * Per-display fullscreen sample: each display keeps its own baseline in the
 * shared map, because a panel-less secondary display reads fullscreen all
 * the time and must not inherit the primary display's panel baseline.
 *
 * @param {Map<number, boolean>} baselines display id -> baseline
 * @param {number} displayId sampled display id
 * @param {boolean} current raw isDisplayFullscreen sample
 * @returns {boolean} fullscreen value to push to the renderer
 */
function sampleDisplayFullscreen(baselines, displayId, current) {
  const decision = decideFullscreenSample(
    baselines.has(displayId) ? baselines.get(displayId) : null,
    current,
  );
  baselines.set(displayId, decision.baseline);
  return decision.value;
}

module.exports = { WIN_WIDTH, WIN_HEIGHT, clampPosition, isDisplayFullscreen, decideFullscreenSample, sampleDisplayFullscreen };
