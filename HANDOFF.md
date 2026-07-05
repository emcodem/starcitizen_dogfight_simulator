# Vector — Flight Practice Sandbox — Handoff Notes

TypeScript + Vite project, deployed as a static site via GitHub Pages (GitHub
Actions builds and deploys on every push to `main`). The original single-file
prototype is preserved at `legacy/dogfight-sim.html` for reference/rollback,
but is no longer maintained — all active development happens under `src/`.

## What this is

A Newtonian, Star Citizen-inspired ship-flight sandbox for practicing combat
maneuvers. First-person cockpit view, quaternion-based orientation (so
pitch/roll/yaw stay correct relative to your current attitude, not a fixed
world axis), one static station to crash into, projectile weapons with
owner-tagged hit detection, a data-driven training-scenario system (main
menu → pick a scenario or free flight), and a control system that imports a
real Star Citizen `actionmaps.xml` — including resolving keyboard, joystick
axis, and joystick button bindings, all combined additively with mouse-look
(keyboard/mouse/joystick all work simultaneously; the joystick is optional).

## Dev workflow

- `npm install` — install dependencies
- `npm run dev` — Vite dev server with HMR, for iterating
- `npm test` — run the Vitest suite (`tests/*.test.ts`)
- `npm run build` — typecheck (`tsc --noEmit`-equivalent gate) then produce a
  static `dist/` (plain HTML/CSS/JS, no server-side code — deployable anywhere)
- `npm run preview` — serve `dist/` locally, to sanity-check the actual
  production build (not just dev mode) before pushing

**Note (as of this writing):** Vite 8 defaults to the Rolldown bundler, whose
native binding fails to install correctly under some npm/Windows
combinations (a known npm optional-dependency bug). This project pins
`vite@^7` to avoid it. If bumping to Vite 8+, verify `npm run build` actually
works on Windows before committing to it — if it doesn't, either wait for the
npm bug to be fixed or stay on Vite 7.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds and deploys automatically on push to
`main` (checkout → `npm ci` → `npm test` → `npm run build` → upload/deploy
the `dist/` artifact via the official `actions/deploy-pages` flow).

**One-time manual step** (can't be done without repo access): after creating
the GitHub repo and pushing, go to Settings → Pages → Source → select
**"GitHub Actions"**. Without this, the workflow will build successfully but
Pages won't serve the result.

`vite.config.ts` computes its `base` path from the `GITHUB_REPOSITORY` env
var that Actions sets automatically, so it works under whatever repo name is
chosen without editing config — `https://<user>.github.io/<repo>/` resolves
correctly out of the box. (Exception: if the repo is itself named
`<user>.github.io` — a user/org root page — `base` should be `'/'`; the
current config would compute a subpath instead. Fix in `vite.config.ts` if
that's ever the deployment target.)

## File layout

```
index.html                  — Vite entry: static DOM shell (HUD, controls panel, startup modal, touch controls)
src/
  main.ts                   — bootstraps every module, owns the requestAnimationFrame loop
  style.css                 — all CSS (imported from main.ts; Vite injects it)
  types.ts                  — shared types: Vec3, Quat, Ship, ShipType, ActionName, AxisConcept,
                               KeyBindings, AxisBinding, ButtonBinding, GamepadSnapshot, ScDevice, StickAxes
  math/quaternion.ts         — quatMultiply, rotateVecByQuat, integrateOrientation, computeAxes
  math/vec.ts                 — clamp, addScaled, cross, normalize
  ship/shipTypes.ts           — SHIP_TYPES (Gladius — the only player-selectable ship, see tuning note below)
  ship/shipState.ts           — makeShip, resetShip
  ship/deriveShipType.ts       — derives a ShipType variant with scaled turn rate (e.g. a scenario opponent),
                                 recomputing angularThrust so the tuning invariant still holds
  world/station.ts            — STATION, SPAWN
  world/weapons.ts             — WEAPON consts, projectiles array, spawnProjectileFrom/updateProjectiles, setFiring
  combat/health.ts             — Health points pool: createHealth, applyDamage (generic — ready for
                                 per-weapon damage values later, not just "1 hit = 1 point")
  combat/hitDetection.ts       — resolveHits: sphere-test projectiles by owner against player/enemies
  combat/leadIndicator.ts      — computeLeadPoint: firing-solution intercept math for the PIP reticle
  scenarios/types.ts           — ScenarioConfig / ScenarioRuntime shapes
  scenarios/definitions.ts     — SCENARIOS list — data-driven; a new scenario is a new entry here
  scenarios/runtime.ts         — startScenario/updateScenario: enemy AI aim+fire, hit resolution, outcome
  ui/scenarioMenu.ts           — main-menu overlay (scenario picker, results screen, MENU button)
  input/controlsModule.ts      — keybinds, actionmaps.xml keyboard parsing, chord resolution, presets
  input/deviceState.ts         — shared axisMap/buttonMap/scDevices + mutator functions (see below)
  input/gamepadModule.ts       — thin wrapper on navigator.getGamepads()
  input/joystickAxes.ts        — resolves axis bindings (XML-derived or manually-captured) to live values
  input/joystickButtons.ts     — resolves button bindings; justPressed (toggle) vs isPressed (hold)
  input/mouseLook.ts           — Pointer Lock-based absolute mouse-flight
  physics/step.ts              — the physics tick, composing ship/world/input every frame
  render/render.ts             — canvas drawing + HUD DOM text updates
  ui/startupModal.ts           — browser-compat + Ctrl-safety notice modal queue
  ui/fullscreenGuard.ts        — core keydown/keyup wiring, Ctrl-disabled-outside-fullscreen guard, Keyboard Lock
  ui/touchControls.ts          — on-screen joystick + button grid
  ui/mouseCapture.ts           — click-to-capture hint, firing wiring, ShiftRight fallback
  ui/controlsPanel/
    index.ts                   — panel open/close, wires the sub-modules together
    presetsUI.ts                — save/load/delete/export/import preset UI
    actionmapsImportUI.ts       — actionmaps.xml import, default-path copy button
    bindingsTableUI.ts          — the rebind table: keyboard rebind, axis bind/unbind/invert,
                                   button bind/unbind, mutual-exclusion capture state machine
    joystickDetectionUI.ts      — device list / live gamepad list / axis diagnostics
tests/
  quaternion.test.ts            — integrateOrientation, computeAxes orthonormality, quatMultiply
  actionmapsParsing.test.ts     — parseActionMapsXML, parseJoystickDevices GUID decode, parseJoystickAxisBindings
  chordResolution.test.ts       — tokenToCode / inputStringToChord / chordToLabel edge cases
  shipTuning.test.ts            — regression guard: angularThrust / angularDrag ≈ maxAngVel per axis
  deriveShipType.test.ts        — derived ship variants preserve the tuning invariant above
  leadIndicator.test.ts         — computeLeadPoint intercept math (stationary and moving cases)
  hitDetection.test.ts          — resolveHits damages the right side and consumes the projectile
legacy/dogfight-sim.html        — pre-TypeScript single-file version, unmaintained, kept for reference
```

Module boundaries mirror the old single-file IIFEs almost 1:1 — this was a
mechanical split-and-type pass, not a redesign. If you're looking for where
some behavior used to live, the section comment headers in
`legacy/dogfight-sim.html` are still a reasonable map.

**Shared mutable state pattern** (`input/deviceState.ts`): `axisMap`,
`buttonMap`, and `scDevices` are read from multiple modules but only ever
*written* from one place (`deviceState.ts`) via exported mutator functions
(`bindAxis`, `unbindAxis`, `setAxisMap`, `bindButton`, `unbindButton`,
`setScDevices`). ES modules don't allow importers to reassign another
module's `let` binding directly, so every other file calls a mutator instead
of assigning. `ship` itself doesn't need this — `resetShip()` mutates the
existing object's fields in place rather than reassigning the binding.

## Key design decisions (and why)

**Quaternion orientation, not Euler angles.** Early versions used separate
pitch/yaw/roll accumulators, which caused a real bug: after rolling, pitch
input would rotate around the *original* world axis instead of the ship's
current one — inverted-feeling controls from the cockpit. Fixed by switching
to a single quaternion (`ship.quat`) integrated every frame from body-frame
angular velocity (`integrateOrientation`, in `math/quaternion.ts`).
`computeAxes(quat)` derives forward/right/up by rotating fixed base vectors —
this is the only correct way to get the ship's current facing; don't
reintroduce Euler storage.

**First-person cockpit camera, not third-person chase.** An earlier
third-person chase camera used an offset (`pos - forward*dist + up*height`)
that itself rotated with roll, making the *camera* orbit the ship during a
roll — looked exactly like the ship was flying in circles even though it
wasn't. Switched to camera = ship position, camera axes = ship's full
rotated axes (see `render/render.ts`). No offset, so nothing to swing.

**Strafe uses the full rolled body frame**, not a "de-rolled" stabilized one.
There was an intermediate version that stabilized strafe against roll (real
flight computers often do this) specifically to work around the chase-camera
bug above. Once the camera bug was actually fixed, that workaround was
removed — strafe thrust is hull-fixed now, matching real RCS thrusters and
real SC behavior. If strafe+roll ever looks wrong again, check whether
something reintroduced camera-position coupling to roll before reaching for
this stabilization trick again.

**Coupled vs. decoupled mode** mirrors SC: coupled mode applies auto-damping
(velocity bleeds off when you let go of the stick); decoupled mode has none
of that, so you coast freely on whatever velocity you have (pure Newtonian
coasting) until you thrust against it. That coupled-mode auto-damping is
**not** a single mechanism — `physics/flightModel.ts` splits it in two,
based on real-game frame-counted measurements against the actual Gladius:
while actively thrusting on any linear axis, proportional drag (`linearDrag`,
or `boostLinearDrag` while boosting) applies, same as before; the moment
there's *no* throttle/strafe input at all, a flat `coastDecel` (m/s²,
constant, not proportional) takes over instead — real Gladius sheds speed at
a steady rate when you fully let go, not a decaying one, so a bigger drag
value alone couldn't reproduce it (it would taper off near zero). The
SCM/boost speed limiter is a third, separate mechanism from either of these,
and applies in both coupled and decoupled modes — decoupling lets you fly
without your nose needing to point along your velocity vector, it doesn't
let you exceed SCM speed; a decoupled boost can push past `scmSpeed` same as
a coupled one. When over cap (typically: right after a boost ends and the
cap drops out from under you), speed bleeds back down at the ship's own
thrust rate — same mechanism as the space brake, see below — rather than
snapping to the cap in a single frame; a boost wearing off should feel like
a deceleration, not a teleport. `boostLinearThrust` (main/retro) exists
specifically so boosting also *accelerates* the ship, not just raises the
cap — plain `linearThrust` is tuned so `linearDrag` settles the ship at
exactly `scmSpeed`, and `boostLinearThrust` the same way against its own
`boostLinearDrag` (same derivation as `angularThrust`/`boostAngularThrust`,
guarded by `tests/shipTuning.test.ts`) — real measurement showed boost is
far less damped than plain thrust (not just stronger), so `boostLinearThrust`
actually ends up *lower* than plain `linearThrust` despite the much higher
top speed. `spaceBrakeOn` is hold-to-brake — recomputed every tick from
`isActive('spaceBrake')` OR a held joystick button, NOT a toggle (unlike
`decoupled`, which is a real edge-triggered toggle) — and neither the
proportional drag nor `coastDecel` apply while braking (the brake's own
thrust-based counter-force already decelerates at the ship's actual thrust
rating; stacking either on top made a full brake decelerate harder than the
ship's strongest engine could ever accelerate it).

**Plain main/retro thrust is governor-capped, not drag-settled — this took
three attempts to get right, see shipTypes.ts's comment for the full data.**
The first two attempts (a single tail-fit exponential, then a "spool delay
then fast exponential" model derived from just one early checkpoint) were
both wrong, and both were caught by testing against real measured data —
first by live-testing in the browser (the ship hit 86 m/s in ~0.1s, clearly
broken), then by the user supplying the *full* dense 40ms-step trace from a
dead stop instead of a single checkpoint, which showed no dead zone at all:
the ship climbs steadily from the very first frame, at a strikingly
*constant* ~133 m/s² acceleration across nearly the entire speed range
(0.4s-wide segment averages: 132.5, 135, 135, 131 m/s²), stopping abruptly
right at `scmSpeed`. A constant rate across that much of the speed range
rules out proportional drag as the dominant force (drag would show a
shrinking rate as speed climbs) — this is thrust applying almost unopposed,
with the *existing* flight-computer speed limiter (the `speed > speedCap`
block, already needed for boost/overspeed bleed-down) doing the capping,
not a thrust/drag equilibrium. Grid-search fitting `dv/dt = thrust/mass -
drag·v` (plus a short startup delay, plus that same governor clamp) against
all 45 points landed on `thrust ≈ 201`, `drag` genuinely negligible (fit was
insensitive to any value below ~0.005), `mainSpoolDelay ≈ 0.07s` —
reproducing the whole trace to within ~3 m/s. `linearDrag` is kept at a
small nonzero placeholder rather than exactly 0 only to dodge a literal-zero
constant; it does essentially nothing across the whole flight envelope.

Reverse thrust got its own dense 40ms-step trace (dead stop, holding
fly-back, no boost) and shows the same governor-not-drag shape — constant
acceleration (~42 m/s²) across nearly the whole range, then an abrupt stop
at `scmSpeedBack`. Same fitting approach landed on `thrust ≈ 63` and
`retroSpoolDelay ≈ 0.024s` — a real, meaningfully shorter spool than main's
0.07s (different thruster, fit noticeably worse — ~3.6 vs ~2.3 m/s max error
— when forced to share main's delay instead of its own), hence
`mainSpoolDelay`/`retroSpoolDelay` are separate fields rather than one
shared `linearSpoolDelay`, mirroring the per-axis `angularDrag` split.

Lateral strafe (left/right) got the same dense-trace treatment and turned
out different again — `thrust ≈ 145` (not main's 201), with essentially no
spool at all (unlike main/retro's small-but-real delays). Vertical strafe
(up) also got a dense trace and, unlike lateral, *does* show a real spool
(`verticalSpoolDelay ≈ 0.066s`, close to main's — forcing it to 0 roughly
triples the fit error) with `thrust ≈ 147`; down was only spot-checked, not
traced in the same detail, and confirmed to run at exactly half of up's
speed at matching times, so `linearThrust.verticalDown = verticalUp / 2`
with both directions sharing one `verticalSpoolDelay`. The throttle-gating
pattern (`throttleSpoolTime`/`spooledUp` for main/retro) was mirrored with a
second, independent timer (`verticalSpoolTime`) for vertical, keyed off
`strafeY` instead of `throttle` — lateral strafe (`strafeX`) has no
timer at all, since its own trace showed no spool to model. The lesson from
all four traces: don't assume any two thrusters on this ship share a
number just because they're conceptually similar (main ≠ retro ≈ strafe ≠
vertical-up ≈ 2× vertical-down) — every axis needs its own measurement.
Boost has not been re-verified with a dense trace — no measurement backs
extending any of these spool delays to it, though the same "does the rate
stay constant instead of decaying" check applied to the boosted curve
suggests it may have the same governor-not-drag character too (see task
tracking this follow-up).
**Lesson for next time:** a single checkpoint or a fit to only part of a
curve is not enough to trust a derived tau/drag value against — always
check the fit against the *earliest* available data point(s) too (ideally
get the full dense trace up front), and treat a live-tested/simulated
reproduction of the actual measured sequence as the bar for "done," not just
an invariant formula checking out on paper.

**Gladius is the only ship.** `SHIP_TYPES` (in `ship/shipTypes.ts`) has a
single entry, with mass/thrust/drag values back-derived from real SCM speed
(226 m/s) and real pitch/yaw/roll rates (68/52/200°/s) the user provided from
Erkul-style stats, later refined against frame-counted stopwatch measurements
of the actual ship's acceleration/deceleration curves (see the big comment
above `SHIP_TYPES` in `shipTypes.ts` for the raw data and derivations).
Retro/strafe/vertical thrust are still estimated (not in the source data).
**Tuning rule:** `angularThrust` is set to `maxAngVel × angularDrag` per axis
— `angularDrag` is itself per-axis (real Gladius spins down at a measurably
different rate on each axis: roll/pitch/yaw settle with different time
constants), applied every frame proportional to current angular velocity
(see `physics/flightModel.ts`), so the ship settles at a steady state of
`angularThrust / angularDrag`, NOT at `maxAngVel` (the clamp is a ceiling,
not a target). Getting this wrong once already caused the Gladius to top out
at roughly half its real rotation rate on every axis — `tests/shipTuning.test.ts`
guards against reintroducing that mistake. The earlier placeholder ships
(Interceptor, Light/Heavy Fighter) were removed since they were never
matched to real data.

## Controls system

Three input methods — keyboard, mouse-look, and joystick — combine
**additively** (summed, then clamped to [-1, 1]) in `physics/step.ts`,
not as an override chain. This means the joystick is fully optional: with
nothing plugged in or bound, keyboard and mouse alone drive everything
exactly as if no joystick code existed.

1. **`input/controlsModule.ts`** — digital key chords (`KEYBINDS[action] =
   [[code,...], ...]`, OR of ANDs). Drives `isActive(action)` /
   `chordJustPressed(action, code)`, and importing SC's `actionmaps.xml`
   **keyboard (`kb1_`) rebinds only**.

### Control presets: a generic config registry

Presets (save/load/delete/export/import, plus auto-restoring the last one
chosen at startup) are **not** hardcoded to keybinds — they cover *every*
registered input config generically, so adding or removing a config item
never touches the preset code:

- **`input/configRegistry.ts`** — the backbone. Each config-owning module
  calls `registerConfig({ key, serialize, deserialize })` once at import
  time. `serializeAllConfig()`/`deserializeAllConfig(data)` just loop the
  registry — neither knows what's actually inside each entry.
  `onConfigApplied(fn)` lets a UI module subscribe to "a preset was just
  loaded" without the preset UI needing to know that module exists.
- **`input/presetStore.ts`** — the actual localStorage/file persistence
  (`hasPresetStorage`, `savePreset`/`loadPreset`/`deletePreset`/
  `listPresets`, `restoreLastPreset` + `vector_last_preset`,
  `exportToFile`/`importFromFileText`). Operates purely on
  `serializeAllConfig()`/`deserializeAllConfig()` — it has zero knowledge of
  keybinds, joystick, or mouse settings specifically. Also migrates the
  pre-registry preset shape (a bare `KeyBindings` object with no wrapper) by
  detecting the absence of any known top-level key and wrapping it as
  `{ keybinds: ... }`.
- Currently registered: `controlsModule.ts` → key `'keybinds'` (merges over
  `defaultBindings()` so a new action added later isn't left `undefined` by
  an older preset); `deviceState.ts` → `'axisMap'` + `'buttonMap'` +
  `'scDevices'`; `mouseLook.ts` → `'mouseLook'` (`sensitivity`/`invertY`/
  `deadzone`). `bindingsTableUI.ts` and `mouseCapture.ts` each subscribe via
  `onConfigApplied` to refresh their own DOM when a preset lands.
- `scDevices` looks like session-detected metadata (it's populated by
  parsing an actionmaps.xml import) but it's load-bearing, not cosmetic: an
  XML-derived axis binding only stores an `instance` number, and
  `joystickAxes.ts` resolves that to a vid/pid via `getScDevices()`. Leaving
  it out of the preset (as an earlier version of this feature did) silently
  breaks every non-manually-captured axis binding on reload — the binding
  still *shows* as bound in the table, it just reads `null` forever because
  `getScDevices().find(...)` has nothing to find. Manually-captured axis/
  button bindings (`{vid, pid, ..., manual: true}` / `ButtonBinding`) don't
  have this problem since they bake in the vid/pid directly.
- To add a new persisted setting: register it with `configRegistry` from
  wherever it already lives, and (if it has on-screen controls) subscribe to
  `onConfigApplied` to refresh them. `presetsUI.ts`/`presetStore.ts` need no
  changes. See `tests/presetStore.test.ts` for a registry round-trip test
  that proves this (it registers an ad-hoc config entry mid-test).

2. **`input/joystickAxes.ts` + `input/gamepadModule.ts`** — analog.
   `parseJoystickAxisBindings` (in `controlsModule.ts`) pulls real joystick
   axis tokens (`js1_x`, `js2_rotz`, etc.) out of the same XML for a fixed
   set of concepts (`strafeLateral/Vertical/Longitudinal`, `pitch/yaw/roll`).
   `parseJoystickDevices` decodes the DirectInput GUID in each
   `<options type="joystick">` entry into vendor/product ID (the GUID format
   is `{PPPPVVVV-0000-0000-0000-504944564944}` — the tail is literally ASCII
   "PIDVID"). At runtime, `gamepadModule.findByVidPid` matches that against
   whatever the browser currently reports in `navigator.getGamepads()[i].id`
   (Chromium reports non-XInput devices as
   `"<name> (Vendor: xxxx Product: yyyy)"` — the load-bearing,
   not-actually-standardized assumption the whole feature rests on).
   `physics/step.ts` calls `gamepadModule.poll()` every physics tick (not
   just while the panel is open).

   Axis bindings can also be **manually captured live** (the "Bind Axis"
   button in the controls-panel table): wiggle a stick, and whichever
   device+axis-index moves gets bound directly (`{vid, pid, axisIndex,
   manual: true}`) — no letter-to-index guessing needed, unlike XML-derived
   bindings (see the `AXIS_INDEX` guess table in `joystickAxes.ts`, still a
   known gap for XML imports specifically).

3. **`input/joystickButtons.ts`** — button bindings, manual-capture only (SC's
   actionmaps.xml button tokens aren't parsed). Currently wired for exactly
   two actions: `decoupleToggle` (edge-detected via `justPressed`, a real
   toggle) and `spaceBrake` (`isPressed`, hold-only). Extending to more
   actions (countermeasures, shields, etc.) means adding them to
   `BUTTON_BINDABLE_ACTIONS` in `bindingsTableUI.ts` and giving them
   whatever discrete/hold semantics they need in `physics/step.ts`.

The controls-panel bindings table (`ui/controlsPanel/bindingsTableUI.ts`) is
one row per digital action, three columns: Action / Keyboard / Joystick.
Keyboard and joystick each have their own bind button; a bound axis or
button shows "Unbind" instead, which clears that one binding and reverts to
"Bind"/"Bind Axis"/"Bind Joystick Button". Keyboard rebind, axis-bind
capture, and button-bind capture are mutually exclusive — starting one
cancels whichever of the others was pending; Escape cancels the active one.

## Weapons

`world/weapons.ts` (`spawnProjectileFrom`/`updateProjectiles`), `render/render.ts`
(`drawProjectiles`). Projectiles inherit shooter velocity plus a fixed muzzle
speed, alternate between two visual muzzle points, fade out over their
lifetime, and carry an `owner: 'player' | 'enemy'` tag. They still don't
collide with the station — only combat/hitDetection.ts's sphere test against
the player/enemies, which only runs while a scenario is active (see below).

## Training scenarios

`scenarios/definitions.ts` is the whole "content" surface — each entry is a
data-driven `ScenarioConfig` (enemy spawns, hit-point thresholds), not new
engine code. `scenarios/runtime.ts` is the one generic engine: per enemy it
turns toward the player at a capped rate (`math/quaternion.ts`'s
`lookAtQuat`/`rotateTowards`), fires once roughly nose-on, then calls
`combat/hitDetection.ts::resolveHits` and checks the health thresholds for a
win/loss outcome. `ui/scenarioMenu.ts` owns the picker/results overlay;
`main.ts` gates the whole physics/render loop behind a `menu`/`playing` mode
so nothing simulates while the menu is up.

Combat state is intentionally generic, not turret-drill-specific: `Health`
(`combat/health.ts`) is a plain points pool, and every hit currently
subtracts a flat 1 point (`applyDamage`'s default `amount`). The natural next
step for a real damage model is giving `WEAPON` (or a future per-ship
loadout) a damage value and passing it into `applyDamage` — no other file
needs to change. Similarly, `resolveHits`/`ScenarioRuntime.enemies` are
arrays throughout, so a multi-enemy scenario is just a `ScenarioConfig` with
more `enemySpawns`, not new logic.

The PIP (predicted-impact-point) reticle (`render/render.ts`'s `drawPip`,
math in `combat/leadIndicator.ts::computeLeadPoint`) solves the actual
intercept problem — it accounts for the shooter's own velocity, since
projectiles inherit it — so it stays correct if a future scenario gives the
opponent movement, not just the current stationary drill target.

## Station / collision / explosion

One static red wireframe cube (`world/station.ts`) at a fixed point ahead of
spawn. Distance check against `STATION.collisionRadius` in
`physics/step.ts`, sets `ship.exploding` + a 1s timer, freezes controls,
`render()` overlays a full-screen flash (`drawExplosion`), then
`resetShip()` restores spawn position/orientation/velocity when the timer
runs out.

## Touch / mobile

Minimal on-screen joystick (pitch/yaw, maps to Arrow keys) + button grid
(forward/back, up/down, roll left/right, decouple, space-brake/stop, fire) —
`ui/touchControls.ts`. **Known gap: no touch control for strafe left/right**
(digital `A`/`D` has no on-screen button) — only reachable via keyboard or a
bound joystick axis currently. Current touch pitch mapping: joystick up =
nose down (dive), joystick down = nose up (climb) — this was flipped a few
times during development per user testing, so if it ever feels backwards
again, that's the line to check (`keys['ArrowUp'] = ny < -0.15` etc.).

## Startup safety features

- **Browser check** (`ui/startupModal.ts`): `navigator.userAgentData.brands`
  (Chromium-only API) or UA-string fallback; warns (doesn't hard-block) on
  non-Chromium browsers, since Gamepad vendor/product string parsing and the
  Keyboard Lock API are Chromium-specific behaviors this sim leans on.
- **Ctrl disabled outside fullscreen** (`ui/fullscreenGuard.ts`): the keydown
  handler drops `ControlLeft`/`ControlRight` entirely unless
  `document.fullscreenElement` is set — prevents it from ever reaching game
  logic (and reduces risk of Ctrl+W/Ctrl+Q, which no page can block) until
  the user is in fullscreen. A brief on-screen flash (`#ctrl-flash-warning`)
  fires whenever Ctrl is pressed outside fullscreen, so the restriction is
  discoverable without needing a persistent HUD hint. Outside fullscreen, a
  held Ctrl/Cmd combo (Ctrl+C, Ctrl+V, Ctrl+A, etc.) is left completely
  alone rather than being swallowed as game input — standard browser
  shortcuts keep working. Touch controls bypass all of this deliberately
  (mobile has no such shortcut risk).
- Both notices funnel through one small sequential modal queue
  (`ui/startupModal.ts`). Only the Ctrl notice persists dismissal, via real
  `localStorage` (`vector_hide_ctrl_notice`) — correct here since this is a
  real deployed site, not an in-chat Claude artifact (which can't use
  `localStorage` and would need `window.storage` instead — see
  `hasArtifactStorage` in `controlsModule.ts` for where that distinction
  already matters elsewhere).

## Suggested next steps

1. Confirm/fix the joystick axis-index table (`AXIS_INDEX` in
   `joystickAxes.ts`) against real hardware for XML-imported bindings
   (manually-captured ones don't need this — see the controls-system section
   above).
2. Wire joystick buttons for more actions beyond decouple/space brake
   (countermeasures, shields, etc.) — extend `BUTTON_BINDABLE_ACTIONS`.
3. Give the enemy AI evasive/movement behavior for a harder scenario (the
   framework already carries `EnemyShip.vel` and `computeLeadPoint` already
   handles a moving target — only `runtime.ts`'s "stays put" assumption
   needs to change).
4. Add touch strafe left/right buttons.
5. If more ships are added later, retro/strafe/vertical thrust for the
   Gladius should get real (not estimated) values too if that data ever
   surfaces.
6. Consider adding DOM-level tests (jsdom + simulated events) for the
   controls-panel rebind state machine — currently only the pure-logic
   modules (quaternion math, XML parsing, chord resolution, ship tuning)
   have automated coverage.
