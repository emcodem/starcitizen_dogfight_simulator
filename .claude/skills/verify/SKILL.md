---
name: verify
description: Project-specific recipe for driving Vector in a real headless browser to verify gameplay changes (scenario/combat/render fixes especially).
---

# Verifying gameplay changes in Vector

This is a canvas-rendered, no-framework TS app — there's no component test
harness, so verification means actually running it in a browser. This is the
recipe that worked; skip the cold-start next time.

## Launch

```bash
npm run dev   # background it; check its stdout for the actual port —
              # 5173/5174 are often already taken by a leftover session,
              # Vite silently increments to 5175, etc.
```

## Driving it — Playwright

Playwright isn't a project devDependency, but it's available globally in
the user's home directory (`C:\Users\Gam3r1\node_modules\playwright`,
confirmed v1.61.1 with Chromium already installed). Don't `npm install` it
into this repo. Instead write a `.mjs` script anywhere and run it with:

```bash
cd ~ && node /path/to/script.mjs
```

(`cd ~` so Node's module resolution finds the home-dir `node_modules`.)

Menu automation:
- Dismiss the startup modal: click `#startup-modal-ok` (may appear more
  than once — loop it).
- Start a scenario: `page.locator('.scenario-card', { hasText: 'NAME' }).locator('button').click()`.
- Click `#c` (the canvas) once to focus it before sending keys.
- Fire without needing Pointer Lock: hold `ShiftRight` down
  (`initKeyboardFireFallback` in `mouseCapture.ts` — no mouse capture
  required, avoids Pointer Lock flakiness in headless Chromium).

## Reading real game state — temporary debug hook

There's no exported accessor for the live `ship`/`activeRuntime` objects in
`main.ts` (deliberately — it's not test code). To verify against real state
instead of guessing from pixels, temporarily add one line right before the
main loop in `src/main.ts`:

```ts
(window as any).__debugState = () => ({ ship, activeRuntime });
```

Then from Playwright: `page.evaluate(() => window.__debugState())` gives
you the actual `Ship` and `ScenarioRuntime` (enemies, health, `vel`,
`angVel`, `explosions`, `stats`, ...) as they exist mid-game.

**Always remove this line again once done**, and confirm with
`git diff --stat` that `main.ts` shows no net change before finishing.

## Forcing a rare state to happen quickly

Some states (e.g. a drone kill, which needs `hitsToKillEnemy` real landed
hits while precisely aiming a Newtonian flight model) are slow to reach by
scripted play. It's legitimate to temporarily edit a scenario's tuning
(e.g. `hitsToKillEnemy: 3` → `1` in `scenarios/definitions.ts`) to make the
target state trivial to reach in an automated run, exercise it, then
**revert the edit** and confirm via `git diff` before finishing. This is
different from calling functions in isolation — the rest of the real app
(rendering, hit detection, respawn timers) still runs unmodified.

## Steering the ship from a script

The flight model is Newtonian rate control (arrow keys apply angular
*thrust*, not an absolute look direction) — a naive "hold the key that
looks right" bang-bang controller overshoots badly (one attempt: 384 shots
fired, 0 hits). Two things matter:

1. **Don't trust the naive key-to-screen-direction mapping.** In this
   build, empirically: `dx > 0` (target right of center) → `ArrowRight` is
   correct, but `dy < 0` (target *above* center) needs `ArrowDown`, not
   `ArrowUp` — inverted from the naive guess. Re-calibrate rather than
   hardcoding this if the flight/camera code changes: press a key for
   ~300ms, diff the PIP's screen position before/after, and pick whichever
   key reduces the error.
2. Use short pulses (tens of ms) proportional to pixel error, and treat
   anything inside the ESP assist circle (~45px) as "close enough, stop
   steering" — `angularDrag` (see `physics/flightModel.ts`) naturally decays
   angVel to zero when you release, so you don't need to actively brake.

To find the PIP's on-screen position without the debug hook, read the
canvas pixels directly and look for its stroke color `#ffe696`
(`rgb(255,230,150)`):

```js
await page.evaluate(() => {
  const c = document.getElementById('c');
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const { width, height } = c;
  const data = ctx.getImageData(0, 0, width, height).data;
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
    const i = (y * width + x) * 4;
    const r = data[i], g = data[i+1], b = data[i+2];
    if (r > 235 && g > 210 && g < 245 && b > 120 && b < 175) { sx += x; sy += y; n++; }
  }
  return { pipX: n ? sx / n : null, pipY: n ? sy / n : null, n };
});
```

**Gotcha:** don't try to detect the enemy-explosion effect by pixel color.
Its palette (warm orange/yellow, `drawEnemyExplosions` in `render.ts`)
overlaps the player's own tracer color (`#ffe696`-ish, `weapons.ts`), so a
color-threshold heuristic fires constantly while shooting regardless of
whether anything died (measured: 34–46 "explosion" false positives in a
~50s run with zero actual kills). Read `runtime.explosions.length` via the
debug hook instead — it's authoritative and free of this ambiguity.
