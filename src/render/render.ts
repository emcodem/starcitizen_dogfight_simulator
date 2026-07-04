import type { Ship, Vec3 } from '../types';
import { clamp } from '../math/vec';
import { computeAxes, type ShipAxes } from '../math/quaternion';
import { STATION } from '../world/station';
import { WEAPON, projectiles } from '../world/weapons';
import * as MouseLook from '../input/mouseLook';

interface Camera {
  pos: Vec3;
  axes: ShipAxes;
}

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

interface ProjectedPoint {
  x: number;
  y: number;
  scale: number;
  depth: number;
}

function project(px: number, py: number, pz: number, cam: Camera): ProjectedPoint | null {
  // transform world point into camera space using camera axes
  const dx = px - cam.pos.x, dy = py - cam.pos.y, dz = pz - cam.pos.z;
  const { forward, right, up } = cam.axes;
  const cx = dx * right.x + dy * right.y + dz * right.z;
  const cy = dx * up.x + dy * up.y + dz * up.z;
  const cz = dx * forward.x + dy * forward.y + dz * forward.z;
  if (cz <= 1) return null; // behind camera
  const f = 500 / cz;
  return { x: canvas.width / 2 + cx * f, y: canvas.height / 2 - cy * f, scale: f, depth: cz };
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
    if (tailP) {
      ctx.strokeStyle = `rgba(255, 230, 150, ${fade.toFixed(3)})`;
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

function drawStation(cam: Camera): void {
  const p = STATION.pos, h = STATION.halfSize;
  const corners: Vec3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    corners.push({ x: p.x + sx * h, y: p.y + sy * h, z: p.z + sz * h });
  }
  // 12 edges of a cube, indices into the 8 corners generated above (order: x,y,z each -1/1)
  const edges = [
    [0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3],
    [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]
  ];
  ctx.strokeStyle = '#ff4d4d';
  ctx.lineWidth = 1.6;
  for (const [a, b] of edges) {
    drawLine3D(corners[a].x, corners[a].y, corners[a].z, corners[b].x, corners[b].y, corners[b].z, cam);
  }
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

function updateHUD(ship: Ship): void {
  const speed = Math.hypot(ship.vel.x, ship.vel.y, ship.vel.z);
  document.getElementById('s-throttle')!.textContent = Math.round(ship.throttle * 100) + '%';
  (document.getElementById('bar-throttle') as HTMLElement).style.width = Math.round(Math.abs(ship.throttle) * 100) + '%';
  const boostPct = Math.round((ship.boostMeter / ship.type.boostCapacity) * 100);
  const boostEl = document.getElementById('s-boost')!;
  boostEl.textContent = boostPct + '%';
  boostEl.className = ship.boosting ? 'value on' : 'value';
  (document.getElementById('bar-boost') as HTMLElement).style.width = boostPct + '%';
  document.getElementById('s-speed')!.textContent = speed.toFixed(1) + ' m/s';
  document.getElementById('s-decoupled')!.textContent = ship.decoupled ? 'ON' : 'OFF';
  const brakeEl = document.getElementById('s-brake')!;
  brakeEl.textContent = ship.spaceBrakeOn ? 'ON' : 'OFF';
  brakeEl.className = ship.spaceBrakeOn ? 'value on' : 'value';
  document.getElementById('s-mass')!.textContent = ship.type.mass.toFixed(2);
  document.getElementById('s-ship')!.textContent = ship.type.name;
  const flag = document.getElementById('s-mode-flag')!;
  flag.textContent = ship.decoupled ? 'DECOUPLED' : 'COUPLED';
  flag.className = ship.decoupled ? 'on' : '';
}

export function render(ship: Ship): void {
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

  // static station — a fixed hazard to practice flying around and avoiding
  drawStation(cam);

  // weapon tracers
  drawProjectiles(cam);

  // prograde velocity marker (still useful from the cockpit to read decoupled drift)
  drawProgradeMarker(ship, cam);

  // explosion flash overlay on collision
  if (ship.exploding) {
    drawExplosion(1 - ship.explosionTimer / 1.0);
  }

  // mouse-look virtual stick reticle — shows current deflection from center
  if (MouseLook.isCaptured()) {
    drawMouseReticle();
  }

  updateHUD(ship);
}
