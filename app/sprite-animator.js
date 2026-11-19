'use strict';

// Pure-logic frame advancer for the sprite animations. Knows nothing about
// the DOM: the caller injects a clock (`now`) and an `onFrame` callback and
// drives `tick()` from any timer it likes (renderer: setInterval; unit
// tests: a fake clock plus manual ticks). Style mirrors pet-states.js.
const SpriteAnimator = (() => {
  // opts: { fps, frameCount, loop, now, onFrame, onFinish }
  // `play(overrides)` may replace fps/frameCount/loop/onFinish mid-life so
  // one instance can serve every animation switch.
  function create(opts = {}) {
    const cfg = {
      fps: opts.fps ?? 12,
      frameCount: opts.frameCount ?? 1,
      loop: opts.loop !== false,
      now: opts.now ?? Date.now,
      onFrame: opts.onFrame,
      onFinish: opts.onFinish,
    };
    let running = false;
    let frame = 0;
    let lastTime = 0;
    let acc = 0;

    const frameDur = () => 1000 / cfg.fps;
    const emit = () => { if (cfg.onFrame) cfg.onFrame(frame); };

    return {
      get running() { return running; },
      get frame() { return frame; },
      get fps() { return cfg.fps; },
      get frameCount() { return cfg.frameCount; },
      get loop() { return cfg.loop; },
      play(overrides) {
        if (overrides) {
          if (overrides.fps !== undefined) cfg.fps = overrides.fps;
          if (overrides.frameCount !== undefined) cfg.frameCount = overrides.frameCount;
          if (overrides.loop !== undefined) cfg.loop = overrides.loop;
          if (overrides.onFinish !== undefined) cfg.onFinish = overrides.onFinish;
        }
        running = true;
        frame = 0;
        acc = 0;
        lastTime = cfg.now();
        emit(); // show frame 0 immediately
      },
      stop() { running = false; },
      // Advance according to wall-clock time since the last tick; onFrame
      // fires with the resulting frame when a tick changes it (intermediate
      // frames swallowed by a slow tick are skipped — the renderer only ever
      // shows the latest one); onFinish fires once a non-loop run has held
      // its last frame for a full frame duration.
      tick() {
        if (!running) return;
        const t = cfg.now();
        acc += t - lastTime;
        lastTime = t;
        const dur = frameDur();
        let changed = false;
        let finished = false;
        while (acc >= dur) {
          acc -= dur;
          if (cfg.loop) {
            frame = (frame + 1) % cfg.frameCount;
            changed = true;
          } else if (frame < cfg.frameCount - 1) {
            frame += 1;
            changed = true;
          } else {
            finished = true;
            acc = 0;
            break;
          }
        }
        if (changed) emit();
        if (finished) {
          running = false;
          if (cfg.onFinish) cfg.onFinish();
        }
      },
    };
  }

  return { create };
})();

// Plain <script> in the renderer; export only under CommonJS (unit tests).
if (typeof module !== 'undefined' && module.exports) module.exports = SpriteAnimator;
