# Turret-fire screen blackout / flicker — root cause

**Status:** FIXED and verified 2026-08-16. Two layers landed — the `Math.max(0, dist)` clamp in
`sampleFlameColor()` (the cause) and non-finite texel rejection in `SmoothBloomPass`'s high-pass
(the blast wall). Measured result, `?turretrepro`, 100+ frames per run:

| state | black frames | max NaN texels in the scene target |
|---|---|---|
| neither fix *(= the original bug)* | **39/118 (33%)** | 1,440,015 — i.e. the whole target |
| blast wall only, cause left in | **0** | 64 — contained to the pixels the bolts cover |
| **both (shipped)** | **0** | **0** |

The middle row is the point of the blast wall: with the clamp deliberately removed the NaN is still
produced, but it can no longer leave the few dozen pixels it belongs to.

**Reported:** stars and enemy lasers vanish over a large area, whole screen flickers, framerate drops,
whenever an enemy is firing at you while you face it. Worse at long range (many consecutive black
frames at ~1.6 km) than at point-blank (rapid flicker, few consecutive black frames).

---

## One-line summary

A single vertex of the laser-bolt nose gets `alpha = NaN` from `Math.pow(negative, 1.3)`, and the
bloom pass's blur smears that NaN across the entire framebuffer, turning the whole frame black.

---

## The defect

`src/render/meshes.ts` — `sampleFlameColor()`, called per-vertex from `createProjectileMesh()`:

```ts
const dist = HEAD_RADIUS - headPos.getZ(i); // 0 at the front pole (the nose tip)
...
const t = dist / TOTAL_SPAN;
return 1 - Math.pow(t, 1.3);                // <-- NaN when t < 0
```

`HEAD_RADIUS` is a JS double (`0.16 * 0.85 = 0.136`), but `SphereGeometry` stores its positions in a
`Float32Array`, where that value rounds **up** to `0.13600000739097595`. At the nose-tip pole vertex:

```
dist = 0.136 - 0.13600000739097595 = -7.39e-9   (negative)
t    = -2.83e-10
1 - Math.pow(t, 1.3)                            =  NaN   // fractional exponent of a negative base
```

Verified numerically; also verified in the live app — dumping the built geometry shows exactly one
bad vertex, and it is the nose pole:

```
SphereGeometry  vertices=143 colorItemSize=4  BAD=1
   v  68 rgba=[0.800, 0.281, 0.094, NaN]  localPos=[-0.000, 0.000, 0.136]
CylinderGeometry  vertices=187 colorItemSize=4  BAD=0
```

Only the sphere (head) is affected. The cone (tail) samples `dist >= HEAD_RADIUS`, so it never goes
negative.

## Why it blacks out the whole screen

1. The NaN alpha is baked into the bolt's vertex `color` attribute, so every bolt drawn writes a
   handful of NaN pixels into the scene render target (8–72 px measured; the count scales with how
   large the bolt is on screen, i.e. how close it is).
2. `SmoothBloomPass` blurs the scene target. A Gaussian blur is a weighted sum — **any** NaN in the
   kernel's footprint makes the output NaN, and the mip chain propagates it to every texel.
3. The bloom result is composited back over the scene, so the whole frame becomes NaN → renders black.

Measured, per frame, on the scene target vs. after bloom:

| frame | screen lit | scene NaN texels | post-bloom NaN texels |
|-------|-----------|------------------|-----------------------|
| lit   | 0.046     | 0                | 0                     |
| black | 0.000     | 8–72             | 57600 (= every RGB texel sampled) |

Correlation was 100%: **every** black frame had scene NaN; clean frames had none.

## Why it looks range-dependent

Nothing about range is special — it is purely how many bolts are alive on screen at once. A distant
shooter means longer flight time, so more bolts are in the air simultaneously and a larger fraction of
frames contain at least one → long runs of consecutive black frames. Up close each bolt exists briefly,
so black frames are interleaved with clean ones → rapid flicker.

## Why "it wasn't always like this"

The NaN itself is old (it dates to whenever the bolt nose geometry was authored). What changed is how
far bloom spreads it. Commit `5fc7594` *"Fix sun-shine banding and make the glow actually round"*
(2026-07-30) replaced three.js's stock blur — a kernel truncated at 1 sigma — with a true 3-sigma
Gaussian (`src/render/smoothBloomPass.ts`). A wider kernel means a single NaN texel reaches far more
of the image, so what may previously have been a small local artifact now nukes the entire frame.

Note the pass *chain* (`RenderPass → bloom → OutputPass`) is unchanged from the initial commit, so the
chain is not the regression.

## Evidence trail (what was ruled out)

Reproduced headlessly and measured by reading the framebuffer directly (no eyeballing):

| experiment | black frames |
|---|---|
| baseline (bloom on, enemy firing) | 42/100 |
| bloom disabled | 0/100 |
| bloom `strength = 0` | 33/100 |
| bloom `threshold = 100` (nothing passes) | 39/100 |
| bloom in chain but `render()` no-op'd | 0/100 |
| bloom last, `OutputPass` removed | 0/100 |
| **projectile meshes removed from scene** | **0/100 (0 NaN frames)** |
| impact-effect objects removed | still bad (39 NaN frames) |
| starfield + space dust removed | still bad (40 NaN frames) |
| plain free flight, nobody shooting | 0/100 |

`strength = 0` / `threshold = 100` still failing is the key result: bloom contributing *nothing*
visually still blacks out the frame, because NaN propagates through the blur regardless of weights
(`NaN * 0 = NaN`).

Also checked and clean: no JS exceptions, no GL errors, no incomplete framebuffers, no context loss,
no NaN in any object transform/matrix, and the render-target ping-pong is not at fault (both
`renderTarget1` and `renderTarget2` fail equally).

Not browser- or GPU-specific: reproduces in headless Chromium/SwiftShader here, and the reporter sees
it in both Chrome and Firefox.

## The fix (applied)

Clamp the base before the fractional power, in `sampleFlameColor()`:

```ts
const t = Math.max(0, dist) / TOTAL_SPAN;
return 1 - Math.pow(t, 1.3);
```

With that, the nose-tip vertex yields `alpha = 1` (fully opaque at the tip), which is the intended
value — the taper is meant to start at 1 and fall to 0 at the tail tip.

And, independently — a single stray NaN anywhere in the scene should not be able to destroy the whole
frame. `SmoothBloomPass` now replaces the stock `LuminosityHighPassShader` fragment shader with one
that rejects non-finite texels. The high-pass is the right chokepoint: everything the blur ever reads
comes out of `renderTargetBright`, which is that material's output, so nothing non-finite can enter
the mip pyramid regardless of what the scene did.

GLSL ES 1.00 (what three compiles `ShaderMaterial` to even on WebGL2) has no `isnan()`, and NaN
poisons any arithmetic it touches, so it can't be filtered after the fact. The portable test is a
comparison — IEEE-754 makes *every* comparison involving NaN false, so `abs(x) < 1e12 ? x : 0.0`
falls through to `0.0` for NaN, and catches ±Inf in the same expression.

## Reproducing

`__debugPointBlankTurret()` (added in `src/main.ts`) spawns a stationary turret 100 m dead ahead,
already aimed, firing continuously. `?turretrepro` in the URL auto-starts it on load.

To measure rather than eyeball: hook `requestAnimationFrame`, and after the app's frame callback call
`gl.readPixels` on the default framebuffer, counting texels above a small luminance threshold — black
frames read as exactly zero. To detect the NaN itself, read the scene render target with
`renderer.readRenderTargetPixels` into a `Uint16Array` (the target is `HalfFloatType`) and test
`(v & 0x7C00) === 0x7C00 && (v & 0x03FF)`. Read the **whole** target — there are only tens of bad
texels and they sit wherever the bolts are, so a corner crop reads a false clean.

---

# Appendix: the point-blank explosion WHITEOUT (separate issue, also resolved)

A different symptom that got tangled into the same investigation: an enemy destroyed at merge range
supposedly whiting out the frame. NaN renders *black*, so this was never the same bug.

**It is already fixed, and the fix is `gl_PointSize`'s cap in `render/impactEffects.ts`** — together
with `hullSurfaceImpact` (commit `44d7e16`, already on master). Re-measured full-frame with an
explosion spawned dead ahead, peak fraction of near-white pixels over the burst's whole life:

| | 60 m | 40 m | 20 m | 8 m |
|---|---|---|---|---|
| cap in place | 4% / 0% | 10% / 0% | 27% / 9% | 24% / 9% |
| cap removed | 4% / 0% | 10% / 0% | 38% / 18% | **100% / 100%** |

*(whole frame / screen border.)* Beyond ~40 m the cap never binds and costs nothing; inside it, it is
the whole difference between a bright explosion and a lost frame.

## Two wrong turns worth not repeating

**1. Measuring on a centre patch.** The burst is spawned dead ahead, so a centre crop reads ~100%
"blown" for a completely normal fireball. Measured that way, every distance out to 60 m looks like a
catastrophic whiteout; measured full-frame, 60 m is 4%. Always measure the whole frame, and check the
screen *border* separately — "the whole screen goes white" is a claim about the edges.

**2. Blaming the billboards.** An isolation sweep (each component disabled in turn) showed the
flash and the two fireball billboards contribute essentially nothing, and `sparks only` is
indistinguishable from the full explosion at every distance:

| variant | 100 m | 60 m | 40 m | 20 m | 8 m |
|---|---|---|---|---|---|
| full explosion | 1% | 4% | 11% | 28% | 28% |
| sparks only | 2% | 4% | 10% | 26% | 20% |
| no flash | 1% | 4% | 11% | 28% | 29% |
| no fireball | 2% | 4% | 10% | 27% | 23% |
| full, bloom OFF | 1% | 2% | 5% | 13% | 17% |

So an earlier `NEAR_CAMERA_SKIP_DISTANCE = 40` guard that skipped the flash/fireball below 40 m
(while deliberately keeping the sparks) suppressed exactly the two components that were innocent and
left the one that mattered. It was reverted. Bloom is an amplifier here, not the cause — with bloom
off the uncapped case still blows out.
