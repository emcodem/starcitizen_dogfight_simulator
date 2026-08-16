# Vector — Star Citizen Dogfight Trainer

**Vector is a free, browser-based dogfight combat trainer for Star Citizen pilots.** It rebuilds
Star Citizen's Gladius flight model from frame-counted, real-measured data and wraps it in a
gunnery/maneuvering gym: aim-training drones, evasive and turret drills, AI fighter intercepts,
barrel-roll escape courses, a bare PIP-tracking mode, and a flight recorder for reviewing your own
runs — all running as a **three.js / WebGL** app with no install required.

**▶ Play the live build: https://emcodem.github.io/sc_webgl/** (auto-deployed from `master` — see
`.github/workflows/deploy.yml`). Requires a WebGL2 browser.

It's also architected to grow past pure trainer scope into a whole explorable universe: fly your
ship, **get out and walk** on a moon, seamlessly, over one shared world. That expansion is real and
playable today (see Milestones below) but the trainer is the reason this exists.

This is the WebGL successor to an original 2D-canvas prototype at
**`C:\dev\starcitizen_flightsim`** (referred to below as "the original"). It **reuses the original's
frame-counted, real-measured Gladius flight model** but is otherwise a ground-up universe-scale
architecture.

> For architecture rationale and load-bearing invariants, read `CLAUDE.md` in this folder.

---

## Why this exists

Star Citizen's own flight/combat systems are hard to practice deliberately — you can't isolate
"just the merge" or "just PIP tracking" without spinning up a full match. Vector reproduces the
actual Gladius handling (thrust, drag, spool delays, speed governor — measured directly from the
game, not guessed) and layers **training scenarios** on top of it, so you can drill specific
skills in a tight loop:

- **Aim training** — drone swarms with a lead-indicator PIP to track.
- **Merge / evasive drills** — close, break, and reposition against a maneuvering bogey.
- **Turret drills** — attack a stationary or ship-mounted turret.
- **Fighter intercept** (rookie/ace) — a full AI dogfight opponent flying the same flight model.
- **Barrel-roll gate-path courses** — precision-flying drills through ring gates while evading.
- **PIP Trainer** — a ship-less bare aim-tracking drill, isolated from the flight model entirely.
- **Flight Recorder (F6)** — a rolling background buffer plus manual recording, so you can scrub
  back through a run, watch it in free camera, and export/share a `.vreplay` clip.

You can also **import your real Star Citizen `actionmaps.xml`** (F4 → Controls) so the trainer uses
your actual bindings, and it detects joystick/HOTAS hardware by USB vendor/product ID to cross-check
against what your profile expects.

---

## The universe-scale goal

Beyond the trainer, the same world is meant to hold:
- **Newtonian ship flight** (the real Gladius handling), and
- **On-foot movement** (walk on planets/moons/stations under local gravity), with
- a **seamless transition** between them (leave the cockpit and walk around; climb back in),
- at **universe scale** (a solar system that spans hundreds of millions of metres, and eventually
  more), rendered with real 3D graphics (lighting, materials, atmospheres, bloom).

---

## Where we are right now

**Milestone 1 — seamless ship ↔ on-foot — DONE**, verified in a real headless browser. Spawn
piloting the Gladius above a small moon (Cellin) with a sun, distant planet, and starfield. Press
**F** near the surface to auto-land belly-down and step out; walk the moon's curved surface under
radial gravity; **F** again by the ship to re-board and fly off.

**Visual-realism pass — DONE.** Filmic tone mapping (ACES) + bloom; procedurally displaced/mottled
planets & moons with a Fresnel atmosphere rim; a layered sun (HDR limb-brightened core + warm
corona billboards); glowing, size-varied stars. All asset-free (procedural/canvas-generated).

**Combat & scenarios — DONE.** Weapons/projectiles, hit detection, lead-indicator PIP, always-on
ESP aim-assist (dampens yaw/pitch near the lead solution, tuned to match real SC's feel), ship
health/hitflash/respawn, and 8 data-driven training scenarios with results screens, reachable from
the F3 menu's scenario picker. Enemy AI includes simple chaser/cruiser, orbiter/drifter, an MPC-based
evasive dodge planner, and turret behavior.

**Input & controls — DONE.** Keyboard/mouse (SC-style absolute virtual-joystick mouse-look with
expo curve and deadzone), gamepad, joystick/HOTAS, and touch/mobile support (dual floating
thumbsticks + button cluster, gated behind touch-primary device detection); a full F4 rebind panel
with save/load/import/export presets and direct **actionmaps.xml import** from a real SC profile.

**Flight Recorder — DONE.** Always-on rolling buffer + manual recording, scrubbable playback with
free camera, `.vreplay` export/import for sharing clips.

**Desktop build — DONE.** Runs as a native window via Electron alongside the primary web deploy.

**Known-crude / next up:** the **ship model** (still boxy primitives — the biggest remaining
eyesore) and close-up moon-surface detail; station-interior walking, atmosphere/terrain, and
universe streaming (bodies are currently a static list) are not built yet — see `CLAUDE.md` for
the full scope boundary.

---

## Quick start

```bash
npm install
npm run dev      # Vite dev server (http://localhost:5173)
npm test         # vitest — tuning-invariant guards
npm run build    # tsc typecheck gate + static build to dist/
```

Requires a WebGL2 browser. Only runtime dependency: **three.js** (`^0.169`).

### Controls

**Click** the view to capture the mouse.

Flying: mouse = aim (yaw/pitch) · `W`/`S` throttle · `A`/`D` roll · `Q`/`E` yaw · arrows = strafe
(L/R + up/down) · `Shift` boost · `Space` brake · `C` decouple · `F` disembark (auto-lands near a
surface) · fire with mouse click.

On foot: mouse = look · `WASD` walk · `Space` jump · `F` board (when near the ship).

On touch/mobile: left stick = move/strafe · right stick = look (aim in-ship, rate-based on foot) ·
button cluster = boost/brake/decouple/fire/vertical strafe · optional device-tilt roll/pitch assist.

Top-right toggle bar: **F1** restart · **F2** fullscreen · **F3** menu / scenario picker · **F4**
controls (rebinding, actionmaps import, joystick detection, mouse/ESP tuning) · **F6** flight
recorder.

---

## Desktop build (Electron)

The same build also runs as a native window via Electron — `index.html` / GitHub Pages stays the
primary deployment target, this is additive.

```bash
npm run electron:dev      # Vite dev server + Electron pointed at it, live-reloading
npm run electron:preview  # builds dist/ and opens it in Electron, no packaging
npm run electron:build    # builds dist/ and packages an installer via electron-builder → release/
```

`electron/main.cjs` just opens `dist/index.html` (`file://`, no dev server) in a `BrowserWindow`
with the native menu bar hidden — the game has its own F3 menu. No preload APIs are exposed;
everything the app needs (pointer lock, fullscreen, gamepad, `<input type="file">`) is a standard
web API that works unchanged under Electron's Chromium.

Pushing a `v*` tag (e.g. `v0.1.0`) triggers `.github/workflows/electron-release.yml`, which builds
Windows/macOS/Linux installers (unsigned) and attaches them to a GitHub Release for that tag. The
workflow can also be run manually via `workflow_dispatch` to smoke-test packaging without cutting
a release.

---

## Architecture at a glance

Three strictly-separated layers so "in a ship" vs "on foot" is a **mode over shared state**, not a
fork, and so the renderer can be extended/replaced without touching the sim. See `CLAUDE.md` for the
full description.

```
core/       renderer-agnostic sim state — ABSOLUTE f64 world coords, NO three.js
  types.ts    Vec3/Quat/AngularState/ShipType  (ported shapes)
  world.ts    World, CelestialBody, ShipBody, Player (mode: 'pilot' | 'onfoot')
  player.ts   makeWorld() / makeShipBody()
math/        vec.ts, quaternion.ts             (ported + universe-scale helpers)
physics/     flightModel.ts (PORTED VERBATIM), shipTypes.ts (PORTED), characterController.ts
world/       celestial.ts — starter system (SUN, PLANET, MOON) + SPAWN, plus the bright-star catalog
input/       keyboard/mouse/gamepad/joystick/touch, actionmaps.xml import, rebind presets
control/     pilot.ts, foot.ts (input -> physics), mode.ts (F/C edges, exit/enter + auto-land)
combat/      weapons, hit detection, lead-indicator PIP, ESP assist, enemy AI, PIP Trainer
scenarios/   data-driven training scenarios (definitions, runtime, gate-path courses)
replay/      rolling-buffer + manual recorder, playback, .vreplay import/export
render/      renderer.ts (three.js + floating-origin sync + bloom), camera.ts, meshes.ts, noise.ts
ui/          F3 scenario menu, F4 controls panel, F6 replay panel, main menu, touch controls overlay
hud/         hud.ts — DOM + canvas + SVG overlay (flight stats, scenario/PIP-trainer panels, ESP ring)
main.ts      bootstrap + RAF loop (dt clamped to 50 ms, matching the original)
```

Two things that will bite you if you don't know them (both detailed in `CLAUDE.md`):
- **Floating origin = fully camera-relative rendering.** `render/renderer.ts` is the ONLY place it
  happens; the sim moves things in absolute f64 space. Keep three.js out of `core/`.
- **Axis-convention seam.** `computeAxes` uses forward=+Z, right=+X, **up=-Y** (the original's
  convention — load-bearing for the flight model). `render/camera.ts` builds camera/object
  orientation from an explicit world (forward, up) basis so three.js's own +Y-up/-Z-forward never
  fights it. Consequence: at the spawn attitude, screen-down is world **+Y**, which is why the moon
  sits at +Y in `celestial.ts`. Gravity/collision are radial and convention-independent.

---

## Ported from the original — flight model provenance

The Newtonian flight model and its constants were carried over from `C:\dev\starcitizen_flightsim`,
where they were fit to frame-counted, real-Star-Citizen measurements of the Gladius.

| New file | From original | Status | Notes |
| --- | --- | --- | --- |
| `src/physics/flightModel.ts` | `src/physics/flightModel.ts` | **Verbatim + measured extensions** | `integrateFlight` + `resolveBoost`, and the `FlightBody`/`FlightInputs` shapes. The complete Newtonian model: shared rotational-authority budget, per-axis angular thrust/drag (drag from tick-start angVel), snap-to-zero floor, per-direction engine **spool delays** (main/retro/vertical), **space brake** (combined-axis velocity controller), **coastDecel** flat coast, per-axis proportional drag while thrusting, and the **flight-computer speed governor**. Extended beyond the port by this project's own captures — notably the **aligned vs countering** split for boosted linear thrust (2026-08-02, see `RETRO.md`), which is a real behavioural branch rather than a retune. |
| `src/physics/shipTypes.ts` | `src/ship/shipTypes.ts` | **Verbatim** (values) | The `Gladius` `ShipType` with every measured constant. Full measurement provenance was summarised into the file's comment; the original file has the exhaustive frame-by-frame traces. |
| `src/core/types.ts` | `src/types.ts` | **Adapted** | Ported the value types the flight model needs: `Vec3`, `Quat`, `AngularState`, `ShipType`. |
| `src/math/vec.ts` | `src/math/vec.ts` | **Verbatim + extended** | `clamp`, `addScaled`, `cross`, `normalize` verbatim, plus universe-scale/character-controller additions (`dot`, `sub`, `add`, `scale`, `length`, `clone`, `projectOntoPlane`, `rotateAboutAxis`). |
| `src/math/quaternion.ts` | `src/math/quaternion.ts` | **Verbatim (subset)** | `quatMultiply`, `quatNormalize`, `rotateVecByQuat`, `integrateOrientation`, `computeAxes`, `lookAtQuat`, `quatFromAxes`, `slerp`, plus `rotateTowards` for AI steering. |
| `tests/shipTuning.test.ts` | `tests/shipTuning.test.ts` | **Adapted** | Guards the ported invariants (`angularThrust==maxAngVel*angularDrag`, boost derivations, verticalDown==verticalUp/2) plus a behavioural check that full throttle settles at `scmSpeed`. |

**Ported concepts/behaviours (not files):** `dt` clamped to 50 ms; quaternion-only ship attitude
with body-frame integration (load-bearing); first-person camera with no offset (ship mesh hidden
while piloting, same as the original's cockpit-less first person); additive input summing across
device types; decoupled as an edge toggle vs. space brake as a hold, kept distinct.

Combat, scenarios, the full input/rebind stack, and the flight recorder all started life in the
original project too, but have since been substantially rebuilt or extended for this architecture
rather than kept as a straight port — `CLAUDE.md`'s Scenarios section has the current file map.

---

## Not yet built (scope boundary)

Real ship/character/station **models** (currently procedural primitives), **station-interior**
walking, **atmosphere/terrain**, **universe streaming** (bodies are a static list), and a near-field
obstacle/hazard concept are the genuinely outstanding pieces. None of these should require changing
the layer boundaries above. See `CLAUDE.md` for the exhaustive list.

---

## Verifying changes (nothing renders in `npm test`)

`npm test` only covers pure logic. To verify gameplay/render, drive the real app in a headless
browser (same recipe as the original's `.claude/skills/verify`):

- **Playwright** is available globally (`C:\Users\Gam3r1\node_modules`, v1.61.1 + Chromium). Don't
  install it into this repo. Run scripts with `cd ~ && node <script>.mjs`.
- Launch Chromium with software-WebGL flags:
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`.
  WebGL2 works headless this way (confirmed).
- `main.ts` exposes live state as **`window.__world`** for assertions.
- Keyboard events go on `window` — no canvas focus needed. **Do NOT click the canvas** (pointer-lock
  confines the real OS cursor — see the original's verify notes).
- Screenshots are the practical way to judge visuals (the sun/planet/moon passes were verified this
  way).

---

## Environment gotchas (Windows)

- **Node 20.18** is installed; Vite 7 prints a "wants 20.19+" warning but builds/serves fine.
- The **Bash tool resets cwd on `cd`** — run local binaries directly via PowerShell, e.g.
  `& "C:\dev\sc_webgl\node_modules\.bin\tsc.cmd" -p C:\dev\sc_webgl\tsconfig.json --noEmit`.

---

## Suggested next steps (priority order)

1. **Ship model** — the current boxy primitive is the biggest visual weakness. Either a much richer
   procedural Gladius or a real glTF asset (get user sign-off before pulling third-party files).
2. **More ships** — the flight model and scenario/AI system are ship-agnostic; adding SC ships
   beyond the Gladius mostly means measuring and porting more `ShipType` data.
3. **Richer on-foot** — station structures, non-sphere (mesh/box) surface collision, jetpack/EVA.
4. **Universe** — more bodies, body streaming, larger distances, docking.
