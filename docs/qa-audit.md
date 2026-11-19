# QA Audit — whale pet Electron app (read-only)

Scope: all files under `app/` (main.js, preload.js, pet.js, pet-states.js, sensors.js,
memory.js, chat-main.js, agent-bridge.js, agent-smoke.js, key-dialog.js/html,
index.html, pet.css). Audit target: the bug classes behind the two shipped
incidents — Bug A (`display:flex` defeating `hidden`) and Bug B (fullscreen
mis-detection permanently fading the pet) — plus adjacent stuck-state,
timer/listener-leak, race, CSS-conflict, and boundary classes.

Verified against source as of commit `073dc9f` plus the uncommitted working-tree
edits to `app/main.js` / `app/pet-states.js` present during the audit.

Severity: **P0** = deterministic stuck/disappeared/leaked state; **P1** =
triggered under specific but realistic conditions; **P2** = risk/UX polish.

---

## P0 — deterministic stuck state or leak

### P0-1 `chatting` hangs `true` forever after a successful agent task dispatch
- **Location:** `app/pet.js:515-524` (`sendChat`, agent branch).
- **Trigger:** Agent mode on, send any task that `agentStartTask` accepts
  (`result.ok === true`).
- **Mechanism:** The agent success branch only calls `say(...)`; nothing resets
  `chatting`. `say()` never clears it, and `endConversationBubble()` — the only
  other place `chatting = false` runs — is reachable only from the persona-chat
  typewriter path. `closeChatInput()` (pet.js:487-490) would clear it, but
  nothing calls it automatically; the input was already hidden by `sendChat`.
- **Consequence:** `idleChatter()` (pet.js:310) sees `chatting === true` on every
  tick, so idle chatter is permanently muted for the rest of the session (or
  until the user happens to open + Escape the chat input). Same flag also gates
  nothing else, so the failure is silent.
- **Fix:** Set `chatting = false` in the agent success branch (after `say`),
  mirroring the failure branch; or route the ack through
  `endConversationBubble`-style cleanup.

### P0-2 Approval card mid-typewriter kills the reply and strands `chatting`
- **Location:** `app/pet.js:614-619` (`hideBubbleNow`), `app/pet.js:652-663`
  (`onAgentStatus` waiting-approval → `hideBubbleNow`), `app/pet.js:475-484`.
- **Trigger:** Persona chat reply is mid-typewriter (`typewriterTimer` active,
  `chatting === true`) when the agent flips to `waiting-approval`/`waiting-question`.
- **Mechanism:** `hideBubbleNow` calls `stopTypewriter()` and hides the bubble,
  so `endConversationBubble(10000)` — which sets `chatting = false` — never
  runs. The dots are hidden and the timer is 0, but no code path rechecks
  `chatting` except `closeChatInput` (never invoked here).
- **Consequence:** Same as P0-1: idle chatter permanently suspended; the reply
  text also disappears mid-sentence.
- **Fix:** In `hideBubbleNow` (or wherever the typewriter is aborted), reset
  `chatting = false` when `dots.hidden && typewriterTimer === 0` afterwards —
  i.e. reuse `closeChatInput`'s condition, or have `stopTypewriter` own the flag.

### P0-3 Toggling the agent off during `connecting` leaks the runtime subprocess
- **Location:** `app/agent-bridge.js:245-246` (`stop()` early-return when
  `client === null`) vs `app/agent-bridge.js:145-211` (`start()` assigns
  `client` only after the dynamic `import()` + mkdirs).
- **Trigger:** Tray → Connect agent, then immediately uncheck it while the
  connection is still `connecting` (the SDK import + runtime spawn takes
  seconds).
- **Mechanism:** `setEnabled(false)` calls `conn.stop()` while `start()` is
  still awaiting `import(sdkIndexUrl)`; `stop()` sees `client === null`, emits
  `offline`, and returns **without preventing `start()` from continuing**.
  `start()` then constructs the `HarnessClient`, spawns the `dsh` runtime, and
  initializes it — but `registerAgentBridge.conn` is now `null`, so no one owns
  or can stop that runtime. Its `emit` still pushes status/approvals to the
  renderer (phantom approvals from an "off" agent).
- **Consequence:** Leaked `dsh` subprocess living until app quit; renderer can
  receive approval cards from an agent the user turned off; a later
  "connect" creates a second runtime.
- **Fix:** Add a generation/cancel token: `stop()` while starting must mark
  the connection dead so the tail of `start()` tears the client down
  (`closing`-style guard at every `await` resumption point), or block `stop()`
  until `start()` settles (promise chaining).
- **Verification:** Run with a slow/absent checkout path or breakpoint; toggle
  off during `connecting`; then `pgrep -f "dsh --profile sdk"` and watch the
  tray tooltip phases. 待验证 on exact spawn timing, but the control flow is
  deterministic.

---

## P1 — specific-condition triggers

### P1-1 `say()` does not stop the typewriter → garbled double text during chat
- **Location:** `app/pet.js:186-193` (`say` lacks `stopTypewriter()`),
  `app/pet.js:394-419` (sensor handlers not gated on `chatting`).
- **Trigger:** A chat reply is typewriting; a mouse-approach/cpu-busy sensor
  event fires (their guards check only `fullscreenHidden` and `sleep`, not
  `chatting`).
- **Consequence:** `say()` writes one text; the still-running 35 ms
  `typewriterTimer` keeps overwriting it with the reply slice — the bubble
  flickers between two messages; `lastLine` bookkeeping and the reader's
  context both break.
- **Fix:** Call `stopTypewriter()` in `say()`, and/or gate sensor `say` calls
  on `chatting`.

### P1-2 Fullscreen baseline never resets — detection dead if sampled wrong once
- **Location:** `app/main.js:246-268` (`fullscreenBaseline` is set on the first
  sample and kept forever).
- **Trigger:** (a) The pet launches while a fullscreen app already owns the
  display (baseline reads true → `pushFullscreen(false)` forever); (b) the pet
  is dragged from a paneled monitor to a panel-less one, or display
  configuration changes (baseline belongs to the old display).
- **Consequence:** Class-B regression window in the opposite direction:
  fullscreen is never detected on that display for the whole session (pet stays
  visible over games); or, after the inverse display move, a panel-less
  baseline keeps suppressing detection on the paneled monitor.
- **Fix:** Reset `fullscreenBaseline = null` on `display-metrics-changed` and
  when the window's display changes (reuse the `moved`/clamp path), so each
  display re-baselines.
- **Verification:** Launch the pet inside a fullscreen app, then leave
  fullscreen: she should fade in/out afterwards but never will. 待验证 on
  multi-monitor ordering.

### P1-3 Night sleep + agent `working` pose stack (`sleep`+`working`)
- **Location:** `app/pet.js:231-243` (sleep rhythm forces `sleep` at night) vs
  `app/pet.js:656` (`classList.toggle('working', ...)`, independent of the
  machine), `app/pet.css:22,33` vs `app/pet.css:114`.
- **Trigger:** Agent mode running a long task across 23:00 (or started at
  night).
- **Consequence:** `pet.sleep` and `pet.working` classes coexist: equal
  specificity, later rule wins, so the figure plays `work-focus` while the
  image gets the sleep grayscale/dark filter — a dark, shivering worker. Worse,
  `.pet.sleep .bubble-text { opacity:.25 }` makes the agent's "task done"/error
  bubbles nearly unreadable at night (and `ad.done` uses `say`, which is not
  gated on `sleep`).
- **Fix:** Suppress the forced night-sleep while `agentBusy()`; or clear
  `sleep` when toggling `working` on and re-request sleep when it toggles off
  at night; raise bubble-text opacity for agent messages.

### P1-4 Chat input can open on top of a pending approval card
- **Location:** `app/pet.js:492-504` (`openChatInput` checks only
  `fullscreenHidden` and `sleep`, not `approvalUp`).
- **Trigger:** Approval/question card is up; user hits Ctrl+Shift+K or tray
  "Chat".
- **Consequence:** Input (z-index 3, bottom 148 px) renders directly below the
  card (z-index 4, bottom 178 px, up to ~150 px tall) — in a 240 px window both
  compete for the same visual band with the figure; sending a task while an
  approval is pending also interleaves two agent rounds.
- **Fix:** Return early (or defer) in `openChatInput` while `approvalUp`.

### P1-5 Double-click-to-hide: fires two pokes first, and can hide a pending approval
- **Location:** `app/pet.js:346-365` (pointerup zone interaction) +
  `app/pet.js:376-379` (`dblclick` → `hide` after 1.2 s).
- **Trigger:** Any double click on the pet (easy to do accidentally when
  patting twice — the head-pat line even invites "one more pat").
- **Consequence:** (a) Both clicks already ran zone interactions (two state
  flips + two bubbles) before the hide — the last thing the user sees is an
  angry/shy reaction, then she vanishes; (b) if an approval card is pending,
  the window hides with the card → the agent is left `waiting-approval`
  indefinitely (runtime blocked) until the user notices the tray tooltip and
  Show. The hide itself being triggerable by an ordinary double-click is high
  accidental-loss UX risk (evaluate: intentional feature, per dict `double`).
- **Fix:** Suppress the second click's zone interaction when a dblclick is
  imminent (click timer), and skip the hide while `approvalUp` or `agentBusy()`.
  Consider a confirmation bubble with a cancel window.

### P1-6 IME Enter sends the composition text prematurely
- **Location:** `app/pet.js:541-544` (keydown handler ignores `isComposing`).
- **Trigger:** Chinese/Japanese input (primary locale for this pet is zh):
  pressing Enter to commit a pinyin composition fires keydown with
  `isComposing === true`.
- **Consequence:** The raw composition (pinyin letters) is sent as the chat
  message / agent task instead of the intended text.
- **Fix:** `if (event.isComposing) return;` before handling Enter/Escape.

### P1-7 Renderer crash/reload during drag leaves the window glued to the cursor
- **Location:** `app/main.js:189-207` (main-process drag poll has no
  renderer-liveness or timeout guard).
- **Trigger:** Renderer crashes or reloads between `whale:begin-drag` and
  `whale:end-drag` (e.g. renderer OOM, DevTools reload).
- **Consequence:** No `pointerup`/`pointercancel` ever arrives, so the 16 ms
  `step()` loop runs forever, following the OS cursor with the window until the
  app is quit.
- **Fix:** Also stop the drag loop on `webContents` `render-process-gone` /
  `did-navigate`, or cap the drag with an inactivity timeout.
- 待验证: repro needs a renderer crash mid-drag.

### P1-8 Agent `connecting` phase has no timeout
- **Location:** `app/agent-bridge.js:151` (`await import`) and
  `agent-bridge.js:187` (`await c.initialize`) — no timeout.
- **Trigger:** Harness checkout present but built SDK missing/hangs, or the
  runtime child starts but never completes initialize (hung checkout, disk
  stall).
- **Consequence:** Phase stays `connecting` forever → renderer `agentBusy()`
  true forever → idle chatter never resumes; tray tooltip stuck at
  "connecting". (`import` of a missing file rejects quickly, so this needs a
  genuine hang. 待验证.)
- **Fix:** Wrap import+initialize in a timeout (e.g. 30–60 s) →
  `setPhase('error')` + teardown.

### P1-9 Sensor pose classes strand when sensors are switched off while active
- **Location:** `app/pet.js:415-423` (`worried` cleared only by `cpu-calm` or a
  machine transition), `app/sensors.js:104-110` (`setEnabled(false)` does not
  reset in-flight pose state or emit `cpu-calm`).
- **Trigger:** CPU stays busy → `worried` added; user unchecks Sensors in the
  tray before load drops.
- **Consequence:** `worried` (or `doze`) persists with no data source to clear
  it; only a machine state transition (a poke) removes it. If the user never
  touches her, she shivers indefinitely.
- **Fix:** On `setEnabled(false)`, remove `worried`/`doze`/`leaning` (or emit
  calm) and reset the Sensors internal latches.

---

## P2 — risks / UX (9 findings, summary)

1. **Wake-timer overshoot past 07:00** (`pet.js:245-256`): a night interaction
   at 06:59:58 re-sleeps her after 2.4 s; the 15 s rhythm interval rescues
   within one tick, but she dozes briefly in the morning.
2. **Clicking approval buttons also pokes her** (`pet.js:329-373` vs
   `639-646`): pointerup on Allow/Deny bubbles into the pet zone interaction —
   a state flip (and suppressed bubble) accompanies every decision.
3. **"Allow once" silently answers questions with option 1**
   (`agent-bridge.js:228-238`): `approve()` on a `waiting-question` picks the
   first option's label — the card's Allow button labels an approval but acts
   as "choose option A".
4. **`agentNoticed.crashed/error` are dead flags** (`pet.js:598`, `675-679`):
   only `offline` is ever consulted; a crash→reconnect→crash cycle shows at
   most one notice ever.
5. **Clamp uses display bounds, not workArea** (`main.js:57-64`): she can be
   parked under panels/docks; also if a display is smaller than 200×240 the
   min/max clamps invert and position her off-origin.
6. **Hidden window keeps chattering** (`pet.js:304-319`): dblclick-hide does
   not stop `idleTimer` or the sleep interval — invisible bubbles and state
   animation continue (minor CPU; on Show she may be mid-gesture).
7. **Facts extracted from failed rounds** (`chat-main.js:149-159`):
   `memory.extractFacts(text)` runs before the API call, so facts persist even
   when the round fails and no turn is recorded.
8. **Key dialog reuses the pet preload** (`chat-main.js:129-134`,
   `preload.js`): the key-dialog renderer gets the full `whalePet` surface
   (agent controls, settings writes) it never needs — needless surface.
9. **Concurrent `whale:chat` invokes interleave memory turns**
   (`chat-main.js:142-161`): the renderer's `chatSeq` guard is client-side
   only; two in-flight rounds (tray double action, future callers) can append
   turns out of order.

---

## Checked and found sound

- **Bug A class (hidden vs display):** every `hidden` element (`bubble`,
  `dots`, `approval-card`, `chat-input`) is covered by
  `[hidden]{display:none!important}` (`pet.css:6`); no JS path toggles a
  display-carrying class on these elements.
- **Machine minDur deadlock:** `request` with `force` always transitions;
   the sleep rhythm uses force, so sleep can always be entered/exited — no
   permanent minDur block exists (only the P1-3 visual interplay).
- **Sensor poll lifecycle** (`main.js:304-333`): hide/show, subscribe-count
   crossfade, and `windowUsable` guards correctly stop both timers;
   `fullscreenState` is reset when the last client unsubscribes.
- **`Sensors.on` unsubscribe functions** are returned but intentionally unused
   (single-page, one-time wiring) — no leak in practice; preload `on*`
   unsubscribers likewise.
- **chatSeq race guard** covers the persona path (stale replies dropped);
   agent path needs no seq because dispatch is one-shot.
- **Agent quit teardown** (`agent-bridge.js:327-335`): `before-quit`
   preventDefault → stop → re-quit is idempotent via `quitTeardownStarted`.
- **Memory flush** is debounced with a `before-quit` `flushNow` backstop.
