import type { EnemyShip, Ship, Vec3 } from '../types';
import type { ScenarioRuntime } from '../scenarios/types';
import { clamp, cross, normalize } from '../math/vec';
import { computeAxes, type ShipAxes } from '../math/quaternion';
import { STATION, isStationActive } from '../world/station';
import { WEAPON, projectiles } from '../world/weapons';
import * as MouseLook from '../input/mouseLook';
import * as EspAssist from '../combat/espAssist';
import { findActivePip } from '../combat/pipTargeting';
import { ENEMY_EXPLOSION_DURATION, bubbleTicks } from '../scenarios/runtime';
import { project as projectShared, type Camera, type ProjectedPoint } from './projection';
import type { PipTrainerOptions, PipTrainerState } from '../combat/pipTrainer';
import { SCORE_FLASH_DURATION } from '../combat/pipTrainer';

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

// Shifts a '#rrggbb' color toward white (percent > 0) or black (percent < 0) — used to fake
// per-panel metal shading on the drone silhouette without any real lighting/material pipeline.
function shadeHex(hex: string, percent: number): string {
  const num = parseInt(hex.slice(1), 16);
  const shadeChannel = (c: number): number =>
    Math.round(percent >= 0 ? c + (255 - c) * percent : c * (1 + percent));
  const r = shadeChannel((num >> 16) & 0xff);
  const g = shadeChannel((num >> 8) & 0xff);
  const b = shadeChannel(num & 0xff);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

const vecSub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const vecDot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

// Fixed world-space light (above and slightly ahead) that every drone's panels shade against —
// this is what makes rotating panels catch/lose light like flat metal instead of a flat wireframe.
const PANEL_LIGHT_DIR: Vec3 = { x: -0.35, y: 0.85, z: -0.25 };
const PANEL_LIGHT_LEN = Math.hypot(PANEL_LIGHT_DIR.x, PANEL_LIGHT_DIR.y, PANEL_LIGHT_DIR.z);
const PANEL_LIGHT: Vec3 = { x: PANEL_LIGHT_DIR.x / PANEL_LIGHT_LEN, y: PANEL_LIGHT_DIR.y / PANEL_LIGHT_LEN, z: PANEL_LIGHT_DIR.z / PANEL_LIGHT_LEN };

// Flat-shaded color for a triangular hull panel: normal from the three corners (flipped outward
// relative to the ship's center if needed, since winding order alone doesn't guarantee that),
// dotted with the fixed light to get a per-panel brightness — cheap stand-in for real lighting.
function panelShade(p1: Vec3, p2: Vec3, p3: Vec3, center: Vec3, baseColor: string): string {
  let normal = normalize(cross(vecSub(p2, p1), vecSub(p3, p1)));
  const centroid = { x: (p1.x + p2.x + p3.x) / 3, y: (p1.y + p2.y + p3.y) / 3, z: (p1.z + p2.z + p3.z) / 3 };
  if (vecDot(normal, vecSub(centroid, center)) < 0) normal = { x: -normal.x, y: -normal.y, z: -normal.z };
  const intensity = vecDot(normal, PANEL_LIGHT);
  return shadeHex(baseColor, intensity * 0.45);
}

// Real Aegis Gladius dimensions (17.5 x 21 x 5.5 m, length x span x height), halved for the
// center-relative offsets drawDroneSilhouette builds its wireframe from.
const GLADIUS_HALF_LENGTH = 17.5 / 2;
const GLADIUS_HALF_SPAN = 21 / 2;
const GLADIUS_HALF_HEIGHT = 5.5 / 2;

// Fighter-like wireframe silhouette used for every enemy hull, sized to real Gladius dimensions so
// nose-tail/wingtip-wingtip/top-bottom span exactly 17.5/21/5.5 m — unlike drawWireBox's symmetric
// cuboid (used only for the station), this has a distinct pointed nose and swept wings so the player
// can read facing and bank at a glance instead of just position.
function drawDroneSilhouette(center: Vec3, axes: ShipAxes, cam: Camera, color: string): void {
  const { right, up, forward } = axes;
  const toWorld = (rx: number, ry: number, rz: number): Vec3 => ({
    x: center.x + rx * right.x + ry * up.x + rz * forward.x,
    y: center.y + rx * right.y + ry * up.y + rz * forward.y,
    z: center.z + rx * right.z + ry * up.z + rz * forward.z
  });

  const tailWidth = GLADIUS_HALF_SPAN * 0.35;
  const wingZ = -GLADIUS_HALF_LENGTH * 0.15;
  const nose = toWorld(0, 0, GLADIUS_HALF_LENGTH);
  const tailTop = toWorld(0, GLADIUS_HALF_HEIGHT, -GLADIUS_HALF_LENGTH);
  const tailLeft = toWorld(-tailWidth, -GLADIUS_HALF_HEIGHT, -GLADIUS_HALF_LENGTH);
  const tailRight = toWorld(tailWidth, -GLADIUS_HALF_HEIGHT, -GLADIUS_HALF_LENGTH);
  const wingLeft = toWorld(-GLADIUS_HALF_SPAN, 0, wingZ);
  const wingRight = toWorld(GLADIUS_HALF_SPAN, 0, wingZ);

  // Filled, flat-shaded hull panels (actual "plates", not just tinted outlines) — each triangle's
  // brightness comes from its own normal vs. the fixed light, so adjacent panels read as distinct
  // faceted metal surfaces and catch/lose light as the drone rotates.
  // Each triangle's sides must be real wireframe edges (see `edges` below) — using a diagonal
  // that isn't one leaves a sliver of hull bounded by a real edge with no panel filling it.
  const panels: [Vec3, Vec3, Vec3][] = [
    [nose, tailTop, tailLeft], [nose, tailRight, tailTop],
    [nose, wingLeft, tailLeft], [nose, tailRight, wingRight],
    [tailTop, tailRight, tailLeft]
  ];
  for (const [p1, p2, p3] of panels) {
    const proj = [p1, p2, p3].map(v => project(v.x, v.y, v.z, cam));
    if (proj.some(p => p === null)) continue;
    const [s1, s2, s3] = proj as ProjectedPoint[];
    ctx.fillStyle = panelShade(p1, p2, p3, center, color);
    ctx.beginPath();
    ctx.moveTo(s1.x, s1.y);
    ctx.lineTo(s2.x, s2.y);
    ctx.lineTo(s3.x, s3.y);
    ctx.closePath();
    ctx.fill();
  }

  // Outline only the true silhouette edges — the ones bordering exactly one panel above. Edges
  // shared by two panels (nose-tailTop, nose-tailLeft/Right, tailTop-tailLeft/Right) are interior
  // seams between coplanar-ish faces; stroking those drew a stray line straight through the top
  // plate whenever the two panels it joins were both facing the camera (e.g. viewed from above).
  ctx.strokeStyle = shadeHex(color, -0.6);
  ctx.lineWidth = 1.2;
  const edges: [Vec3, Vec3][] = [
    [tailLeft, tailRight],
    [nose, wingLeft], [nose, wingRight],
    [wingLeft, tailLeft], [wingRight, tailRight]
  ];
  for (const [a, b] of edges) {
    drawLine3D(a.x, a.y, a.z, b.x, b.y, b.z, cam);
  }
}

function drawEnemyHull(enemy: EnemyShip, cam: Camera): void {
  if (enemy.health.points <= 0) return;
  drawDroneSilhouette(enemy.pos, computeAxes(enemy.quat), cam, '#ff7a45');
}

// Distance + closing-speed readout under every live enemy, not just the one with an active PIP —
// so the player can read range/closure on the whole field before committing to an attack run,
// same as a real HUD's target-info readout.
function drawEnemyInfo(enemy: EnemyShip, ship: Ship, cam: Camera): void {
  if (enemy.health.points <= 0) return;
  const p = project(enemy.pos.x, enemy.pos.y, enemy.pos.z, cam);
  if (!p) return;

  const relPos: Vec3 = { x: enemy.pos.x - ship.pos.x, y: enemy.pos.y - ship.pos.y, z: enemy.pos.z - ship.pos.z };
  const distance = Math.hypot(relPos.x, relPos.y, relPos.z);
  if (distance < 1e-6) return;
  const relVel: Vec3 = { x: enemy.vel.x - ship.vel.x, y: enemy.vel.y - ship.vel.y, z: enemy.vel.z - ship.vel.z };
  // d(distance)/dt = dot(relPos, relVel) / distance — negative means the range is shrinking
  // (closing), positive means it's growing (opening).
  const rangeRate = (relPos.x * relVel.x + relPos.y * relVel.y + relPos.z * relVel.z) / distance;

  // offset a fixed world-space distance below the hull, converted to screen pixels via this
  // point's own scale, so the label sits just under the ship at any range instead of drifting
  // away from it as it gets closer/farther
  const offsetY = clamp(enemy.type.hullRadius * 1.8 * p.scale, 14, 60);

  ctx.textAlign = 'center';
  ctx.font = '10px Courier New';
  ctx.fillStyle = 'rgba(200, 225, 215, 0.85)';
  ctx.fillText(`${distance.toFixed(0)}m`, p.x, p.y + offsetY);
  ctx.fillStyle = rangeRate < 0 ? 'rgba(125, 255, 160, 0.85)' : 'rgba(255, 150, 110, 0.85)';
  ctx.fillText(`${rangeRate >= 0 ? '+' : ''}${rangeRate.toFixed(0)} m/s`, p.x, p.y + offsetY + 11);
}

// Recent-position history for drone-silhouette enemies (Aim Training orbiters/drifters, Merge
// Drill's cruiser), so a curved orbit or a straight flight path reads as a contrail rather than
// just an instantaneous heading — the silhouette alone is easy to lose track of the facing/heading
// of at a glance. Keyed by object identity — a respawned drone reuses the same EnemyShip object
// (see scenarios/runtime.ts), so death clears the trail instead of drawing a long streak back to
// the old death position.
const droneTrails = new WeakMap<EnemyShip, Vec3[]>();
const DRONE_TRAIL_LENGTH = 16;

function updateAndDrawDroneTrail(enemy: EnemyShip, cam: Camera): void {
  if (enemy.behavior !== 'orbiter' && enemy.behavior !== 'drifter' && enemy.behavior !== 'cruiser') return;
  if (enemy.health.points <= 0) {
    droneTrails.delete(enemy);
    return;
  }
  let trail = droneTrails.get(enemy);
  if (!trail) {
    trail = [];
    droneTrails.set(enemy, trail);
  }
  trail.push({ x: enemy.pos.x, y: enemy.pos.y, z: enemy.pos.z });
  if (trail.length > DRONE_TRAIL_LENGTH) trail.shift();

  ctx.lineWidth = 1.4;
  for (let i = 1; i < trail.length; i++) {
    const alpha = (i / trail.length) * 0.45;
    ctx.strokeStyle = `rgba(255, 170, 110, ${alpha.toFixed(3)})`;
    drawLine3D(trail[i - 1].x, trail[i - 1].y, trail[i - 1].z, trail[i].x, trail[i].y, trail[i].z, cam);
  }
}

function drawPip(ship: Ship, scenario: ScenarioRuntime, cam: Camera): void {
  const active = findActivePip(ship.pos, ship.vel, cam, scenario.enemies, canvas.width, canvas.height);
  if (!active) return;
  ctx.strokeStyle = active.wouldHit ? '#7dffa0' : '#ffe696';
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

// PIP Trainer's target marker — deliberately just the diamond (no hull silhouette, no ESP info
// readout), since the whole point of this mode is a bare ESP-style PIP rather than a physical
// ship — see combat/pipTrainer.ts. A progress ring fills in as the hold timer approaches
// holdDurationSec, and a brief expanding ring marks a scored rep.
function drawPipTrainerMarker(state: PipTrainerState, opts: PipTrainerOptions, cam: Camera): void {
  const p = project(state.pos.x, state.pos.y, state.pos.z, cam);
  if (!p) return;
  const holdFrac = opts.holdDurationSec > 0 ? clamp(state.holdTimer / opts.holdDurationSec, 0, 1) : 0;
  const r = 8;

  ctx.strokeStyle = holdFrac > 0 ? `rgba(125,255,160,${(0.6 + 0.4 * holdFrac).toFixed(3)})` : '#ffe696';
  ctx.lineWidth = 1.5 + holdFrac * 1.5;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - r);
  ctx.lineTo(p.x + r, p.y);
  ctx.lineTo(p.x, p.y + r);
  ctx.lineTo(p.x - r, p.y);
  ctx.closePath();
  ctx.stroke();

  if (holdFrac > 0) {
    ctx.strokeStyle = 'rgba(125,255,160,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 6, -Math.PI / 2, -Math.PI / 2 + holdFrac * Math.PI * 2);
    ctx.stroke();
  }

  if (state.scoreFlash > 0) {
    const progress = 1 - state.scoreFlash / SCORE_FLASH_DURATION;
    ctx.strokeStyle = `rgba(255,255,255,${(1 - progress).toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 8 + progress * 22, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function updatePipTrainerHUD(state: PipTrainerState, opts: PipTrainerOptions): void {
  document.getElementById('pip-trainer-reps')!.textContent = `${state.reps}`;
  document.getElementById('pip-trainer-hold')!.textContent =
    `${state.holdTimer.toFixed(2)}s / ${opts.holdDurationSec.toFixed(2)}s`;
  const holdPct = opts.holdDurationSec > 0 ? clamp((state.holdTimer / opts.holdDurationSec) * 100, 0, 100) : 0;
  (document.getElementById('pip-trainer-hold-bar') as HTMLElement).style.width = `${holdPct}%`;
  if (opts.durationSec !== null) {
    const remaining = Math.max(0, opts.durationSec - state.elapsedSec);
    document.getElementById('pip-trainer-timer-label')!.textContent = 'TIME LEFT';
    document.getElementById('pip-trainer-timer')!.textContent = `${remaining.toFixed(1)}s`;
  } else {
    document.getElementById('pip-trainer-timer-label')!.textContent = 'TIME';
    document.getElementById('pip-trainer-timer')!.textContent = `${state.elapsedSec.toFixed(1)}s`;
  }
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

// Off-screen edge indicator — an arrow at the viewport edge pointing toward any live enemy that
// isn't currently projected on screen (behind the camera, or in front but outside the canvas
// bounds), so the player can find/track enemies without a separate radar or map. General-purpose,
// not tied to any one scenario.
const EDGE_INDICATOR_MARGIN = 28;

// Draws a single edge-of-viewport arrow pointing toward `pos` if it's currently off screen (behind
// the camera, or in front but outside the canvas bounds) — no-op if it's already visible. Shared by
// drawOffscreenIndicators (scenario enemies) and the PIP Trainer's own single-marker equivalent, so
// e.g. the pip flying behind the player during a hard flick is just as findable as a scenario enemy.
function drawOffscreenArrow(pos: Vec3, cam: Camera, arrowColor: string, labelColor: string): void {
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2;
  const halfW = cx - EDGE_INDICATOR_MARGIN, halfH = cy - EDGE_INDICATOR_MARGIN;
  const { forward, right, up } = cam.axes;

  const p = project(pos.x, pos.y, pos.z, cam);
  const onScreen = p !== null && p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h;
  if (onScreen) return;

  const dx = pos.x - cam.pos.x, dy = pos.y - cam.pos.y, dz = pos.z - cam.pos.z;
  const camX = dx * right.x + dy * right.y + dz * right.z;
  const camY = dx * up.x + dy * up.y + dz * up.z;
  const camZ = dx * forward.x + dy * forward.y + dz * forward.z;

  // camX/camY line up with screen x/-y the same way project() does; behind the camera that
  // mapping flips sign, so mirror both components to keep the arrow pointing the way the
  // player would actually need to turn rather than the mirror-image direction.
  let dirX = camX, dirY = -camY;
  if (camZ < 0) { dirX = -dirX; dirY = -dirY; }
  if (Math.abs(dirX) < 1e-6 && Math.abs(dirY) < 1e-6) dirY = 1; // dead ahead-behind: pick a side

  const angle = Math.atan2(dirY, dirX);
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  const tx = Math.abs(cosA) > 1e-6 ? halfW / Math.abs(cosA) : Infinity;
  const ty = Math.abs(sinA) > 1e-6 ? halfH / Math.abs(sinA) : Infinity;
  const t = Math.min(tx, ty);
  const ex = cx + cosA * t, ey = cy + sinA * t;

  ctx.save();
  ctx.translate(ex, ey);
  ctx.rotate(angle);
  ctx.fillStyle = arrowColor;
  ctx.beginPath();
  ctx.moveTo(10, 0);
  ctx.lineTo(-7, 6);
  ctx.lineTo(-7, -6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const distance = Math.hypot(dx, dy, dz);
  ctx.textAlign = 'center';
  ctx.font = '10px Courier New';
  ctx.fillStyle = labelColor;
  ctx.fillText(`${distance.toFixed(0)}m`, ex, ey + (sinA >= 0 ? 18 : -14));
}

function drawOffscreenIndicators(scenario: ScenarioRuntime, cam: Camera): void {
  for (const enemy of scenario.enemies) {
    if (enemy.health.points <= 0) continue;
    drawOffscreenArrow(enemy.pos, cam, '#ff7a45', 'rgba(255, 170, 110, 0.85)');
  }
}

// Same idea as drawOffscreenIndicators, but for the PIP Trainer's single bare marker — it has no
// EnemyShip/health to loop over, and uses its own PIP-diamond color (#ffe696) rather than the
// scenario-enemy orange, so the arrow reads as "the same marker" rather than a different opponent.
function drawPipTrainerOffscreenIndicator(state: PipTrainerState, cam: Camera): void {
  drawOffscreenArrow(state.pos, cam, '#ffe696', 'rgba(255, 230, 150, 0.85)');
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

// Merge/closure drills' "hold station here" envelope — see ScenarioConfig.rangeBubbleRadius.
// Drawn as a single shaded, near-opaque disc at the sphere's projected center/radius rather than
// wireframe great-circles — since this projector has no real 3D surface shading, a filled circle
// with a subtle off-center highlight is what reads as a solid ball rather than flat rings at a
// glance. Kept to one hue family and uniformly high alpha throughout (not fading translucent at
// the edge) so it reads as a single opaque marker rather than a colorful gradient.
function drawRangeBubble(scenario: ScenarioRuntime, cam: Camera): void {
  const radius = scenario.config.rangeBubbleRadius;
  if (!radius) return;
  for (const enemy of scenario.enemies) {
    if (enemy.health.points <= 0) continue;
    const p = project(enemy.pos.x, enemy.pos.y, enemy.pos.z, cam);
    if (!p) continue;
    const r = radius * p.scale;
    if (r < 1) continue;

    const gradient = ctx.createRadialGradient(
      p.x - r * 0.35, p.y - r * 0.35, r * 0.1,
      p.x, p.y, r
    );
    gradient.addColorStop(0, 'rgba(120,215,175,0.97)');
    gradient.addColorStop(1, 'rgba(70,165,135,0.95)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(150,255,195,0.95)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
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

function updateHUD(
  ship: Ship,
  scenario: ScenarioRuntime | null,
  pipTrainer: { state: PipTrainerState; opts: PipTrainerOptions } | null
): void {
  const scenarioHud = document.getElementById('scenario-hud') as HTMLElement;
  const pipTrainerHud = document.getElementById('pip-trainer-hud') as HTMLElement;
  pipTrainerHud.style.display = pipTrainer ? 'block' : 'none';
  if (pipTrainer) updatePipTrainerHUD(pipTrainer.state, pipTrainer.opts);

  if (scenario) {
    scenarioHud.style.display = 'block';
    document.getElementById('scenario-hud-name')!.textContent = scenario.config.name;

    const isGates = scenario.config.winCondition === 'gates';
    const isSurvive = scenario.config.winCondition === 'survive';
    // 'survive' drills normally hide the player-hits row (their enemy never fires — Aim Training,
    // Merge Drill), but the Evasive Pilot drill's optional return fire needs it, sourced from the
    // hitsTaken counter (see below) rather than the health-delta the non-survive branch reads,
    // since a survive drill's hitsToKillPlayer is deliberately unreachable (999).
    const showPlayerHits = !isSurvive || scenario.config.evasiveReturnFire === true;
    (document.getElementById('scenario-hud-enemy-row') as HTMLElement).style.display = (isGates || isSurvive) ? 'none' : 'flex';
    (document.getElementById('scenario-hud-player-row') as HTMLElement).style.display = showPlayerHits ? 'flex' : 'none';
    (document.getElementById('scenario-hud-kills-row') as HTMLElement).style.display = isSurvive ? 'flex' : 'none';
    (document.getElementById('scenario-hud-accuracy-row') as HTMLElement).style.display = isSurvive ? 'flex' : 'none';
    (document.getElementById('scenario-hud-gate-row') as HTMLElement).style.display = isGates ? 'flex' : 'none';
    (document.getElementById('scenario-hud-timer-row') as HTMLElement).style.display = (isGates || isSurvive) ? 'flex' : 'none';
    const hasBubble = scenario.config.rangeBubbleRadius !== undefined;
    (document.getElementById('scenario-hud-bubble-row') as HTMLElement).style.display = hasBubble ? 'flex' : 'none';
    if (hasBubble) document.getElementById('scenario-hud-bubble')!.textContent = `${bubbleTicks(scenario)}`;

    if (isGates) {
      const gateTotal = scenario.config.gatePath?.length ?? 0;
      document.getElementById('scenario-hud-gate')!.textContent =
        `${Math.min(scenario.gateIndex + 1, gateTotal)}/${gateTotal}`;
      const remaining = Math.max(0, (scenario.config.surviveDurationSec ?? 0) - scenario.elapsedSec);
      document.getElementById('scenario-hud-timer-label')!.textContent = 'TIME LEFT';
      document.getElementById('scenario-hud-timer')!.textContent = `${remaining.toFixed(1)}s`;
    } else if (isSurvive) {
      const duration = scenario.config.surviveDurationSec;
      if (duration !== undefined) {
        const remaining = Math.max(0, duration - scenario.elapsedSec);
        document.getElementById('scenario-hud-timer-label')!.textContent = 'TIME LEFT';
        document.getElementById('scenario-hud-timer')!.textContent = `${remaining.toFixed(1)}s`;
      } else {
        document.getElementById('scenario-hud-timer-label')!.textContent = 'TIME';
        document.getElementById('scenario-hud-timer')!.textContent = `${scenario.elapsedSec.toFixed(1)}s`;
      }
      document.getElementById('scenario-hud-kills')!.textContent = `${scenario.stats.kills}`;
      const accuracy = scenario.stats.shotsFired > 0
        ? Math.round((scenario.stats.hitsLanded / scenario.stats.shotsFired) * 100) : 0;
      document.getElementById('scenario-hud-accuracy')!.textContent = `${accuracy}%`;
      if (showPlayerHits) document.getElementById('scenario-hud-player-hits')!.textContent = `${scenario.stats.hitsTaken}`;
    } else {
      const enemy = scenario.enemies[0];
      const enemyHits = enemy ? enemy.health.maxPoints - enemy.health.points : 0;
      const enemyMax = enemy ? enemy.health.maxPoints : 0;
      document.getElementById('scenario-hud-enemy-hits')!.textContent = `${enemyHits}/${enemyMax}`;

      const playerHits = ship.health ? ship.health.maxPoints - ship.health.points : 0;
      const playerMax = ship.health ? ship.health.maxPoints : 0;
      document.getElementById('scenario-hud-player-hits')!.textContent = `${playerHits}/${playerMax}`;
    }
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

export function render(
  ship: Ship,
  scenario: ScenarioRuntime | null = null,
  pipTrainer: { state: PipTrainerState; opts: PipTrainerOptions } | null = null
): void {
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
    drawRangeBubble(scenario, cam);
    for (const enemy of scenario.enemies) {
      updateAndDrawDroneTrail(enemy, cam);
      drawEnemyHull(enemy, cam);
      drawEnemyInfo(enemy, ship, cam);
    }
    drawEnemyExplosions(scenario, cam);
    drawOffscreenIndicators(scenario, cam);
  }

  // weapon tracers
  drawProjectiles(cam);

  // prograde velocity marker (still useful from the cockpit to read decoupled drift)
  drawProgradeMarker(ship, cam);

  // predicted-impact-point — only within PIP_RANGE of a live target
  if (scenario) drawPip(ship, scenario, cam);

  // PIP Trainer's bare marker — mutually exclusive with the scenario PIP above
  if (pipTrainer) {
    drawPipTrainerMarker(pipTrainer.state, pipTrainer.opts, cam);
    drawPipTrainerOffscreenIndicator(pipTrainer.state, cam);
  }

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

  updateHUD(ship, scenario, pipTrainer);
}
