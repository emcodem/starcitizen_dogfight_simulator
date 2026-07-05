# CLAUDE.md

Orientation file so a new session doesn't need to re-explore the repo. For deep
architecture/design-rationale detail, read **HANDOFF.md** in full — it's kept
up to date and covers this in much more depth than below. **README.md** is the
user-facing feature description (what's live at the GitHub Pages URL).

## What this is

"Vector" — a Newtonian, Star Citizen-inspired ship-flight sandbox for
practicing combat maneuvers, playable in the browser. Plain **TypeScript +
Vite** static web app, deployed to GitHub Pages via GitHub Actions on push to
`main`. No game engine, no three.js/WebGL — rendering is hand-rolled manual
perspective projection on a 2D canvas (`src/render/render.ts`). No runtime
dependencies at all; devDependencies only (Vite, TypeScript, Vitest+jsdom).

`legacy/dogfight-sim.html` is the old pre-TypeScript single-file prototype —
unmaintained, kept only for reference/rollback. All active work is under `src/`.

## Commands

- `npm run dev` — Vite dev server w/ HMR
- `npm test` — `vitest run` (tests in `tests/*.test.ts`)
- `npm run build` — `tsc && vite build` (typecheck gate, then static `dist/`)
- `npm run preview` — serve the built `dist/` locally

Vite is pinned to `^7` (Vite 8's Rolldown bundler has known install issues on
Windows) — check that carefully before bumping.

`npm test` only covers pure logic (math, tuning, AI decisions) — nothing
renders or runs the real game loop. To actually verify a gameplay/scenario/
render change, drive the real app in a browser; see
**`.claude/skills/verify/SKILL.md`** for the recipe (headless Playwright,
menu automation, a temporary debug hook for reading live `Ship`/
`ScenarioRuntime` state, and gotchas around scripting the Newtonian flight
model).

## File map

```
index.html                    — DOM shell: canvas, HUD, startup modal, scenario menu, controls panel, touch controls
src/main.ts                   — bootstraps all modules, owns the requestAnimationFrame loop, menu/playing state gate
src/types.ts                  — shared types (Vec3, Quat, Ship, ShipType, ActionName, bindings, GamepadSnapshot, ...)

src/math/quaternion.ts         — quatMultiply, rotateVecByQuat, integrateOrientation, computeAxes, lookAtQuat, slerp
src/math/vec.ts                 — clamp, addScaled, cross, normalize

src/ship/shipTypes.ts           — SHIP_TYPES: Gladius only, real SC stats (226 m/s SCM, 68/52/200°/s, 48,552 kg)
src/ship/shipState.ts           — makeShip, resetShip
src/ship/deriveShipType.ts      — scaled ship variants (e.g. scenario opponents) preserving the tuning invariant

src/world/station.ts            — STATION, SPAWN, setStationActive/isStationActive
src/world/weapons.ts            — WEAPON consts, projectiles array, spawnProjectileFrom/updateProjectiles

src/combat/health.ts            — createHealth/applyDamage (generic points pool)
src/combat/hitDetection.ts      — resolveHits: sphere-test projectiles by owner against player/enemies
src/combat/leadIndicator.ts     — computeLeadPoint: firing-solution intercept math for the PIP reticle

src/scenarios/types.ts          — ScenarioConfig / ScenarioRuntime shapes
src/scenarios/definitions.ts    — SCENARIOS list (data-driven; currently one: "Slow Turret Drill")
src/scenarios/runtime.ts        — startScenario/updateScenario: enemy AI aim+fire, hit resolution, outcome

src/physics/step.ts             — the physics tick: input gather -> angular/linear integration -> collision -> projectiles
src/render/render.ts            — canvas drawing (starfield, station, ships, tracers, PIP, hit-flash) + HUD DOM updates

src/input/controlsModule.ts     — keybinds, actionmaps.xml keyboard parsing, chord resolution
src/input/deviceState.ts        — shared axisMap/buttonMap/scDevices, written only via exported mutators
src/input/gamepadModule.ts      — thin wrapper on navigator.getGamepads()
src/input/joystickAxes.ts       — resolves axis bindings (XML-derived or manually-captured) to live values
src/input/joystickButtons.ts    — resolves button bindings (justPressed vs isPressed)
src/input/mouseLook.ts          — Pointer Lock absolute mouse-flight
src/input/configRegistry.ts     — generic registry config modules join to be included in control presets
src/input/presetStore.ts        — control preset save/load/delete/export/import + last-preset auto-restore

src/ui/scenarioMenu.ts          — main-menu overlay: scenario picker, results screen
src/ui/modeToggle.ts            — clickable COUPLED/DECOUPLED HUD flag
src/ui/startupModal.ts          — browser-compat + Ctrl-safety notice modal queue
src/ui/fullscreenGuard.ts       — keydown/keyup wiring, Ctrl-disabled-outside-fullscreen guard
src/ui/touchControls.ts         — on-screen joystick + button grid (no strafe L/R yet — known gap)
src/ui/mouseCapture.ts          — click-to-capture pointer-lock hint, firing wiring
src/ui/controlsPanel/           — full rebind UI: presets, actionmaps.xml import, bindings table, joystick detection

tests/                          — Vitest: quaternion, actionmaps parsing, chord resolution, ship tuning,
                                   derived ship types, lead indicator, hit detection, boost, brake
```

There is **no separate camera module** — the first-person cockpit camera is
defined inline in `render/render.ts` (`cam.pos = ship.pos`, `cam.axes =
computeAxes(ship.quat)`, no offset).

## Load-bearing invariants (see HANDOFF.md for the "why")

- **Quaternion orientation only** — never reintroduce Euler angle storage for
  ship attitude; it previously caused inverted-feeling post-roll pitch input.
- **First-person camera has no offset** — a chase-camera offset previously
  made the ship look like it was flying in circles during a roll.
- **`angularThrust == maxAngVel * angularDrag`** per axis in `shipTypes.ts`
  (`angularDrag` is itself per-axis, real Gladius spins down at a different
  rate per axis) — steady-state target, not a clamp target. Guarded by
  `tests/shipTuning.test.ts` and `tests/deriveShipType.test.ts`.
  `boostLinearThrust == boostSpeedForward/Back * boostLinearDrag * mass` is the
  same invariant for boosted linear thrust — without it, boosting only raises
  the speed cap while drag still settles unboosted thrust at exactly
  `scmSpeed`, so the ship can never climb to a speed the higher cap would
  matter for. Boost uses its own `boostLinearDrag`, not `linearDrag` — real
  measurement showed boosting is far less damped, not just higher-thrust, so
  `boostLinearThrust` can end up *lower* than plain `linearThrust` despite the
  higher top speed.
- **`coastDecel` is a flat m/s² deceleration, not proportional drag** — used
  in `flightModel.ts` only when there's zero throttle/strafe input in coupled
  mode (releasing the stick entirely), separate from the proportional
  `linearDrag`/`boostLinearDrag` applied while actively thrusting. Real
  Gladius sheds speed at a constant rate when you let go, not a decaying one
  — don't collapse this back into a single drag value.
- Keyboard, mouse-look, and joystick input combine **additively** (summed,
  clamped to [-1,1]) in `physics/step.ts` — never an override chain. Joystick
  stays fully optional this way.
- `decoupled` is an edge-triggered toggle; `spaceBrakeOn` is recomputed
  hold-to-brake every tick — don't conflate the two semantics.
