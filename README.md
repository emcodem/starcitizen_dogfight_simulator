# Vector — Star Citizen Flight Practice Sandbox

**This is an unofficial, fan-made training tool.** It is not affiliated with,
endorsed by, or associated with Cloud Imperium Games or the Star Citizen
project in any way. It's a free browser sandbox for practicing flight
maneuvers and dogfighting fundamentals.

▶ **Play it here:** https://emcodem.github.io/starcitizen_dogfight_simulator/

No install, no account — it just runs in your browser.

## Features

- Newtonian, Star Citizen-inspired flight model — coupled/decoupled flight
  mode, space brake, boost, quaternion-based orientation (so pitch/roll/yaw
  stay correct relative to your current attitude)
- First-person cockpit view
- **Joystick / HOTAS support** — bind axes and buttons directly, or...
- **Import your real Star Citizen `actionmaps.xml`** — reuses your existing
  in-game keybinds and joystick mapping automatically instead of rebinding
  everything from scratch
- **Training scenarios**, picked from a menu on load:
  - **Free Flight** — open sandbox, no opponents, just a station to practice
    flying around (and avoid crashing into)
  - **Slow Turret Drill** — a stationary enemy ship with a slowed turn rate
    tracks and fires back at you. Land 50 hits to destroy it before it lands
    50 on you, aided by a predicted-impact-point (PIP) reticle that shows up
    once you're within 1.5km
- Works on desktop (keyboard, mouse, and/or joystick simultaneously) and on
  touch devices via on-screen controls

## Feedback, bugs, feature requests

Please [open an issue](https://github.com/emcodem/starcitizen_dogfight_simulator/issues)
rather than messaging directly. To help get it fixed or built quickly,
explain in as much detail as you can:

- What you saw (or what you want to happen instead)
- Steps to reproduce, if it's a bug
- Your browser (this project targets Chromium — Chrome/Edge/Brave)
- Which scenario/ship was involved, and a screenshot if you have one

## Development

See [HANDOFF.md](HANDOFF.md) for architecture notes, the dev workflow, and
design decisions if you want to build or modify this yourself.
