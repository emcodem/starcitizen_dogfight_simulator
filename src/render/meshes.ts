import * as THREE from 'three';
import type { CelestialBody } from '../core/world';
import { loadBrightStars } from '../world/brightStars';
import { fbm } from './noise';

// ---------- Mesh factories ----------
// Procedural, asset-free surface detail: bodies get noise displacement + colour mottling so they
// read as real rocky/planetary surfaces rather than flat billiard balls, plus a Fresnel atmosphere
// rim. Real glTF models can replace these later without touching the renderer.

// Displace a sphere's vertices along their radius by fBm noise and tint per-vertex, giving craggy
// terrain + surface mottling. `amp` is metres of relief; kept small for walkable bodies so the
// visual surface stays close to the collision sphere (see characterController).
function texturizeSphere(
  geo: THREE.BufferGeometry,
  radius: number,
  opts: { amp: number; freq: number; base: THREE.Color; darken: number }
): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = x / radius, ny = y / radius, nz = z / radius;

    // relief displacement
    const h = fbm(nx * opts.freq + 11.3, ny * opts.freq + 4.7, nz * opts.freq + 19.1);
    const newLen = radius + (h - 0.5) * 2 * opts.amp;
    pos.setXYZ(i, nx * newLen, ny * newLen, nz * newLen);

    // colour mottling from a second, finer noise field
    const m = fbm(nx * opts.freq * 2.3 - 5.1, ny * opts.freq * 2.3 + 8.9, nz * opts.freq * 2.3 - 2.2);
    const shade = 1 - opts.darken * (0.5 - m); // brighten/darken around the base
    c.copy(opts.base).multiplyScalar(THREE.MathUtils.clamp(shade, 0.55, 1.25));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
}

// Fresnel rim glow shell (a slightly larger sphere, additive, brightest at the limb) — a cheap
// convincing atmosphere. Rendered camera-relative like everything else, so viewDir is toward the
// GL origin where the camera sits.
function atmosphereShell(radius: number, color: number, power: number, opacity: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uPower: { value: power },
      uOpacity: { value: opacity }
    },
    vertexShader: `
      varying vec3 vNormalW; varying vec3 vPosW;
      void main() {
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPosW = wp.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uPower; uniform float uOpacity;
      varying vec3 vNormalW; varying vec3 vPosW;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vPosW);
        float f = pow(1.0 - max(dot(normalize(vNormalW), viewDir), 0.0), uPower);
        gl_FragColor = vec4(uColor, f * uOpacity);
      }`
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 48), mat);
}

// Shared GLSL: hash-based 3D value noise + fBm + domain-warped turbulence, the GPU cousin of
// render/noise.ts. Used to boil the sun's photosphere and ripple its corona in real time. Sampled on
// the unit sphere (so it tiles seamlessly over the surface) and scrolled by a time uniform.
const SUN_NOISE_GLSL = `
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),
                   mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
                   mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.02; a *= 0.5; }
    return s;
  }
`;

// The sun. Best-practice recipe for a convincing star with no textures:
//   1. an animated photosphere — domain-warped fBm noise boils across the sphere, mapped through a
//      blackbody temperature ramp (dark convection lanes -> bright granule cells) so the surface
//      churns instead of sitting flat;
//   2. physical limb darkening (the disk dims and reddens toward its edge) plus a thin hot
//      chromosphere rim, which is what actually makes it read as a glowing sphere rather than a
//      flat disk;
//   3. HDR output (colours pushed >1) so the bloom pass blooms the bright granules into real glare;
//   4. a soft additive corona rendered as a camera-facing shader billboard — a smooth exponential
//      radial falloff (no hard sprite edge) with a slow low-frequency ripple, sized just over the
//      disk so it hugs the limb.
// Materials that animate expose their `uTime` uniform via group.userData.timeUniforms; the renderer
// advances them each frame.
function createSunMesh(body: CelestialBody): THREE.Object3D {
  const group = new THREE.Group();
  group.name = body.name;
  const timeUniforms: { value: number }[] = [];

  // --- photosphere ---
  const coreMat = new THREE.ShaderMaterial({
    toneMapped: true, // let ACES roll off the HDR core
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vViewDir; varying vec3 vObj;
      void main() {
        vObj = normalize(position);
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vViewDir = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vN; varying vec3 vViewDir; varying vec3 vObj;
      ${SUN_NOISE_GLSL}
      void main() {
        vec3 p = vObj * 3.5;
        float t = uTime * 0.06;
        // domain warp two slow flows into a third sample -> churning plasma, not a static crust
        float w1 = fbm(p * 1.3 + vec3(0.0, t, 0.0));
        float w2 = fbm(p * 2.7 - vec3(t * 1.3, 0.0, t));
        float n = fbm(p + vec3(w1, w2, w1 - w2) * 1.6 + vec3(0.0, 0.0, t * 0.5));
        n = clamp(n * 1.15, 0.0, 1.0);

        // blackbody-ish ramp: cool dark downflow lanes -> orange granules -> hot yellow-white cells
        vec3 cCool = vec3(0.70, 0.16, 0.02);
        vec3 cMid  = vec3(1.00, 0.48, 0.10);
        vec3 cHot  = vec3(1.00, 0.85, 0.52);
        vec3 col = mix(cCool, cMid, smoothstep(0.30, 0.58, n));
        col = mix(col, cHot, smoothstep(0.58, 0.92, n));

        float mu = max(dot(normalize(vN), normalize(vViewDir)), 0.0); // 1 centre -> 0 limb
        float limb = 0.40 + 0.60 * pow(mu, 0.55);                     // physical limb darkening
        // keep the base disk near ~1 so granule structure stays legible; only the hottest cells
        // push past the bloom threshold and glare, rather than the whole disk saturating to white
        float bright = (0.55 + n * 0.85) * limb;
        vec3 rim = vec3(1.0, 0.33, 0.10) * pow(1.0 - mu, 4.0) * 0.91;  // thin hot chromosphere rim
        gl_FragColor = vec4(col * bright * 1.76 + rim, 1.0);           // ~30% brighter -> more bloom
      }`
  });
  group.add(new THREE.Mesh(new THREE.SphereGeometry(body.radius, 96, 96), coreMat));
  timeUniforms.push(coreMat.uniforms.uTime);

  // No corona/haze billboard: a star has no atmosphere, so the extended glow it produced read as
  // one. The disk's own HDR output (hot granules + chromosphere rim, all >1) is left for the bloom
  // pass to bloom into a tight natural glare — that is the sun's only halo.
  group.userData.timeUniforms = timeUniforms;
  return group;
}

// Placeholder for the meteorite body (see world/celestial.ts's METEORITE) shown until the real
// glTF scan (render/celestialModels.ts) finishes loading and swaps in — same
// placeholder-then-swap split as createShipMesh's role for AI drones before the "Arrow" model
// resolves. A lumpy, noise-displaced icosahedron reads as an irregular rock at a glance rather
// than the smooth sphere a plain SphereGeometry would.
function createMeteoritePlaceholderMesh(body: CelestialBody): THREE.Object3D {
  const geo = new THREE.IcosahedronGeometry(body.radius, 2);
  texturizeSphere(geo, body.radius, { amp: body.radius * 0.25, freq: 2.5, base: new THREE.Color(body.color), darken: 0.5 });
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = body.name;
  return mesh;
}

// Placeholder for the Europa body (see world/celestial.ts's EUROPA) shown until the real glTF model
// (render/celestialModels.ts) finishes loading and swaps in — same split as the meteorite above.
function createEuropaPlaceholderMesh(body: CelestialBody): THREE.Object3D {
  const geo = new THREE.SphereGeometry(body.radius, 64, 64);
  texturizeSphere(geo, body.radius, { amp: body.radius * 0.02, freq: 6, base: new THREE.Color(body.color), darken: 0.7 });
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = body.name;
  return mesh;
}

export function createBodyMesh(body: CelestialBody): THREE.Object3D {
  // these branches build their own mesh — return before allocating the sphere geometry + group
  // below (the sun's is a 128^2 sphere), which they'd otherwise discard unused
  if (body.emissive) return createSunMesh(body);
  if (body.meteorite) return createMeteoritePlaceholderMesh(body);
  if (body.europa) return createEuropaPlaceholderMesh(body);

  const group = new THREE.Group();
  group.name = body.name;

  const segments = body.radius > 100_000 ? 128 : 96;
  const geo = new THREE.SphereGeometry(body.radius, segments, segments);

  // rocky/planetary body: displaced + mottled, lit standard material
  const walkable = body.walkable;
  texturizeSphere(geo, body.radius, {
    amp: walkable ? body.radius * 0.008 : body.radius * 0.02, // small for walkables (keeps collision honest)
    freq: walkable ? 3.5 : 6,
    base: new THREE.Color(body.color),
    darken: 0.7
  });
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0.0
  });
  group.add(new THREE.Mesh(geo, mat));

  if (body.atmosphere !== undefined) {
    group.add(atmosphereShell(body.radius * 1.025, body.atmosphere, 3.0, walkable ? 0.5 : 0.9));
  }
  return group;
}

// (The old procedural placeholder fighter that used to live here — createShipMesh — is gone: every
// ship now wears a real glTF hull loaded via render/shipModels.ts, both the player's own ship and
// the AI/fleet opponents. Ships render nothing until their model resolves rather than falling back
// to a primitive.)

// A weapon-round tracer styled like a distant meteorite burning up in atmosphere: a rounded orange
// nose (the "burning" leading surface, facing the direction of travel/the target) that melts
// continuously into a long red tail trailing behind it, thinning and fading out — not a beam or a
// blade, and not a flat-coloured ball sitting on top of the tail. Built as a THREE.Group (see
// render/renderer.ts's per-projectile loop, which points its local +Z down the round's velocity
// vector each frame — no billboarding, no shader) of two pieces sharing one origin at local (0,0,0):
//   - the head, a small sphere, and
//   - the tail, a cone lying along local +Z, wide (PROJECTILE_RADIUS, matching/overlapping the head)
//     at the local origin and tapering to a near-zero point PROJECTILE_LENGTH behind it at local -Z,
//     so the tail visually thins out with distance from the head the way a real meteor trail does.
//     A cone rather than a THREE.Line so it has real world-space thickness and stays visible at any
//     distance (WebGL ignores LineBasicMaterial.linewidth > 1 on most platforms).
// Both pieces are coloured by the SAME sampleFlameColor() below, keyed on distance-from-the-nose-tip
// rather than each piece having its own independent gradient — this is what makes the orange nose
// read as continuously melting into the red tail (a real flame gradient) instead of a solid ball
// dropped in front of a separately-coloured cone: colour and alpha are already identical for head
// and tail vertices that land at the same distance from the tip, so there is no seam to blend across.
export const PROJECTILE_LENGTH = 26;
export const PROJECTILE_RADIUS = 0.16; // tail's width where it meets the head (widened per-distance)
const HEAD_RADIUS = PROJECTILE_RADIUS * 0.85; // the rounded meteorite nose — kept slightly narrower
                                               // than the tail's own width so it reads as a rounded
                                               // cap on the tail, not a wider ball bulging out of it
const NOSE_TO_HOT_LEN = 0.8; // metres from the nose tip spent transitioning nose colour -> hot colour
const HOT_TO_CORE_LEN = 2.6; // metres from the nose tip until the colour settles into pure `color`
const TOTAL_SPAN = HEAD_RADIUS + PROJECTILE_LENGTH; // nose tip to tail tip, for the brightness/alpha falloff

const NOSE_COLOR = new THREE.Color(0xffa060); // brightest point, at the very tip — warm orange, not pale yellow
const HOT_COLOR = new THREE.Color(0xff7038); // mid transition, shared hand-off between head and tail
const _flameTmp = new THREE.Color();

// dist: metres from the nose tip (0 at the tip, TOTAL_SPAN at the tail's tapered point). Returns
// alpha; the RGB (already intensity-scaled) is left in `out`.
function sampleFlameColor(dist: number, coreColor: THREE.Color, out: THREE.Color): number {
  if (dist <= NOSE_TO_HOT_LEN) {
    out.copy(NOSE_COLOR).lerp(HOT_COLOR, dist / NOSE_TO_HOT_LEN);
  } else {
    const t2 = Math.min((dist - NOSE_TO_HOT_LEN) / (HOT_TO_CORE_LEN - NOSE_TO_HOT_LEN), 1);
    out.copy(HOT_COLOR).lerp(coreColor, t2);
  }
  // max(0, dist) is LOAD-BEARING, not defensive tidiness: Math.pow(negative, 1.3) is NaN, and the
  // nose-tip vertex reaches this with dist very slightly BELOW zero. Callers pass
  // `HEAD_RADIUS - position.getZ(i)`, where HEAD_RADIUS is a JS double (0.136) but the geometry's
  // Z came back out of a Float32Array, which rounds that same value UP to 0.13600000739097595 — so
  // the front pole yields dist = -7.4e-9. The resulting alpha = NaN is baked into the bolt's vertex
  // colour attribute, and one NaN texel in the scene target is enough for SmoothBloomPass's blur (a
  // weighted sum — NaN * 0 is still NaN) to smear NaN across every texel of the mip chain, turning
  // the ENTIRE frame black. That is the 2026-08-16 turret-fire blackout report; see
  // BLOOM_BLACKOUT_FINDINGS.md for the full measurement trail. Clamping gives the tip alpha = 1,
  // which is the intended value anyway — the taper is meant to run 1 at the tip down to 0 at the
  // tail. (smoothBloomPass.ts also sanitises non-finite texels now, so a future stray NaN anywhere
  // in the scene can't do this again; this clamp is the actual cause, that is the blast wall.)
  const t = Math.max(0, dist) / TOTAL_SPAN;
  out.multiplyScalar(1.1 * (1 - 0.5 * t)); // gentle brightness taper; kept modest so it stays under
                                            // SmoothBloomPass's threshold rather than blooming into a blob
  return 1 - Math.pow(t, 1.3); // long taper, like a meteor trail thinning into nothing
}

export function createProjectileMesh(color: number): THREE.Group {
  const group = new THREE.Group();
  const core = new THREE.Color(color);

  const headGeo = new THREE.SphereGeometry(HEAD_RADIUS, 12, 10);
  const headPos = headGeo.getAttribute('position');
  const headRgba = new Float32Array(headPos.count * 4);
  for (let i = 0; i < headPos.count; i++) {
    const dist = HEAD_RADIUS - headPos.getZ(i); // 0 at the front pole (the nose tip), grows toward the back
    const alpha = sampleFlameColor(dist, core, _flameTmp);
    headRgba[i * 4] = _flameTmp.r;
    headRgba[i * 4 + 1] = _flameTmp.g;
    headRgba[i * 4 + 2] = _flameTmp.b;
    headRgba[i * 4 + 3] = alpha;
  }
  headGeo.setAttribute('color', new THREE.BufferAttribute(headRgba, 4));
  const headMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
  group.add(new THREE.Mesh(headGeo, headMat));

  const heightSegments = 16; // enough rings along the length for a smooth head-to-tail gradient
  const tailGeo = new THREE.CylinderGeometry(PROJECTILE_RADIUS, 0.01, PROJECTILE_LENGTH, 8, heightSegments);
  tailGeo.rotateX(Math.PI / 2);              // reorient the cone's long axis from +Y to +Z
  tailGeo.translate(0, 0, -PROJECTILE_LENGTH / 2); // wide end at the head, tapered point at local -Z

  const tailPos = tailGeo.getAttribute('position');
  const tailRgba = new Float32Array(tailPos.count * 4); // itemSize 4 so vertex alpha carries the tail fade
  for (let i = 0; i < tailPos.count; i++) {
    const dist = HEAD_RADIUS - tailPos.getZ(i); // same distance-from-nose-tip scale as the head, above
    const alpha = sampleFlameColor(dist, core, _flameTmp);
    tailRgba[i * 4] = _flameTmp.r;
    tailRgba[i * 4 + 1] = _flameTmp.g;
    tailRgba[i * 4 + 2] = _flameTmp.b;
    tailRgba[i * 4 + 3] = alpha;
  }
  tailGeo.setAttribute('color', new THREE.BufferAttribute(tailRgba, 4));

  const tailMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
  group.add(new THREE.Mesh(tailGeo, tailMat));

  return group;
}

// A flat "roll band" trailing a ship during flight-replay review (see replay/player.ts's
// getPlayerTrail/getEnemyTrail, render/renderer.ts's updateTrails) — a quad strip running through
// each recorded (position, right-axis) sample, offset +/- halfWidth along that sample's own right
// vector. Since a ship rolling rotates its right axis about the direction of travel, a roll during
// the recorded window visibly twists the band along its length rather than just tracing a bare
// line — the whole point of drawing a band instead of a THREE.Line.
//
// Preallocated for TRAIL_MAX_POINTS samples and rewritten every frame (same DynamicDrawUsage
// buffer + frustumCulled:false convention as the space-dust field below, since positions are
// camera-relative and rewritten every frame — a static bounding sphere would risk wrong culling);
// geo.setDrawRange trims it down to however many samples are actually live this frame without
// ever reallocating the buffers.
export const TRAIL_MAX_POINTS = 80; // >= 3s window at the recorder's 20Hz sample rate, plus headroom

export function createTrailRibbon(color: number): THREE.Mesh {
  const geo = new THREE.BufferGeometry();

  const positions = new THREE.BufferAttribute(new Float32Array(TRAIL_MAX_POINTS * 2 * 3), 3);
  positions.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', positions);

  const triCount = (TRAIL_MAX_POINTS - 1) * 2;
  const indices = new Uint16Array(triCount * 3);
  for (let i = 0; i < TRAIL_MAX_POINTS - 1; i++) {
    const l0 = i * 2, r0 = i * 2 + 1, l1 = (i + 1) * 2, r1 = (i + 1) * 2 + 1;
    const base = i * 6;
    indices[base] = l0; indices[base + 1] = r0; indices[base + 2] = l1;
    indices[base + 3] = r0; indices[base + 4] = r1; indices[base + 5] = l1;
  }
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.setDrawRange(0, 0); // nothing to show until updateTrailRibbon populates a real sample count

  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; // positions are camera-relative and rewritten every frame (see space
                              // dust's identical convention) — a static bounding sphere would risk
                              // wrong culling
  return mesh;
}

// `points` must already be camera-relative (floating-origin subtracted) and oldest-first; only the
// most recent TRAIL_MAX_POINTS are drawn if more are passed. Fewer than 2 points draws nothing (a
// single point has no direction to form a band along).
export function updateTrailRibbon(
  mesh: THREE.Mesh,
  points: { pos: { x: number; y: number; z: number }; right: { x: number; y: number; z: number } }[],
  halfWidth: number
): void {
  const geo = mesh.geometry;
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const start = Math.max(0, points.length - TRAIL_MAX_POINTS);
  const n = points.length - start;
  for (let i = 0; i < n; i++) {
    const p = points[start + i];
    posAttr.setXYZ(i * 2,
      p.pos.x + p.right.x * halfWidth, p.pos.y + p.right.y * halfWidth, p.pos.z + p.right.z * halfWidth);
    posAttr.setXYZ(i * 2 + 1,
      p.pos.x - p.right.x * halfWidth, p.pos.y - p.right.y * halfWidth, p.pos.z - p.right.z * halfWidth);
  }
  posAttr.needsUpdate = true;
  geo.setDrawRange(0, n < 2 ? 0 : (n - 1) * 6);
}

// (Both enemy-death explosions and laser-hit sparks are now the GPU "hot metal" system in
// render/impactEffects.ts — ImpactEffects.explode / .trigger — not meshes built here.)

// (The PIP Trainer's target marker is drawn as a DOM overlay — hud.ts's updatePipTrainerMarker —
// not a mesh here; see that file's doc comment for why.)

// Starfield: a fixed, camera-anchored celestial sphere built from the real Yale Bright Star
// Catalog (see world/brightStars.ts) — true positions, per-star brightness from visual magnitude,
// and per-star colour from the catalogue's blackbody temperature. Rendered as soft round glowing
// points via a custom shader (PointsMaterial can't vary size/colour per point). Additive so they
// glow on black and feed the bloom pass.
export function createStarfield(radius = 1e7): THREE.Points {
  const stars = loadBrightStars(radius);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(stars.positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(stars.sizes, 1));
  geo.setAttribute('aBright', new THREE.BufferAttribute(stars.bright, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(stars.colors, 3));

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
    vertexShader: `
      attribute float aSize; attribute float aBright; attribute vec3 aColor;
      uniform float uPixelRatio; varying float vBright; varying vec3 vColor;
      void main() {
        vBright = aBright;
        vColor = aColor;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPixelRatio;
      }`,
    fragmentShader: `
      varying float vBright; varying vec3 vColor;
      void main() {
        float d = distance(gl_PointCoord, vec2(0.5));
        if (d > 0.5) discard;
        // no whitening toward the centre — keep the true hue across the whole disc (this is what
        // NASA's Eyes on the Solar System star shader does: only alpha falls off toward the edge,
        // colour never desaturates toward white; a punchy core comes from brightness/bloom, not tint)
        float a = pow(clamp(1.0 - 2.0 * d, 0.0, 1.0), 2.2);
        gl_FragColor = vec4(vColor * vBright, a);
      }`
  });
  return new THREE.Points(geo, mat);
}

// SC-style ambient dust — ported from the original project's render/render.ts::drawSpaceDust: a
// small field of world-fixed motes wrapped tightly around the ship, invisible at a standstill and
// stretching into snow-like streaks as speed rises. This is the primary moment-to-moment visual
// cue for how hard the ship is accelerating/braking — with celestial bodies millions of metres away
// (see world/celestial.ts) there's essentially no other parallax reference at flight speeds, so
// without this the ship's actual (unchanged) acceleration/deceleration reads as sluggish or absent.
//
// `bases` are arbitrary random seeds, not real world coordinates — render/renderer.ts's per-frame
// update wraps each one against the ship's current absolute position into a bounded offset and
// renders that directly as the camera-relative position (this scene is always rendered camera-
// relative — see the floating-origin note in renderer.ts — and while piloting the camera sits
// exactly at the ship's position, so the wrapped offset from the ship IS the render position,
// with no separate eye-subtraction step needed).
export interface SpaceDust {
  mesh: THREE.LineSegments;
  bases: { x: number; y: number; z: number }[];
  field: number;
}

export function createSpaceDust(count = 70, field = 130): SpaceDust {
  const bases: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < count; i++) {
    bases.push({
      x: (Math.random() - 0.5) * field * 2,
      y: (Math.random() - 0.5) * field * 2,
      z: (Math.random() - 0.5) * field * 2
    });
  }

  const geo = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(new Float32Array(count * 2 * 3), 3);
  const alphas = new THREE.BufferAttribute(new Float32Array(count * 2), 1);
  positions.setUsage(THREE.DynamicDrawUsage);
  alphas.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', positions);
  geo.setAttribute('aAlpha', alphas);

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aAlpha; varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying float vAlpha;
      void main() { gl_FragColor = vec4(0.78, 0.88, 1.0, vAlpha); }`
  });

  const mesh = new THREE.LineSegments(geo, mat);
  mesh.frustumCulled = false; // positions are rewritten every frame around the camera; a static
                               // bounding sphere would risk incorrect culling
  return { mesh, bases, field };
}

// "Stay inside" capture bubble (Merge Drill's rangeBubbleRadius): a soft Fresnel-rimmed shell
// (bright at the grazing limb, nearly invisible dead-on, like the atmosphereShell above — but
// double-sided with a per-fragment normal flip, since unlike a planet's atmosphere the player is
// expected to end up INSIDE this one) for a volumetric "this is a bubble" read at any range, plus a
// camera-facing ring (a flat annulus re-oriented every frame to face the GL origin, where the
// camera is always pinned — see the floating-origin note atop renderer.ts) for a crisp boundary
// outline that never degenerates. A true 3D wireframe/ring-rig was tried first and rejected: at the
// close, shallow viewing angles typical of this drill's head-on merge, a torus tube seen edge-on
// forshort into a screen-filling bar instead of a thin ring — a billboarded ring can't do that.
// Color and a slow idle pulse are driven per-frame by the renderer via updateCaptureBubble — green
// while the player is inside, amber while they're still closing in.
export interface CaptureBubble {
  shellMesh: THREE.Mesh;
  ringMesh: THREE.Mesh;
  shellMat: THREE.ShaderMaterial;
  ringMat: THREE.MeshBasicMaterial;
  radius: number;
}

export function createCaptureBubble(radius: number): CaptureBubble {
  const shellMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(0x7dffa0) },
      uOpacity: { value: 1 }
    },
    vertexShader: `
      varying vec3 vNormalW; varying vec3 vPosW;
      void main() {
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPosW = wp.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity;
      varying vec3 vNormalW; varying vec3 vPosW;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vPosW);
        vec3 n = normalize(vNormalW);
        if (!gl_FrontFacing) n = -n; // seen from inside the shell (the win state) as well as outside
        float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 6.0);
        gl_FragColor = vec4(uColor, rim * 0.85 * uOpacity);
      }`
  });
  const shellMesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 28), shellMat);

  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x7dffa0, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false
  });
  const ringMesh = new THREE.Mesh(new THREE.RingGeometry(radius * 0.965, radius, 96), ringMat);

  return { shellMesh, ringMesh, shellMat, ringMat, radius };
}

// `pulse` is an idle 0..1 breathing multiplier (independent of `color`) so the bubble stays visibly
// alive even when the player holds a steady range, rather than reading as a static painted-on shell.
export function updateCaptureBubble(bubble: CaptureBubble, color: THREE.Color, pulse: number): void {
  bubble.shellMat.uniforms.uColor.value.copy(color);
  bubble.shellMat.uniforms.uOpacity.value = pulse;
  bubble.ringMat.color.copy(color);
  bubble.ringMat.opacity = 0.65 + 0.3 * pulse;
}
