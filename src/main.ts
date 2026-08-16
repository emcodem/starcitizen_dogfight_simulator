import './style.css';

import { makeWorld } from './core/player';
import { Renderer } from './render/renderer';
import { initInput, endFrame } from './input/input';
import { stepPilot } from './control/pilot';
import { stepFoot } from './control/foot';
import { handleEdgeActions } from './control/mode';
import { stepCombat } from './combat/combatSystem';
import { updateScenario, startScenario } from './scenarios/runtime';
import { SCENARIOS } from './scenarios/definitions';
import { getShipType } from './physics/ships';
import { lookAtQuat, rotateVecByQuat } from './math/quaternion';
import { updatePipTrainer, startPipTrainer, PIP_TRAINER_DEFAULTS } from './combat/pipTrainer';
import { updateRollTrainer, startRollTrainer, ROLL_TRAINER_DEFAULTS } from './combat/rollTrainer';
import { checkScenarioResult, checkPipTrainerResult, checkRollTrainerResult } from './ui/scenarioMenu';
import { updateHUD } from './hud/hud';
import { sampleFrame } from './hud/fpsTracker';
import { updatePerfHint } from './hud/perfHint';
import { initUI, isPaused } from './ui';
import { syncTouchControls } from './ui/touchControls';
import { tickReplayPanelUI } from './ui/replayPanel';
import * as Gamepad from './input/gamepad';
import * as AxisCurve from './input/axisCurve';
import * as MouseLook from './input/mouseLook';
import * as Recorder from './replay/recorder';
import * as ReplayPlayer from './replay/player';
import * as FreeCamera from './control/freeCamera';
import * as RemoteMouseInput from './input/remoteMouseInput';
import * as VjoyRecorder from './debug/vjoyRecorder';
import * as YawRateRecorder from './debug/yawRateRecorder';

// ============================================================================================
// Bootstrap + main loop. The world is renderer-agnostic sim state; each frame we run one control
// tick for whichever mode the player is in (pilot or on foot), then the render layer draws it
// camera-relative. dt is clamped to 50ms (matching the original project) so a stall can't blow up
// the integrator — the flight model converges regardless of frame rate.
// ============================================================================================

const canvas = document.getElementById('c') as HTMLCanvasElement;

const world = makeWorld();
initInput(canvas);
const renderer = new Renderer(canvas, world);
initUI(world); // restores the last-active control preset, if any — see ui/controlsPanel/presetsUI.ts

// Expose live state for headless/browser verification (see the original project's verify skill).
(window as unknown as { __world: typeof world }).__world = world;

// Same convention -- exposes the render layer for GPU performance profiling (A/B toggling bloom,
// individual scene objects, post-processing) from a headless/headed browser harness.
(window as unknown as { __renderer: typeof renderer }).__renderer = renderer;

// Debug hook for headless verification, same convention as __world above — lets a test script
// jump straight to a named scenario (see scenarios/definitions.ts's SCENARIOS ids) without driving
// the F3 menu's DOM.
(window as unknown as { __startScenario: (id: string) => void }).__startScenario = (id: string) => {
  const config = SCENARIOS.find(s => s.id === id);
  if (config) startScenario(world, config);
};

// TEMP repro helper for the 2026-08-16 turret-fire blackout/flicker report: a stationary turret
// spawned dead ahead, ALREADY aimed at the player (so it clears the 'turret' AI's ~3deg
// AIM_FIRE_CONE_RAD gate on frame 1 — no turn-in delay), with both hit-count lose conditions set
// effectively unreachable so the encounter just keeps firing indefinitely for repeated testing
// (health can still drop to 0 from real damage — call this again to respawn a fresh encounter).
// Usage: __debugPointBlankTurret() from the console, then watch for stars/lasers vanishing.
(window as unknown as { __debugPointBlankTurret: (distanceM?: number) => void }).__debugPointBlankTurret = (distanceM = 100) => {
  const ship = world.player.ship;
  const fwd = rotateVecByQuat({ x: 0, y: 0, z: 1 }, ship.quat);
  const pos = {
    x: ship.pos.x + fwd.x * distanceM,
    y: ship.pos.y + fwd.y * distanceM,
    z: ship.pos.z + fwd.z * distanceM,
  };
  const toPlayer = { x: ship.pos.x - pos.x, y: ship.pos.y - pos.y, z: ship.pos.z - pos.z };
  const gladius = getShipType('Gladius');
  startScenario(world, {
    id: 'debug-point-blank-turret',
    name: 'Debug: Point-Blank Turret',
    description: 'Dev repro — a turret dead ahead, already aimed, fires continuously with no gaps.',
    enemySpawns: [{
      type: gladius,
      pos,
      quat: lookAtQuat(toPlayer),
      behavior: 'turret',
      turnRateRadPerSec: gladius.maxAngVel.yaw,
    }],
    hitsToKillEnemy: 999_999,
    hitsToKillPlayer: 999_999,
    includeStation: false,
    winCondition: 'survive',
  });
};

// Same convention — live-tune the shared input expo curve from the console while comparing against
// real SC side-by-side (e.g. __setInputExpo(1.6)). Also settable via the F4 mouse-look panel slider.
(window as unknown as { __setInputExpo: (v: number) => void }).__setInputExpo = (v: number) => {
  AxisCurve.setExponent(v);
};

// Same convention — jump straight into the PIP Trainer (see ui/mainMenu.ts's startPipTrainer
// wiring) without driving the F3 picker's DOM.
(window as unknown as { __startPipTrainer: (opts?: Partial<typeof PIP_TRAINER_DEFAULTS>) => void }).__startPipTrainer = (opts) => {
  world.enemies = [];
  world.pipTrainer = startPipTrainer(world.player.ship, { ...PIP_TRAINER_DEFAULTS, ...opts });
};

// Same convention — jump straight into the Roll Trainer (see ui/mainMenu.ts's startRollTrainer
// wiring) without driving the F3 picker's DOM.
(window as unknown as { __startRollTrainer: (opts?: Partial<typeof ROLL_TRAINER_DEFAULTS>) => void }).__startRollTrainer = (opts) => {
  world.enemies = [];
  world.rollTrainer = startRollTrainer(world.player.ship, { ...ROLL_TRAINER_DEFAULTS, ...opts });
};

// Enable/disable remote mouse input from capture server.
(window as unknown as { __remoteMouseInput: (enable: boolean) => void }).__remoteMouseInput = (enable: boolean) => {
  if (enable) {
    RemoteMouseInput.connect();
    console.log('[CONSOLE] Remote mouse input enabled. Run: npm run capture');
  } else {
    RemoteMouseInput.disconnect();
    console.log('[CONSOLE] Remote mouse input disabled');
  }
};

// Same convention -- records the raw vjoy accumulator over time for comparing against real SC's
// indicator (tracked on video via capture/analysis/track_vjoy_indicator.py). See debug/vjoyRecorder.ts.
// Usage: __vjoyLog.start(), run the mouse maneuver, __vjoyLog.stop() (downloads a CSV).
(window as unknown as { __vjoyLog: typeof VjoyRecorder }).__vjoyLog = VjoyRecorder;

// Same convention -- records the ship's computed yaw/pitch rate over time, for comparing against
// real SC's yaw rate at the same held raw mouse counts (capture/YAWCAPTURE.md procedure B). See
// debug/yawRateRecorder.ts. Usage: __yawLog.start(), run the maneuver, __yawLog.stop() (downloads a CSV).
(window as unknown as { __yawLog: typeof YawRateRecorder }).__yawLog = YawRateRecorder;

let last = performance.now();
function loop(now: number): void {
  const rawDt = (now - last) / 1000;
  const dt = Math.min(0.05, rawDt);
  last = now;
  sampleFrame(rawDt);
  updatePerfHint(rawDt);
  try {
    // polled unconditionally (even while paused) so the controls panel's device list and
    // wiggle-to-bind capture keep working while the sim itself is frozen
    Gamepad.poll();

    // Unconditional (even while paused), same reasoning as Gamepad.poll() above -- a no-op unless
    // __vjoyLog.start() was called, and offsetX/offsetY can change via the local mousemove listener
    // regardless of pause state, so sampling needs to run every frame to not miss anything.
    VjoyRecorder.sample();
    YawRateRecorder.sample(world.player.ship.angVel);

    // sim fully freezes (but keeps rendering) while a menu/panel overlay is open
    if (!isPaused()) {
      if (ReplayPlayer.isActive()) {
        // A loaded replay clip takes over the whole step block — no live input/AI/combat runs,
        // it just interpolates recorded state into world.player.ship/world.enemies[] each frame
        // (see replay/player.ts). Never recorded itself (no replay of a replay).
        ReplayPlayer.stepPlayback(world, dt);
        // free-fly spectator camera (see control/freeCamera.ts) — a no-op unless the transport
        // bar's "Free Camera" toggle enabled it; steerable independent of play/pause state.
        FreeCamera.step(dt);
      } else {
        // Remote mouse (captured from real SC — see input/remoteMouseInput.ts) drives the same
        // virtual stick as the local pointer-lock mouse. Drain the accumulated raw delta once per
        // frame and integrate it, mirroring SC's own mouse->stick accumulation.
        if (RemoteMouseInput.isConnected()) {
          const rd = RemoteMouseInput.consumeDelta();
          if (rd.dx !== 0 || rd.dy !== 0) MouseLook.injectDelta(rd.dx, rd.dy);
        }
        // controls freeze while the ship is destroyed and waiting to respawn, or once a scenario's
        // outcome has left 'active' (won/lost) — the result screen takes over from there. The F/C
        // edge actions (enter/exit, decouple) are gated too: firing them mid-respawn would park and
        // disembark a ship that stepCombat is about to teleport back to spawn.
        const controlsLive = world.player.ship.respawnTimer <= 0
          && (!world.scenario || world.scenario.outcome === 'active');
        if (controlsLive) {
          handleEdgeActions(world);
          if (world.player.mode === 'pilot') stepPilot(world, dt);
          else stepFoot(world, dt);
        }
        if (world.scenario) updateScenario(world, dt);
        else stepCombat(world, dt);
        // PIP Trainer is fully additive — layered on top of whatever stepPilot/stepFoot/stepCombat
        // already did to the ship/world this frame, regardless of pilot/on-foot mode (see
        // combat/pipTrainer.ts's doc comment on why it never touches world.enemies/hit detection).
        if (world.pipTrainer) updatePipTrainer(world.pipTrainer, world.player.ship, dt);
        if (world.rollTrainer) updateRollTrainer(world.rollTrainer, world.player.ship, dt);
        checkScenarioResult(world); // opens the F3 results view the instant an outcome leaves 'active'
        checkPipTrainerResult(world);
        checkRollTrainerResult(world);

        // always-on rolling recording buffer (see replay/recorder.ts) — ship flight only, same
        // controlsLive gate as the flight/combat stepping above.
        if (controlsLive && world.player.mode === 'pilot') Recorder.sampleTick(world, dt);
      }
    }

    renderer.render(world);
    updateHUD(world);
    syncTouchControls(world);
    tickReplayPanelUI();
  } catch (err) {
    console.error('Frame error (continuing):', err);
  } finally {
    endFrame();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
