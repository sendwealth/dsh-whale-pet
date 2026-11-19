'use strict';

// Explicit state machine for the pet. Each state owns its CSS class,
// minimum hold time, and priority; transitions are arbitrated here so
// pet.js only reports events, speech, and timers.
const WhaleStates = (() => {
  // priority: while a state is still inside its minDur window, only a
  // strictly higher-priority state may interrupt it (or a forced switch).
  const STATES = {
    idle: { css: null, minDur: 4000, priority: 0 },
    talk: { css: null, minDur: 3000, priority: 1 },
    curious: { css: 'curious', minDur: 3200, priority: 2 },
    shy: { css: 'shy', minDur: 2600, priority: 3 },
    happy: { css: 'happy', minDur: 1600, priority: 3 },
    sleep: { css: 'sleep', minDur: 8000, priority: 4 },
    // Direct interaction outranks everything, including sleep: an angry
    // poke can always interrupt (a forced sleep-rhythm switch still can).
    angry: { css: 'angry', minDur: 2400, priority: 5 },
  };
  const CSS_CLASSES = Object.values(STATES).map((s) => s.css).filter((c) => c !== null);

  // `now` is injectable for tests; production callers use Date.now.
  function create(hooks, now = Date.now) {
    let current = 'idle';
    let enteredAt = now();

    function enter(name) {
      const prev = current;
      current = name;
      enteredAt = now();
      if (hooks.onExit) hooks.onExit(prev);
      if (hooks.onEnter) hooks.onEnter(name, prev);
    }

    return {
      get current() { return current; },
      get heldFor() { return now() - enteredAt; },
      minDur(name) { return STATES[name].minDur; },
      request(name, opts) {
        if (!(name in STATES) || name === current) return false;
        const force = Boolean(opts && opts.force);
        if (!force) {
          // Inside the current state's minDur window only a strictly
          // higher-priority state may interrupt.
          if (now() - enteredAt < STATES[current].minDur
            && STATES[name].priority <= STATES[current].priority) return false;
        }
        enter(name);
        return true;
      },
    };
  }

  return { create, STATES, CSS_CLASSES };
})();

// Plain <script> in the renderer; export only under CommonJS (unit tests).
if (typeof module !== 'undefined' && module.exports) module.exports = WhaleStates;
