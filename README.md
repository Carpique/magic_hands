# Particle System

## Setup

```
npm install
npm run dev
```

Then open the local URL Vite prints (usually http://localhost:5173).

## Structure

- `index.html` — entry HTML, kept in the project root
- `src/main.js` — scene/camera/renderer setup and the render loop
- `src/particles.js` — the particle field: geometry, motion, and the hand-driven physics
- `src/postprocessing.js` — `EffectComposer` chain: `AfterimagePass` (trails) + `UnrealBloomPass` (glow)
- `src/fullscreen.js` — wires up the fullscreen toggle button
- `src/handTracking.js` — MediaPipe Hand Landmarker running on the webcam feed
- `src/handOverlay.js` — gray 21-point hand skeleton drawn in the particle scene (debug view)
- `src/style.css` — black full-bleed background, fullscreen button styling

## Hand tracking

Camera hand tracking runs from page load, using Google MediaPipe's
[Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
task — the WASM runtime and the `hand_landmarker.task` model are pulled from a
CDN on first use and then cached by the browser, so no binaries live in the repo.
Needs a secure context (works on `localhost`).

The particles are free-floating points — random start position, random initial
velocity, and nothing touches them until a hand appears. There is no gravity
between particles.

While hand landmarks are tracked, each one (21 per hand, up to two) is a fixed
heavy attractor pulling every particle with softened Newtonian gravity
(`LANDMARK_G`, `LANDMARK_SOFTENING`), so the field pools toward your hand. Remove
the hand and the pull just stops — particles keep their velocity and drift on.

The x/y plane wraps at the screen edges (a torus), so particles glide straight
through rather than bouncing off walls — smoother, and gravity is measured to the
nearest wrapped image of each landmark. With no walls to shed energy, a soft
speed cap is the only sink: anything faster than `CALM_SPEED` eases back toward it
(keeping its heading), so repeated dives into a hand's well can't heat the field
without bound. z stays a shallow bouncing slab (wrapping it would pop particles
in the perspective projection).

The hand icon (top-right) toggles a debug view: the 21-point landmark skeleton
drawn as gray lines directly in the particle scene — so you can see exactly how
MediaPipe's normalized landmarks get scaled and placed — plus a small mirrored
camera thumbnail in the corner.

## Notes

- Particle count is `PARTICLE_COUNT` at the top of `src/particles.js`. Gravity is only O(particles × landmarks) now, so it scales cheaply.
- `LANDMARK_G`, `LANDMARK_SOFTENING`, the initial speed range, `CALM_SPEED` / `CALM_RELAX` (the soft speed cap), and `SPEED_DECAY` (a non-physical drag that brings an undisturbed field to rest over ~`1/SPEED_DECAY` seconds) are all named constants at the top of `src/particles.js`.
- `three` and `vite` are pinned to `latest` in `package.json` so `npm install` grabs current versions — worth locking to specific versions once the project stabilizes.
