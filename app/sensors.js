'use strict';

// Sensors: renderer-side aggregation of local system signals. The main
// process supplies raw samples (cursor position, system idle seconds, CPU
// load, fullscreen transitions); this module turns them into semantic
// events: mouse-approach, mouse-near, idle-long, cpu-busy, cpu-calm,
// fullscreen-changed. Usage: Sensors.on(name, cb) -> unsubscribe;
// Sensors.setEnabled(bool) toggles the main-process subscriptions.
const Sensors = (() => {
  const NEAR_DIST = 150;        // px from her center counted as "near"
  const NEAR_LOITER_MS = 3000;  // near for this long -> mouse-near
  const APPROACH_SPEED = 500;   // px/s closing speed for mouse-approach
  const APPROACH_COOLDOWN_MS = 5000;
  const IDLE_LONG_S = 600;      // 10 minutes
  const CPU_BUSY = 0.8;
  const CPU_CALM = 0.5;
  const CPU_BUSY_SUSTAIN_MS = 15000;

  const listeners = {};
  let enabled = false;

  function emit(name, payload) {
    for (const cb of listeners[name] || []) cb(payload);
  }

  function on(name, cb) {
    if (!listeners[name]) listeners[name] = new Set();
    listeners[name].add(cb);
    return () => { listeners[name].delete(cb); };
  }

  // ---- Cursor: distance, closing speed, loitering, system idle ----------
  let lastSample = null;      // { dist, at }
  let lastApproach = 0;
  let nearSince = 0;
  let nearFired = false;
  let idleFired = false;

  function petCenter(data) {
    // Screen coords are DIPs and the window is at zoom 1, so window CSS
    // coordinates translate directly.
    const rect = document.getElementById('pet').getBoundingClientRect();
    return { x: data.winX + (rect.left + rect.right) / 2, y: data.winY + (rect.top + rect.bottom) / 2 };
  }

  function handleCursor(data) {
    const center = petCenter(data);
    const dist = Math.hypot(data.x - center.x, data.y - center.y);
    const now = Date.now();

    if (lastSample !== null) {
      const dt = (now - lastSample.at) / 1000;
      const closing = dt > 0 ? (lastSample.dist - dist) / dt : 0;
      if (dist < NEAR_DIST && closing > APPROACH_SPEED && now - lastApproach > APPROACH_COOLDOWN_MS) {
        lastApproach = now;
        emit('mouse-approach', { dist });
      }
    }
    lastSample = { dist, at: now };

    if (dist < NEAR_DIST) {
      if (nearSince === 0) nearSince = now;
      if (!nearFired && now - nearSince > NEAR_LOITER_MS) {
        nearFired = true;
        emit('mouse-near', { dist });
      }
    } else if (dist > NEAR_DIST * 1.2) {
      nearSince = 0;
      nearFired = false;
    }

    if (data.idle >= IDLE_LONG_S) {
      if (!idleFired) { idleFired = true; emit('idle-long', { idle: data.idle }); }
    } else {
      idleFired = false;
    }
  }

  // ---- CPU load: sustained busy, then calm ------------------------------
  let cpuHighSince = 0;
  let cpuBusyFired = false;

  function handleCpu(load) {
    const now = Date.now();
    if (load > CPU_BUSY) {
      if (cpuHighSince === 0) cpuHighSince = now;
      if (!cpuBusyFired && now - cpuHighSince > CPU_BUSY_SUSTAIN_MS) {
        cpuBusyFired = true;
        emit('cpu-busy', { load });
      }
    } else {
      cpuHighSince = 0;
      if (cpuBusyFired && load < CPU_CALM) {
        cpuBusyFired = false;
        emit('cpu-calm', { load });
      }
    }
  }

  window.whalePet.onCursorData(handleCursor);
  window.whalePet.onCpuLoad(handleCpu);
  window.whalePet.onFullscreenChanged((fullscreen) => { emit('fullscreen-changed', fullscreen); });

  function setEnabled(value) {
    const on = Boolean(value);
    if (on === enabled) return;
    enabled = on;
    window.whalePet.subscribeCursor(enabled);
    window.whalePet.subscribeCpu(enabled);
    if (!on) {
      // No data source anymore: reset the latches so a re-enable starts
      // clean, and tell listeners CPU worries are over (the pet drops the
      // worried pose) instead of leaving it stuck until the next poke.
      lastSample = null;
      lastApproach = 0;
      nearSince = 0;
      nearFired = false;
      idleFired = false;
      cpuHighSince = 0;
      if (cpuBusyFired) {
        cpuBusyFired = false;
        emit('cpu-calm', { load: 0 });
      }
    }
  }

  return { on, setEnabled };
})();

// Plain <script> in the renderer; export only under CommonJS (unit tests).
if (typeof module !== 'undefined' && module.exports) module.exports = Sensors;
