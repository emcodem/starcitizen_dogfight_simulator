import type { EnemyShip, Ship, Vec3 } from '../types';
import type { ScenarioRuntime } from '../scenarios/types';
import { clamp } from '../math/vec';
import { computeAxes, type ShipAxes } from '../math/quaternion';
import { STATION, isStationActive } from '../world/station';
import { WEAPON, projectiles } from '../world/weapons';
import * as MouseLook from '../input/mouseLook';
import * as EspAssist from '../combat/espAssist';
import { findActivePip } from '../combat/pipTargeting';
import { ENEMY_EXPLOSION_DURATION } from '../scenarios/runtime';
import { project as projectShared, type Camera, type ProjectedPoint } from './projection';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctxOrNull = canvas.getContext('2d');
if (!ctxOrNull) throw new Error('2D canvas context unavailable');
const ctx = ctxOrNull;

// ---------- Simple star field for spatial reference ----------
const stars: Vec3[] = [];
for (let i = 0; i < 400; i++) {
  stars.push({
    x: (Math.random() - 0.5) * 4000,
    y: (Math.random() - 0.5) * 4000,
    z: Math.random() * 4000
  });
}

// ---------- Static beacon markers (near-field, for gauging speed/direction) ----------
const beacons: Vec3[] = [];
const BEACON_FIELD = 1400; // wrap range, much tighter than star field so they read as "close"
for (let i = 0; i < 140; i++) {
  beacons.push({
    x: (Math.random() - 0.5) * BEACON_FIELD * 2,
    y: (Math.random() - 0.5) * BEACON_FIELD * 2,
    z: (Math.random() - 0.5) * BEACON_FIELD * 2
  });
}

function project(px: number, py: number, pz: number, cam: Camera): ProjectedPoint | null {
  return projectShared(px, py, pz, cam, canvas.width, canvas.height);
}

function drawLine3D(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, cam: Camera): void {
  const p1 = project(x1, y1, z1, cam);
  const p2 = project(x2, y2, z2, cam);
  if (!p1 || !p2) return;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
}

function drawMouseReticle(): void {
  const { x, y, max } = MouseLook.getOffset();
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const scale = 0.55; // keep the reticle's travel visually inside the crosshair area
  const rx = cx + x * scale, ry = cy + y * scale;

  ctx.strokeStyle = 'rgba(143,211,199,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, max * scale, 0, Math.PI * 2); ctx.stroke();

  ctx.strokeStyle = '#ff7a45';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(rx, ry, 5, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(rx, ry); ctx.stroke();
}

function drawProjectiles(cam: Camera): void {
  for (const pr of projectiles) {
    const speed = Math.hypot(pr.vel.x, pr.vel.y, pr.vel.z) || 1;
    const dirx = pr.vel.x / speed, diry = pr.vel.y / speed, dirz = pr.vel.z / speed;
    const trailLen = 14;
    const tail = {
      x: pr.pos.x - dirx * trailLen,
      y: pr.pos.y - diry * trailLen,
      z: pr.pos.z - dirz * trailLen
    };
    const head = project(pr.pos.x, pr.pos.y, pr.pos.z, cam);
    const tailP = project(tail.x, tail.y, tail.z, cam);
    if (!head) continue;
    const fade = clamp(1 - pr.age / WEAPON.lifetime, 0.15, 1);
    const tracerColor = pr.owner === 'enemy' ? '255, 90, 90' : '255, 230, 150';
    if (tailP) {
      ctx.strokeStyle = `rgba(${tracerColor}, ${fade.toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tailP.x, tailP.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();
    }
    ctx.fillStyle = `rgba(255, 255, 255, ${fade.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(head.x, head.y, clamp(head.scale * 0.8, 1, 3), 0, Math.PI * 2);
    ctx.fill();
  }
}

// Oriented wireframe box — center + half-extents along the given right/up/forward axes (world
// axes for an axis-aligned box like the station; a ship's own computeAxes() for a hull silhouette
// that rotates with it).
function drawWireBox(center: Vec3, halfExtents: Vec3, axes: ShipAxes, cam: Camera, color: string): void {
  const { right, up, forward } = axes;
  const corners: Vec3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    corners.push({
      x: center.x + sx * halfExtents.x * right.x + sy * halfExtents.y * up.x + sz * halfExtents.z * forward.x,
      y: center.y + sx * halfExtents.x * right.y + sy * halfExtents.y * up.y + sz * halfExtents.z * forward.y,
      z: center.z + sx * halfExtents.x * right.z + sy * halfExtents.y * up.z + sz * halfExtents.z * forward.z
    });
  }
  // 12 edges of a cube, indices into the 8 corners generated above (order: x,y,z each -1/1)
  const edges = [
    [0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3],
    [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]
  ];
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  for (const [a, b] of edges) {
    drawLine3D(corners[a].x, corners[a].y, corners[a].z, corners[b].x, corners[b].y, corners[b].z, cam);
  }
}

const WORLD_AXES: ShipAxes = { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, forward: { x: 0, y: 0, z: 1 } };

function drawStation(cam: Camera): void {
  const h = STATION.halfSize;
  drawWireBox(STATION.pos, { x: h, y: h, z: h }, WORLD_AXES, cam, '#ff4d4d');
}

function drawEnemyHull(enemy: EnemyShip, cam: Camera): void {
  if (enemy.health.points <= 0) return;
  const h = enemy.type.hullRadius;
  drawWireBox(enemy.pos, { x: h * 0.6, y: h * 0.2, z: h }, computeAxes(enemy.quat), cam, '#ff7a45');
}

function drawPip(ship: Ship, scenario: ScenarioRuntime, cam: Camera): void {
  const active = findActivePip(ship.pos, ship.vel, cam, scenario.enemies, canvas.width, canvas.height);
  if (!active) return;
  ctx.strokeStyle = '#ffe696';
  ctx.lineWidth = 1.5;
  const r = 8;
  ctx.beginPath();
  ctx.moveTo(active.screenX, active.screenY - r);
  ctx.lineTo(active.screenX + r, active.screenY);
  ctx.lineTo(active.screenX, active.screenY + r);
  ctx.lineTo(active.screenX - r, active.screenY);
  ctx.closePath();
  ctx.stroke();
}

// Brief burst at an enemy's last position when it's destroyed, so a kill reads as an event instead
// of the hull silently vanishing (drawEnemyHull stops drawing it the instant health hits 0).
function drawEnemyExplosions(scenario: ScenarioRuntime, cam: Camera): void {
  for (const ex of scenario.explosions) {
    const p = project(ex.pos.x, ex.pos.y, ex.pos.z, cam);
    if (!p) continue;
    const progress = 1 - ex.timer / ENEMY_EXPLOSION_DURATION;
    const alpha = 1 - progress;
    const ringRadius = (10 + progress * 45) * clamp(p.scale, 0.3, 3);

    ctx.strokeStyle = `rgba(255, 170, 80, ${alpha.toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, ringRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = `rgba(255, 225, 160, ${(alpha * 0.7).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, ringRadius * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ESP reticle — a smaller ring than the mouse-look virtual-stick circle, always visible (unlike
// that one, which only shows while mouse-look is captured), since ESP dampening applies to any
// input device once a PIP enters it.
function drawEspCircle(): void {
  const cx = canvas.width / 2, cy = canvas.height / 2;
  ctx.strokeStyle = 'rgba(255,122,69,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, EspAssist.getCircleRadius(), 0, Math.PI * 2);
  ctx.stroke();
}

// "Fly through this ring" gate-path overlay for the barrel-roll evasion drills. Draws a projected
// circle at each remaining gate — bright for the current target, dim for the couple ahead of it —
// so the player has both a spatial and a sequential guide for the maneuver. Cleared gates are
// simply skipped, not drawn.
function drawGatePath(scenario: ScenarioRuntime, cam: Camera): void {
  const gates = scenario.config.gatePath;
  if (!gates) return;
  const SEGMENTS = 24;
  const MAX_GATES_SHOWN = 3; // only render the current gate + a couple ahead, to avoid clutter

  for (let i = scenario.gateIndex; i < Math.min(gates.length, scenario.gateIndex + MAX_GATES_SHOWN); i++) {
    const gate = gates[i];
    const isActive = i === scenario.gateIndex;
    const { right, up } = computeAxes(gate.quat);

    const ring: Vec3[] = [];
    for (let s = 0; s < SEGMENTS; s++) {
      const a = (s / SEGMENTS) * Math.PI * 2;
      const cosA = Math.cos(a) * gate.radius, sinA = Math.sin(a) * gate.radius;
      ring.push({
        x: gate.pos.x + right.x * cosA + up.x * sinA,
        y: gate.pos.y + right.y * cosA + up.y * sinA,
        z: gate.pos.z + right.z * cosA + up.z * sinA
      });
    }

    ctx.strokeStyle = isActive ? '#7ad1ff' : 'rgba(122,209,255,0.3)';
    ctx.lineWidth = isActive ? 2.2 : 1;
    for (let s = 0; s < SEGMENTS; s++) {
      const p1 = ring[s], p2 = ring[(s + 1) % SEGMENTS];
      drawLine3D(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, cam);
    }
  }
}

// General-purpose hit feedback — not scenario-specific, just reacts to ship.hitFlash (set by
// combat/hitDetection.ts on any confirmed hit against the player, decayed in physics/step.ts).
// Deliberately subtle: a quick cue, not a distraction from flying.
function drawHitFlash(ship: Ship): void {
  if (ship.hitFlash <= 0) return;
  const alpha = ship.hitFlash * 0.15;
  ctx.fillStyle = `rgba(255, 40, 40, ${alpha.toFixed(3)})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawExplosion(progress: number): void {
  // progress goes 0 -> 1 over the 1 second explosion; full-screen flash that fades and radiates
  const alpha = 1 - progress;
  ctx.fillStyle = `rgba(255, 140, 60, ${(alpha * 0.85).toFixed(3)})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width / 2, cy = canvas.height / 2;
  ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
  ctx.lineWidth = 2;
  const rayCount = 14;
  for (let i = 0; i < rayCount; i++) {
    const angle = (i / rayCount) * Math.PI * 2;
    const len = 60 + progress * Math.max(canvas.width, canvas.height) * 0.6;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
    ctx.stroke();
  }

  ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
  ctx.font = '16px Courier New';
  ctx.textAlign = 'center';
  ctx.fillText('COLLISION — RESETTING', cx, cy + 80);
}

function drawProgradeMarker(ship: Ship, cam: Camera): void {
  const p = ship.pos;
  const speed = Math.hypot(ship.vel.x, ship.vel.y, ship.vel.z);
  if (speed > 0.5) {
    const progradePoint = {
      x: p.x + ship.vel.x / speed * 40,
      y: p.y + ship.vel.y / speed * 40,
      z: p.z + ship.vel.z / speed * 40
    };
    const pp = project(progradePoint.x, progradePoint.y, progradePoint.z, cam);
    if (pp) {
      ctx.strokeStyle = '#8fd3c7';
      ctx.beginPath(); ctx.arc(pp.x, pp.y, 6, 0, Math.PI * 2); ctx.stroke();
    }
  }
}

function updateHUD(ship: Ship, scenario: ScenarioRuntime | null): void {
  const scenarioHud = document.getElementById('scenario-hud') as HTMLElement;
  if (scenario) {
    scenarioHud.style.display = 'block';
    document.getElementById('scenario-hud-name')!.textContent = scenario.config.name;

    const isGates = scenario.config.winCondition === 'gates';
    const isSurvive = scenario.config.winCondition === 'survive';
    (document.getElementById('scenario-hud-enemy-row') as HTMLElement).style.display = (isGates || isSurvive) ? 'none' : 'flex';
    (document.getElementById('scenario-hud-gate-row') as HTMLElement).style.display = isGates ? 'flex' : 'none';
    (document.getElementById('scenario-hud-timer-row') as HTMLElement).style.display = (isGates || isSurvive) ? 'flex' : 'none';

    if (isGates) {
      const gateTotal = scenario.config.gatePath?.length ?? 0;
      document.getElementById('scenario-hud-gate')!.textContent =
        `${Math.min(scenario.gateIndex + 1, gateTotal)}/${gateTotal}`;
      const remaining = Math.max(0, (scenario.config.surviveDurationSec ?? 0) - scenario.elapsedSec);
      document.getElementById('scenario-hud-timer')!.textContent = `${remaining.toFixed(1)}s`;
    } else if (isSurvive) {
      const remaining = Math.max(0, (scenario.config.surviveDurationSec ?? 0) - scenario.elapsedSec);
      document.getElementById('scenario-hud-timer')!.textContent = `${remaining.toFixed(1)}s`;
    } else {
      const enemy = scenario.enemies[0];
      const enemyHits = enemy ? enemy.health.maxPoints - enemy.health.points : 0;
      const enemyMax = enemy ? enemy.health.maxPoints : 0;
      document.getElementById('scenario-hud-enemy-hits')!.textContent = `${enemyHits}/${enemyMax}`;
    }

    const playerHits = ship.health ? ship.health.maxPoints - ship.health.points : 0;
    const playerMax = ship.health ? ship.health.maxPoints : 0;
    document.getElementById('scenario-hud-player-hits')!.textContent = `${playerHits}/${playerMax}`;
  } else {
    scenarioHud.style.display = 'none';
  }

  const speed = Math.hypot(ship.vel.x, ship.vel.y, ship.vel.z);
  document.getElementById('s-throttle')!.textContent = Math.round(ship.throttle * 100) + '%';
  (document.getElementById('bar-throttle') as HTMLElement).style.width = Math.round(Math.abs(ship.throttle) * 100) + '%';
  const boostPct = Math.round((ship.boostMeter / ship.type.boostCapacity) * 100);
  const boostEl = document.getElementById('s-boost')!;
  boostEl.textContent = boostPct + '%';
  boostEl.className = ship.boosting ? 'value on' : 'value';
  (document.getElementById('bar-boost') as HTMLElement).style.width = boostPct + '%';
  document.getElementById('s-speed')!.textContent = speed.toFixed(1) + ' m/s';
  const decoupledEl = document.getElementById('s-decoupled')!;
  decoupledEl.textContent = ship.decoupled ? 'ON' : 'OFF';
  decoupledEl.className = ship.decoupled ? 'value on' : 'value';
  const brakeEl = document.getElementById('s-brake')!;
  brakeEl.textContent = ship.spaceBrakeOn ? 'ON' : 'OFF';
  brakeEl.className = ship.spaceBrakeOn ? 'value on' : 'value';
  document.getElementById('s-mass')!.textContent = ship.type.mass.toFixed(2);
  document.getElementById('s-ship')!.textContent = ship.type.name;
}

export function render(ship: Ship, scenario: ScenarioRuntime | null = null): void {
  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // first-person cockpit view: camera sits at the pilot's seat and uses the ship's
  // full orientation (including roll) — no chase offset, so no swinging/orbiting.
  const { forward, right, up } = computeAxes(ship.quat);
  const cam: Camera = {
    pos: { x: ship.pos.x, y: ship.pos.y, z: ship.pos.z },
    axes: { forward, right, up }
  };

  // stars
  ctx.fillStyle = '#3d5a54';
  for (const s of stars) {
    const wx = ((s.x + ship.pos.x * 0.02) % 4000 + 4000) % 4000 - 2000;
    const wy = ((s.y + ship.pos.y * 0.02) % 4000 + 4000) % 4000 - 2000;
    const wz = ((s.z + ship.pos.z) % 4000 + 4000) % 4000;
    const p = project(wx, wy, wz, cam);
    if (p) {
      const r = clamp(p.scale * 0.6, 0.3, 2.2);
      ctx.globalAlpha = clamp(1 - p.depth / 3000, 0.15, 1);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // reference grid plane at y=0 for spatial orientation
  ctx.strokeStyle = 'rgba(61,90,84,0.35)';
  ctx.lineWidth = 1;
  const gridSize = 2000, gridStep = 200;
  for (let gx = -gridSize; gx <= gridSize; gx += gridStep) {
    drawLine3D(gx, 0, -gridSize, gx, 0, gridSize, cam);
  }
  for (let gz = -gridSize; gz <= gridSize; gz += gridStep) {
    drawLine3D(-gridSize, 0, gz, gridSize, 0, gz, cam);
  }

  // vertical pillars at grid intersections near the ship, for full 3D depth reference
  ctx.strokeStyle = 'rgba(61,90,84,0.22)';
  const pillarStep = 400, pillarRange = 1200, pillarHeight = 600;
  const ox = Math.round(ship.pos.x / pillarStep) * pillarStep;
  const oz = Math.round(ship.pos.z / pillarStep) * pillarStep;
  for (let px = ox - pillarRange; px <= ox + pillarRange; px += pillarStep) {
    for (let pz = oz - pillarRange; pz <= oz + pillarRange; pz += pillarStep) {
      drawLine3D(px, -pillarHeight, pz, px, pillarHeight, pz, cam);
    }
  }

  // static beacon markers — wrapped near ship so they always surround it, used to read speed/direction
  ctx.fillStyle = '#8fd3c7';
  ctx.strokeStyle = '#8fd3c7';
  for (const b of beacons) {
    const M = BEACON_FIELD * 2;
    const wx = ((b.x + ship.pos.x) % M + M) % M - BEACON_FIELD;
    const wy = ((b.y + ship.pos.y) % M + M) % M - BEACON_FIELD;
    const wz = ((b.z + ship.pos.z) % M + M) % M - BEACON_FIELD;
    const p = project(wx, wy, wz, cam);
    if (p) {
      const r = clamp(p.scale * 1.4, 0.6, 4);
      ctx.globalAlpha = clamp(1 - p.depth / BEACON_FIELD * 0.6, 0.25, 1);
      ctx.beginPath();
      ctx.moveTo(p.x - r * 2, p.y); ctx.lineTo(p.x + r * 2, p.y);
      ctx.moveTo(p.x, p.y - r * 2); ctx.lineTo(p.x, p.y + r * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // static station — a fixed hazard to practice flying around and avoiding (some scenarios hide it)
  if (isStationActive()) drawStation(cam);

  // scenario opponent(s), if any
  if (scenario) {
    for (const enemy of scenario.enemies) drawEnemyHull(enemy, cam);
    drawEnemyExplosions(scenario, cam);
  }

  // weapon tracers
  drawProjectiles(cam);

  // prograde velocity marker (still useful from the cockpit to read decoupled drift)
  drawProgradeMarker(ship, cam);

  // predicted-impact-point — only within PIP_RANGE of a live target
  if (scenario) drawPip(ship, scenario, cam);

  // barrel-roll gate path overlay, for evasion drills
  if (scenario) drawGatePath(scenario, cam);

  // subtle red flash whenever the player takes a hit — general feedback, any scenario
  drawHitFlash(ship);

  // explosion flash overlay on collision
  if (ship.exploding) {
    drawExplosion(1 - ship.explosionTimer / 1.0);
  }

  // mouse-look virtual stick reticle — shows current deflection from center
  if (MouseLook.isCaptured()) {
    drawMouseReticle();
  }

  // ESP dampening zone — always visible, regardless of input device
  drawEspCircle();

  updateHUD(ship, scenario);
}
