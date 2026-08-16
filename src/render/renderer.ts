import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SmoothBloomPass } from './smoothBloomPass';
import { DitheredOutputPass } from './ditheredOutputPass';
import type { World, CelestialBody, EnemyShip, ShipBody, VisualEffect } from '../core/world';
import { ROLL_TRAINER_STANDOFF_M, getRollTrainerGhostUp } from '../combat/rollTrainer';
import type { Quat, Vec3 } from '../core/types';
import type { FlightGate } from '../scenarios/types';
import { computeAxes } from '../math/quaternion';
import { normalize, sub } from '../math/vec';
import { footEye } from '../physics/characterController';
import { SUN } from '../world/celestial';
import {
  createBodyMesh, createProjectileMesh, createTrailRibbon, updateTrailRibbon,
  createSpaceDust, createStarfield, PROJECTILE_RADIUS, type SpaceDust,
  createCaptureBubble, updateCaptureBubble, type CaptureBubble
} from './meshes';
import { ImpactEffects } from './impactEffects';
import { setCameraBasis, setObjectBasis } from './camera';
import { cloneShip, loadShipTemplate, SHIP_MODEL_NAMES, type ShipModelName } from './shipModels';
import { loadEuropaTemplate, loadMeteoriteField, loadMeteoriteTemplate } from './celestialModels';
import type { InstancedField } from './instancedField';
import * as FreeCamera from '../control/freeCamera';
import * as ReplayPlayer from '../replay/player';

// Movement-history "roll band" shown while reviewing a flight replay (see updateTrails below) —
// player teal / enemy orange, matching the HUD's own --hud-fg / --hud-accent palette so the trail
// colors read consistently with the rest of the UI rather than introducing a third color scheme.
const TRAIL_COLOR_PLAYER = 0x8fd3c7;
const TRAIL_COLOR_ENEMY = 0xff7a45;
const TRAIL_WINDOW_SEC = 3;

// Player and enemy tracers share one look — a saturated laser red — so a dogfight's incoming vs.
// outgoing fire reads as the same weapon type; only owner-based hit detection tells them apart.
const LASER_COLOR = 0xff2a2a;

// Merge Drill's capture-bubble marker: green (--hud-on, this codebase's "good/on-target" colour
// everywhere else — crosshair hits, roll-trainer perfects) while the player is inside the bubble,
// amber (--hud-accent) while they still need to close the distance.
const BUBBLE_COLOR_INSIDE = new THREE.Color(0x7dffa0);
const BUBBLE_COLOR_OUTSIDE = new THREE.Color(0xff7a45);

// Resolution of the bloom blur chain's largest mip, as a fraction of the drawing buffer — see the
// explicit re-size in resize(). 1/3 matches what the pass was already effectively running at on a
// dpr-1.5 display, so this is a clarification of existing behaviour rather than a quality change;
// raise it toward 1/2 (three.js's own default) for a tighter glow at proportionally more GPU cost.
const BLOOM_MIP0_FRACTION = 1 / 3;

// (The PIP Trainer's target marker is a DOM overlay — hud.ts's updatePipTrainerMarker, sharing
// #pip-marker's fixed-pixel diamond style with the real combat PIP — not a 3D mesh here, so its
// on-screen size is genuinely constant regardless of the target's world-space distance.)

// Release the GPU-side geometry + material(s) of an object and its whole subtree. three.js does
// NOT free these on scene.remove(), so any mesh torn down at runtime (enemy/gate rebuilds on every
// scenario switch, async model swaps) must be routed through here or its buffers leak unbounded.
//
// Meshes tagged `userData.sharedAssets` (cloneShip instances) share BOTH their geometry and their
// materials with a module-level cached template that every other clone also references — see
// render/shipModels.ts::cloneShip. Disposing either would pull the textures and buffers out from
// under every remaining ship (and the template itself, which is never rebuilt), so such a subtree is
// removed from the scene without freeing anything. The template's own GPU resources intentionally
// live for the page's lifetime.
function disposeObject3D(obj: THREE.Object3D): void {
  if (obj.userData.sharedAssets === true) return;
  obj.traverse((node) => {
    const mesh = node as Partial<THREE.Mesh>;
    mesh.geometry?.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}

// ============================================================================================
// three.js render layer. This is the ONLY module that knows about the GPU, and the only place the
// floating origin is applied: every frame we compute the camera's absolute world position (the
// pilot's cockpit seat, or the walking character's eye), then render everything camera-relative by
// subtracting that position. The camera itself stays pinned at the GL origin and only rotates.
//
// A logarithmic depth buffer lets a single camera show both a 20 m ship in the foreground and a
// sun 8 million metres away without z-fighting.
// ============================================================================================

export class Renderer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private bodyMeshes = new Map<string, THREE.Object3D>();
  private shipMesh: THREE.Object3D;
  private enemyMeshes = new Map<EnemyShip, THREE.Object3D>();
  private currentEnemyList: EnemyShip[] | null = null;
  // Roll Trainer's translucent ghost target hull — see combat/rollTrainer.ts. Built/torn down
  // whenever world.rollTrainer flips between null/non-null (there's only ever at most one).
  private rollTrainerMesh: THREE.Object3D | null = null;
  // Replay-review movement trails — see updateTrails(). One ribbon per enemy, torn down/rebuilt
  // alongside the ship meshes above (same world.enemies-array-swap trigger); the player's is a
  // single mesh created once, since there's always exactly one player ship regardless of clip.
  private playerTrailMesh!: THREE.Mesh;
  private enemyTrailMeshes = new Map<EnemyShip, THREE.Mesh>();
  // Loaded glTF ship templates, keyed by model id (see render/shipModels.ts). Each ship (player or
  // enemy) clones the template matching its ShipType.model; a ship whose template hasn't resolved
  // yet renders as an empty placeholder group until it does.
  private shipTemplates = new Map<ShipModelName, THREE.Object3D>();
  private projectilePool: THREE.Object3D[] = [];
  private gateMeshes: THREE.Mesh[] = [];
  private currentGatePath: FlightGate[] | null = null;
  private rangeBubble: CaptureBubble | null = null;
  // (both explosions and laser impacts are handled by the GPU hot-metal system below, not a mesh)
  // Hot-metal laser-hit sparks/flash/glow (see render/impactEffects.ts). Render-only: driven from
  // world.effects 'impact' triggers, each consumed exactly once via emittedImpacts. clock feeds the
  // GPU spark shader's monotonic time (render() gets no dt).
  private impacts!: ImpactEffects;
  private clock = new THREE.Clock();
  private emittedImpacts = new WeakSet<VisualEffect>();
  private starfield: THREE.Points;
  private spaceDust: SpaceDust;
  private meteoriteField: InstancedField | null = null;
  private meteoriteFieldCenter: Vec3 | null = null;
  private sunLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private composer: EffectComposer;
  private bloom: SmoothBloomPass;
  // `uTime` uniforms of any animated body material (the sun's photosphere + corona) — advanced from
  // the shared clock each frame in render() so their shaders churn in real time.
  private timeUniforms: { value: number }[] = [];

  constructor(canvas: HTMLCanvasElement, world: World) {
    // antialias is deliberately OFF, and turning it on would not antialias anything: the scene is
    // drawn into the EffectComposer's own render target (see the composer below), whose `samples` is
    // 0, and the ONLY thing that ever touches the canvas's default framebuffer is OutputPass's final
    // full-screen quad — which has no interior edges to multisample. Requesting antialias here
    // therefore allocated a 4x-MSAA default framebuffer (measured: SAMPLES=4 at 3795x1929, ~117 MB
    // of colour plus as much depth) that only a single flat quad was ever resolved through: pure
    // cost, zero effect. To actually get MSAA, set `this.composer.renderTarget1.samples = 4` (and
    // renderTarget2's) so the SCENE is multisampled, or add an SMAAPass to the chain.
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, logarithmicDepthBuffer: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // filmic tone mapping + sRGB output (via OutputPass at the end of the composer) turns the flat
    // clamped look into something with real highlight rolloff.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070a);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1e9);
    this.camera.position.set(0, 0, 0);

    // starfield — camera-anchored celestial sphere (never translates). Its world position is
    // therefore always (0,0,0), same as the camera itself (see above) -- three.js's transparent-
    // object painter's sort uses each object's world position to compute a depth key, so without
    // this the starfield registers as being AT the camera (the nearest possible depth) rather than
    // the background it actually represents, and can sort to render AFTER (on top of) closer
    // transparent geometry like laser bolts. Since it's additively blended, a bright star then
    // shows straight through regardless of what's "in front" of it, colour-independent -- and
    // because a fast-moving bolt's screen footprint changes every frame, which stars leak through
    // changes too, reading as a flicker (2026-08-16 turret-fire report). A very low renderOrder
    // forces the starfield to sort first regardless of its degenerate position-based depth key.
    this.starfield = createStarfield();
    this.starfield.renderOrder = -1000;
    this.scene.add(this.starfield);

    // speed-reactive ambient dust (see createSpaceDust's doc comment) — piloting-only, updated
    // per frame in render() below. Same camera-anchored-transform pattern as the starfield above
    // (individual motes are camera-relative positions baked into the vertex buffer each frame in
    // updateSpaceDust; the mesh's own .position is never set, staying at the default (0,0,0)) —
    // same fix needed, or dust motes can sort-order-bleed through nearby transparent objects
    // (e.g. laser bolts passing through the ~130m dust field) exactly like the starfield did.
    this.spaceDust = createSpaceDust(200, 130);
    this.spaceDust.mesh.renderOrder = -999;
    this.scene.add(this.spaceDust.mesh);

    // celestial bodies
    for (const body of world.bodies) {
      const mesh = createBodyMesh(body);
      this.bodyMeshes.set(body.name, mesh);
      this.collectTimeUniforms(mesh);
      this.scene.add(mesh);
    }

    // real meteorite scan (see render/celestialModels.ts) loads in async — the meteorite body
    // renders as the procedural placeholder rock (createBodyMesh's meteorite branch) until it
    // resolves, then swaps onto the real model, same split as the Arrow enemy model below.
    const meteoriteBody = world.bodies.find((b) => b.meteorite);
    if (meteoriteBody) {
      loadMeteoriteTemplate().then((model) => {
        const old = this.bodyMeshes.get(meteoriteBody.name);
        if (old) { this.scene.remove(old); disposeObject3D(old); }
        this.bodyMeshes.set(meteoriteBody.name, model);
        this.scene.add(model);
      });

      // a scattered field of smaller copies of the same rock around it (see
      // celestialModels.ts::loadMeteoriteField — one draw call, decimated per-instance geometry, and
      // real frustum culling) — positioned every frame in render() below, same floating-origin
      // convention as every other object in the scene.
      this.meteoriteFieldCenter = meteoriteBody.pos;
      loadMeteoriteField().then((field) => {
        this.meteoriteField = field;
        this.scene.add(field.group);
      });
    }

    // real Europa scan (see render/celestialModels.ts) loads in async — same placeholder-then-swap
    // split as the meteorite above.
    const europaBody = world.bodies.find((b) => b.europa);
    if (europaBody) {
      loadEuropaTemplate().then((model) => {
        const old = this.bodyMeshes.get(europaBody.name);
        if (old) { this.scene.remove(old); disposeObject3D(old); }
        this.bodyMeshes.set(europaBody.name, model);
        this.scene.add(model);
      });
    }

    // ship — hidden while piloting (no cockpit yet; the camera sits at the ship origin), shown when
    // the player is on foot so the parked ship is visible. Starts as an empty placeholder group and
    // is swapped onto the player's real hull (world.player.ship.type.model — the default AJF-12
    // Dvergr) once that template loads, below.
    this.shipMesh = this.buildShipMesh(world.player.ship.type.model);
    this.shipMesh.visible = false;
    this.scene.add(this.shipMesh);

    this.playerTrailMesh = createTrailRibbon(TRAIL_COLOR_PLAYER);
    this.playerTrailMesh.visible = false;
    this.scene.add(this.playerTrailMesh);

    // AI opponents — see the rebuildEnemyMeshes() call at the top of render(): the mesh set is
    // (re)built there, not here, since a scenario can swap world.enemies to a different array with
    // a different length at any time (see scenarios/runtime.ts::startScenario).
    this.rebuildEnemyMeshes(world.enemies);

    // Real glTF ship hulls (see shipModels.ts) load in async — the player ship and every enemy
    // render as empty placeholders until the model each one wears resolves, then get rebuilt onto
    // it. Each load is cached at module level, so these are no-op fetches/decodes after the very
    // first Renderer in the page's lifetime. Preload every model so a scenario that later swaps in
    // different opponents (render()'s rebuildEnemyMeshes call) always finds its template ready.
    for (const model of SHIP_MODEL_NAMES) {
      loadShipTemplate(model).then((template) => {
        this.shipTemplates.set(model, template);
        this.rebuildPlayerShip(world);
        this.rebuildEnemyMeshes(this.currentEnemyList ?? world.enemies);
      });
    }

    // lighting: a strong warm directional light from the sun, a dim cool hemisphere fill so
    // shadowed sides read as starlit rather than pure black, a soft ambient floor (metals with no
    // env map have no diffuse response at all, so they need *some* non-directional light or their
    // unlit faces go true black), and a "headlight" that always shines in the direction the camera
    // is looking (see its per-frame update in render()) so whatever ship you're looking at — an
    // opponent on the far side of the sun from you, say — always has its camera-facing side lit
    // regardless of where the sun happens to be.
    this.sunLight = new THREE.DirectionalLight(0xfff2d8, 2.6);
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
    this.scene.add(new THREE.HemisphereLight(0x3d5a7a, 0x14161e, 0.65));
    this.scene.add(new THREE.AmbientLight(0x404652, 0.35));
    this.fillLight = new THREE.DirectionalLight(0xcfe0ff, 1.1);
    this.scene.add(this.fillLight);
    this.scene.add(this.fillLight.target);

    // post: bloom (only bright things — sun, engine glow, bright stars) + tone-mapping output pass
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // SmoothBloomPass, not UnrealBloomPass: three's stock kernel is truncated at 1 sigma, which makes
    // each mip a soft box — square-cornered, with a hard edge at its support boundary that reads as a
    // ring in the sun's shine. Same width, same cost, actually Gaussian. See render/smoothBloomPass.ts.
    this.bloom = new SmoothBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.6,  // strength
      0.5,  // radius
      0.85  // luminance threshold — keep it high so only genuinely bright emitters glow
    );
    this.composer.addPass(this.bloom);
    // Tone-map + sRGB-encode to the 8-bit canvas, WITH dithering — the sun's glare is a very wide,
    // very shallow gradient, and undithered it quantizes into visible contour rings on any display
    // good enough to resolve single code values near black (see render/ditheredOutputPass.ts).
    this.composer.addPass(new DitheredOutputPass());

    this.impacts = new ImpactEffects(this.scene);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // Gather the `uTime` uniforms a body mesh exposes (see createSunMesh) so render() can drive them.
  private collectTimeUniforms(mesh: THREE.Object3D): void {
    const tu = mesh.userData.timeUniforms as { value: number }[] | undefined;
    if (tu) this.timeUniforms.push(...tu);
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    // composer.setSize takes CSS pixels and scales its targets (and every pass) by the renderer's
    // pixel ratio internally, so this is the full-resolution setup for the scene target.
    this.composer.setSize(w, h);
    // Bloom is then deliberately re-sized DOWN, as a fixed fraction of the real DRAWING BUFFER.
    // This line used to pass (w, h) — CSS pixels — which silently undid the composer's pixel-ratio
    // scaling above, so the blur chain's resolution depended on the display's DPR (1/3 of the
    // drawing buffer at dpr 1.5, 1/4 at dpr 2) rather than on any decision. A wide blur genuinely
    // does not need full resolution, so the reduction is kept — but expressed against the buffer
    // it blurs, so it is the same on every display. UnrealBloomPass halves whatever size it is
    // given to form mip 0, hence the factor of 2.
    const dpr = this.renderer.getPixelRatio();
    this.bloom.setSize(2 * w * dpr * BLOOM_MIP0_FRACTION, 2 * h * dpr * BLOOM_MIP0_FRACTION);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Absolute world position + orientation basis of the camera this frame, per control mode. The
  // free-fly spectator camera (only ever active while reviewing a replay — see
  // control/freeCamera.ts) takes priority over pilot/on-foot regardless of world.player.mode, since
  // it's an independent camera-only concern layered on top rather than a real control mode.
  private cameraView(world: World): { eye: Vec3; forward: Vec3; up: Vec3 } {
    if (FreeCamera.isActive()) return FreeCamera.getView();
    const p = world.player;
    if (p.mode === 'pilot') {
      const axes = computeAxes(p.ship.quat);
      return { eye: p.ship.pos, forward: axes.forward, up: axes.up };
    }
    const eye = footEye(p);
    return { eye: eye.pos, forward: eye.forward, up: eye.up };
  }

  render(world: World): void {
    const t = this.clock.getElapsedTime();
    for (const u of this.timeUniforms) u.value = t;

    const view = this.cameraView(world);
    const eye = view.eye;

    setCameraBasis(this.camera, view.forward, view.up);

    // floating origin: place every object relative to the camera's absolute position
    for (const body of world.bodies) {
      const mesh = this.bodyMeshes.get(body.name);
      if (mesh) mesh.position.set(body.pos.x - eye.x, body.pos.y - eye.y, body.pos.z - eye.z);
    }

    if (this.meteoriteField && this.meteoriteFieldCenter) {
      const c = this.meteoriteFieldCenter;
      this.meteoriteField.group.position.set(c.x - eye.x, c.y - eye.y, c.z - eye.z);
    }

    const ship = world.player.ship;
    // both of these assume the camera is sitting at the ship's own position (the cockpit view) —
    // wrong the instant the free-fly spectator camera (control/freeCamera.ts) is looking at the
    // ship from outside instead, same as being on foot: the speed-sensation dust doesn't belong to
    // an external view, and the player's own hull needs to actually be visible from one.
    const thirdPerson = world.player.mode === 'onfoot' || FreeCamera.isActive();
    this.spaceDust.mesh.visible = world.player.mode === 'pilot' && !FreeCamera.isActive();
    if (this.spaceDust.mesh.visible) this.updateSpaceDust(ship.pos, ship.vel);

    this.shipMesh.visible = thirdPerson;
    if (this.shipMesh.visible) {
      this.shipMesh.position.set(ship.pos.x - eye.x, ship.pos.y - eye.y, ship.pos.z - eye.z);
      const axes = computeAxes(ship.quat);
      setObjectBasis(this.shipMesh, axes.forward, axes.up);
    }

    // AI opponents — rebuild the mesh set only when world.enemies is a different array (a scenario
    // starting/switching, or Restart/Free-Flight via resetWorld) — orbiter/drifter respawn-in-place
    // mutates the same array/objects, so this correctly does NOT rebuild on every kill/respawn.
    if (world.enemies !== this.currentEnemyList) this.rebuildEnemyMeshes(world.enemies);

    // hidden while destroyed and waiting to respawn (respawnTimer > 0) or dead (health <= 0) — a
    // scenario enemy that's simply destroyed (no respawn) never sets respawnTimer, so the health
    // check is required too, not just the timer.
    world.enemies.forEach((enemy) => {
      const mesh = this.enemyMeshes.get(enemy);
      if (!mesh) return;
      const alive = enemy.respawnTimer <= 0 && enemy.health.points > 0;
      mesh.visible = alive;
      if (!alive) return;
      mesh.position.set(enemy.pos.x - eye.x, enemy.pos.y - eye.y, enemy.pos.z - eye.z);
      const axes = computeAxes(enemy.quat);
      setObjectBasis(mesh, axes.forward, axes.up);
    });

    // Roll Trainer ghost target — a translucent hologram of the player's own hull, repositioned
    // every frame ROLL_TRAINER_STANDOFF_M ahead of wherever the player is currently pointed, nose
    // aimed back at the player, physically rolling from level into the current challenge's target
    // bank (combat/rollTrainer.ts's getRollTrainerGhostUp — a world-space up vector, not a
    // rotation of the ghost's own local frame, since it faces backward). Not an EnemyShip: no
    // AI/health/hit-detection, purely a visual read on combat/rollTrainer.ts's state.
    const rollTrainer = world.rollTrainer;
    if (rollTrainer && !this.rollTrainerMesh) {
      this.rollTrainerMesh = this.buildGhostShipMesh(ship.type.model);
      this.scene.add(this.rollTrainerMesh);
    } else if (!rollTrainer && this.rollTrainerMesh) {
      this.scene.remove(this.rollTrainerMesh);
      disposeObject3D(this.rollTrainerMesh);
      this.rollTrainerMesh = null;
    }
    if (rollTrainer && this.rollTrainerMesh) {
      const shipAxes = computeAxes(ship.quat);
      const gx = ship.pos.x + shipAxes.forward.x * ROLL_TRAINER_STANDOFF_M;
      const gy = ship.pos.y + shipAxes.forward.y * ROLL_TRAINER_STANDOFF_M;
      const gz = ship.pos.z + shipAxes.forward.z * ROLL_TRAINER_STANDOFF_M;
      this.rollTrainerMesh.position.set(gx - eye.x, gy - eye.y, gz - eye.z);
      const forwardToPlayer = normalize(sub(ship.pos, { x: gx, y: gy, z: gz }));
      setObjectBasis(this.rollTrainerMesh, forwardToPlayer, getRollTrainerGhostUp(rollTrainer));
    }

    this.updateTrails(world, eye);

    // weapon-round tracers — a pooled straight red line per live projectile (see
    // createProjectileMesh), oriented in true 3D so its local +Z runs down the round's velocity
    // vector. The mesh's head sits at the round's position and the line trails PROJECTILE_LENGTH
    // metres behind it along -velocity. `refUp` is any axis not parallel to the travel direction
    // (the line is radially symmetric, so its roll is irrelevant) — setObjectBasis re-orthonormalises
    // it into a valid basis.
    //
    // The cross-section (local X/Y) is widened with distance so a far round doesn't shrink to a
    // sub-pixel, invisible sliver — a fixed-world-radius cylinder at 3km subtends far under one
    // pixel. `thickRate` is the world radius per metre of distance that keeps the line at least
    // MIN_TRACER_PX pixels wide, derived from the live vertical FOV and framebuffer height; near
    // rounds keep the base PROJECTILE_RADIUS (its true "double" thickness), distant ones grow to
    // hold that floor, so player fire stays legible out past 3km. Length (local Z) is left at its
    // true world value.
    const fovV = (this.camera.fov * Math.PI) / 180;
    const px = this.renderer.domElement.height || 720;
    const MIN_TRACER_PX = 2;
    const thickRate = (MIN_TRACER_PX * fovV) / (2 * px); // world radius per metre of distance
    world.projectiles.forEach((p, i) => {
      const mesh = this.projectileMesh(i);
      mesh.visible = true;
      const rx = p.pos.x - eye.x, ry = p.pos.y - eye.y, rz = p.pos.z - eye.z;
      mesh.position.set(rx, ry, rz);
      const dir = normalize(p.vel);
      const refUp = Math.abs(dir.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
      setObjectBasis(mesh, dir, refUp);
      const dist = Math.hypot(rx, ry, rz);
      const thickScale = Math.max(1, (dist * thickRate) / PROJECTILE_RADIUS);
      mesh.scale.set(thickScale, thickScale, 1);
    });
    for (let i = world.projectiles.length; i < this.projectilePool.length; i++) {
      this.projectilePool[i].visible = false;
    }

    // scenario gate path (winCondition: 'gates') — rebuilt only when the config's gatePath
    // reference changes (scenario start/switch), same identity-diff idiom as enemy meshes.
    const gatePath = world.scenario?.config.gatePath ?? null;
    if (gatePath !== this.currentGatePath) this.rebuildGateMeshes(gatePath);
    if (gatePath) {
      const gateIndex = world.scenario!.gateIndex;
      gatePath.forEach((gate, i) => {
        const mesh = this.gateMeshes[i];
        mesh.position.set(gate.pos.x - eye.x, gate.pos.y - eye.y, gate.pos.z - eye.z);
        const axes = computeAxes(gate.quat);
        setObjectBasis(mesh, axes.forward, axes.up);
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.color.set(i < gateIndex ? 0x3a5a3a : i === gateIndex ? 0x7dffa0 : 0x555555);
      });
    }

    // scenario range bubble (Merge Drill's rangeBubbleRadius) — a Fresnel-rimmed "stay inside" shell
    // plus a camera-facing ring outline around the nearest live enemy (see createCaptureBubble),
    // hidden whenever no scenario config asks for one. Colour flips green/amber on whether the
    // player is currently inside it, and a slow idle pulse keeps it visibly alive at a held range.
    const bubbleRadius = world.scenario?.config.rangeBubbleRadius;
    if (bubbleRadius !== undefined) {
      const target = world.enemies.find(e => e.respawnTimer <= 0 && e.health.points > 0);
      if (target) {
        const bubble = (this.rangeBubble?.radius === bubbleRadius) ? this.rangeBubble : this.rebuildRangeBubble(bubbleRadius);
        const rx = target.pos.x - eye.x, ry = target.pos.y - eye.y, rz = target.pos.z - eye.z;
        bubble.shellMesh.position.set(rx, ry, rz);
        bubble.ringMesh.position.set(rx, ry, rz);
        bubble.ringMesh.lookAt(0, 0, 0); // the camera is always pinned at the GL origin
        bubble.shellMesh.visible = true;
        bubble.ringMesh.visible = true;
        const dist = Math.hypot(target.pos.x - ship.pos.x, target.pos.y - ship.pos.y, target.pos.z - ship.pos.z);
        const inside = dist <= bubbleRadius;
        const pulse = 0.45 + 0.25 * (0.5 + 0.5 * Math.sin(t * (inside ? 3.2 : 1.6)));
        updateCaptureBubble(bubble, inside ? BUBBLE_COLOR_INSIDE : BUBBLE_COLOR_OUTSIDE, pulse);
      } else if (this.rangeBubble) {
        this.rangeBubble.shellMesh.visible = false;
        this.rangeBubble.ringMesh.visible = false;
      }
    } else if (this.rangeBubble) {
      this.rangeBubble.shellMesh.visible = false;
      this.rangeBubble.ringMesh.visible = false;
    }

    // combat bursts (see combat/effects.ts) — both kinds are one-shot TRIGGERS into the GPU hot-metal
    // system (render/impactEffects.ts), consumed exactly once via emittedImpacts. 'impact' fires a
    // small laser-hit spark spray; 'explosion' fires the big ship-death fireball. In both cases
    // impactEffects then owns the burst's full visual life, independent of the short-lived sim effect.
    const now = this.clock.getElapsedTime();
    for (const fx of world.effects) {
      if (this.emittedImpacts.has(fx)) continue;
      this.emittedImpacts.add(fx);
      if (fx.kind === 'explosion') this.impacts.explode(fx.pos, now);
      else this.impacts.trigger(fx.pos, fx.normal, now);
    }
    this.impacts.update(now, eye);

    // aim the sun light from the sun's relative direction toward the origin (camera)
    const sunRel = this.relDir(SUN, eye);
    this.sunLight.position.set(sunRel.x, sunRel.y, sunRel.z);
    this.sunLight.target.position.set(0, 0, 0);

    // the headlight shines in the direction the camera looks — position it behind the origin along
    // -forward so light travels toward +forward, same as the view direction (see the lighting
    // comment in the constructor)
    this.fillLight.position.set(-view.forward.x * 1e5, -view.forward.y * 1e5, -view.forward.z * 1e5);
    this.fillLight.target.position.set(0, 0, 0);

    this.composer.render();
  }

  // Lazily grows the projectile mesh pool to match however many rounds are in flight. Every round
  // uses the same LASER_COLOR regardless of owner, so unlike the pool's other users there's nothing
  // to re-tint per frame.
  private projectileMesh(i: number): THREE.Object3D {
    if (i >= this.projectilePool.length) {
      const mesh = createProjectileMesh(LASER_COLOR);
      this.scene.add(mesh);
      this.projectilePool.push(mesh);
    }
    return this.projectilePool[i];
  }

  // Builds one ship mesh for the given model id: a clone of that model's loaded template, or an
  // empty placeholder group if it hasn't resolved yet (the caller shows nothing until the swap).
  // Uses the model's own natural color (no tint) rather than a distinguishing accent — see
  // cloneShip's own doc comment for how an omitted tint skips the color-multiply step entirely.
  private buildShipMesh(model: string): THREE.Object3D {
    const template = this.shipTemplates.get(model as ShipModelName);
    if (!template) return new THREE.Group(); // placeholder until this model loads
    const mesh = cloneShip(template);
    // cloneShip instances share the template's geometry AND materials — mark so teardown frees
    // neither (see disposeObject3D)
    mesh.userData.sharedAssets = true;
    return mesh;
  }

  // Builds Roll Trainer's ghost target: a tinted, translucent clone of the given model (the
  // player's own hull) — see the render() call site. cloneShip's tint path clones each mesh's
  // material (not shared, safe to mutate below), but the underlying geometry stays shared with the
  // template even so, hence userData.sharedAssets = true to keep disposeObject3D from freeing it.
  private buildGhostShipMesh(model: string): THREE.Object3D {
    const template = this.shipTemplates.get(model as ShipModelName);
    if (!template) return new THREE.Group(); // placeholder until this model loads
    const mesh = cloneShip(template, TRAIL_COLOR_PLAYER);
    mesh.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mats = (Array.isArray(obj.material) ? obj.material : [obj.material]) as THREE.MeshStandardMaterial[];
      for (const m of mats) { m.transparent = true; m.opacity = 0.55; m.depthWrite = false; }
    });
    mesh.userData.sharedAssets = true;
    return mesh;
  }

  // Swaps the player's parked-ship mesh onto its real hull once that model loads (called from each
  // template-load callback). A no-op before the player's model resolves — buildShipMesh returned an
  // empty placeholder then and returns the same until the template is in the map.
  private rebuildPlayerShip(world: World): void {
    const model = world.player.ship.type.model;
    if (!this.shipTemplates.has(model as ShipModelName)) return;
    const wasVisible = this.shipMesh.visible;
    this.scene.remove(this.shipMesh);
    disposeObject3D(this.shipMesh);
    this.shipMesh = this.buildShipMesh(model);
    this.shipMesh.visible = wasVisible;
    this.scene.add(this.shipMesh);
  }

  // Tears down and recreates one mesh per current enemy, each cloning the template for the hull that
  // enemy's ShipType wears (enemy.type.model). Called whenever world.enemies is swapped for a
  // brand-new array (scenario start/switch, restart) — see the render() call site — and once more
  // when each ship model (shipModels.ts) finishes loading, to swap its placeholders for the model.
  private rebuildEnemyMeshes(enemies: EnemyShip[]): void {
    for (const mesh of this.enemyMeshes.values()) { this.scene.remove(mesh); disposeObject3D(mesh); }
    this.enemyMeshes.clear();
    for (const mesh of this.enemyTrailMeshes.values()) { this.scene.remove(mesh); disposeObject3D(mesh); }
    this.enemyTrailMeshes.clear();
    for (const enemy of enemies) {
      const mesh = this.buildShipMesh(enemy.type.model);
      this.scene.add(mesh);
      this.enemyMeshes.set(enemy, mesh);
      const trail = createTrailRibbon(TRAIL_COLOR_ENEMY);
      this.scene.add(trail);
      this.enemyTrailMeshes.set(enemy, trail);
    }
    this.currentEnemyList = enemies;
  }

  // Movement-history "roll band" behind each ship, visible only while reviewing a replay (see
  // replay/player.ts's getPlayerTrail/getEnemyTrail) — hidden outright during live flight, since
  // the trail data source only has meaning against a loaded clip.
  private updateTrails(world: World, eye: Vec3): void {
    const active = ReplayPlayer.isActive();
    // the player's own trail sits directly ahead of the camera in cockpit view whenever the
    // recorded flight was backstrafing (recent-past positions along the nose, current position
    // behind them) — only worth showing from an external vantage where it can't self-obscure.
    const playerTrailVisible = active && (world.player.mode !== 'pilot' || FreeCamera.isActive());
    this.playerTrailMesh.visible = playerTrailVisible;
    for (const mesh of this.enemyTrailMeshes.values()) mesh.visible = active;
    if (!active) return;

    const ship = world.player.ship;
    if (playerTrailVisible) {
      this.writeTrail(this.playerTrailMesh, ReplayPlayer.getPlayerTrail(TRAIL_WINDOW_SEC), ship, eye);
    }

    world.enemies.forEach((enemy, i) => {
      const mesh = this.enemyTrailMeshes.get(enemy);
      if (!mesh) return;
      const alive = enemy.respawnTimer <= 0 && enemy.health.points > 0;
      mesh.visible = alive;
      if (!alive) return;
      this.writeTrail(mesh, ReplayPlayer.getEnemyTrail(i, TRAIL_WINDOW_SEC), enemy, eye);
    });
  }

  // Appends the entity's current (already-interpolated) position/orientation as the trail's
  // leading point — matches exactly what its ship mesh is drawn at this frame, so the band's head
  // never lags a discrete recorded sample behind the hull it's trailing.
  private writeTrail(mesh: THREE.Mesh, history: ReplayPlayer.TrailPoint[], current: ShipBody | EnemyShip, eye: Vec3): void {
    const camRelative = (pos: Vec3, quat: Quat) => ({
      pos: { x: pos.x - eye.x, y: pos.y - eye.y, z: pos.z - eye.z },
      right: computeAxes(quat).right
    });
    const points = history.map((h) => camRelative(h.pos, h.quat));
    points.push(camRelative(current.pos, current.quat));
    updateTrailRibbon(mesh, points, current.type.hullRadius * 0.5);
  }

  // One ring mesh per gate in a 'gates' scenario's course, torn down and rebuilt whenever the
  // gatePath reference changes (a scenario starting/switching, or ending — null clears them).
  private rebuildGateMeshes(gatePath: FlightGate[] | null): void {
    for (const mesh of this.gateMeshes) { this.scene.remove(mesh); disposeObject3D(mesh); }
    this.gateMeshes = [];
    if (gatePath) {
      for (const gate of gatePath) {
        const mesh = new THREE.Mesh(
          new THREE.TorusGeometry(gate.radius, Math.max(1, gate.radius * 0.06), 8, 32),
          new THREE.MeshBasicMaterial({ color: 0x555555 })
        );
        this.scene.add(mesh);
        this.gateMeshes.push(mesh);
      }
    }
    this.currentGatePath = gatePath;
  }

  // Rebuilt only when the configured radius changes (scenario start/switch), same identity-diff
  // idiom as the gate meshes above — geometry is baked at the true radius rather than scaled from a
  // fixed base, so the ring and Fresnel falloff stay proportionally correct at any bubble size.
  private rebuildRangeBubble(radius: number): CaptureBubble {
    if (this.rangeBubble) {
      this.scene.remove(this.rangeBubble.shellMesh, this.rangeBubble.ringMesh);
      disposeObject3D(this.rangeBubble.shellMesh);
      disposeObject3D(this.rangeBubble.ringMesh);
    }
    const bubble = createCaptureBubble(radius);
    this.scene.add(bubble.shellMesh, bubble.ringMesh);
    this.rangeBubble = bubble;
    return bubble;
  }

  // Recomputes every dust mote's head/tail vertex positions and head alpha from the ship's current
  // absolute position and velocity — see createSpaceDust's doc comment for why no eye-subtraction
  // is needed here (the ship's own position IS the eye while piloting).
  private updateSpaceDust(shipPos: Vec3, vel: Vec3): void {
    const { bases, field } = this.spaceDust;
    const m = field * 2;
    const streakSeconds = 0.0225; // matches the original's DUST_STREAK_SECONDS
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    const visibility = speed < 0.05 ? 0 : Math.min(0.22, Math.max(0.05, Math.sqrt(speed) / 20));
    const wrap = (v: number) => (((v % m) + m) % m) - field;

    const posAttr = this.spaceDust.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const alphaAttr = this.spaceDust.mesh.geometry.getAttribute('aAlpha') as THREE.BufferAttribute;
    for (let i = 0; i < bases.length; i++) {
      const b = bases[i];
      const relX = wrap(b.x - shipPos.x), relY = wrap(b.y - shipPos.y), relZ = wrap(b.z - shipPos.z);
      const proximity = Math.min(1, Math.max(0, 1 - Math.hypot(relX, relY, relZ) / field));
      const i2 = i * 2;
      posAttr.setXYZ(i2, relX, relY, relZ);
      posAttr.setXYZ(i2 + 1, relX + vel.x * streakSeconds, relY + vel.y * streakSeconds, relZ + vel.z * streakSeconds);
      alphaAttr.setX(i2, proximity * visibility);
      alphaAttr.setX(i2 + 1, 0);
    }
    posAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
  }

  private relDir(body: CelestialBody, eye: Vec3): Vec3 {
    const dx = body.pos.x - eye.x, dy = body.pos.y - eye.y, dz = body.pos.z - eye.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const s = 1e6 / len;
    return { x: dx * s, y: dy * s, z: dz * s };
  }
}
