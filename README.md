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
- `src/particles.js` — particle geometry (currently a placeholder: 100,000 points arranged in a sphere)
- `src/postprocessing.js` — `EffectComposer` chain: `AfterimagePass` (trails) + `UnrealBloomPass` (glow)
- `src/fullscreen.js` — wires up the fullscreen toggle button
- `src/handTracking.js` — MediaPipe Hand Landmarker running on the webcam feed
- `src/style.css` — black full-bleed background, fullscreen button styling

## Hand tracking

The hand icon (top-right) turns on camera hand tracking. It uses Google
MediaPipe's [Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
task — the WASM runtime and the `hand_landmarker.task` model are pulled from a
CDN on first use and then cached by the browser, so no binaries live in the repo.
While it's on, every particle keeps its own speed but continuously bends its
heading toward the nearest detected landmark (any of the 21 points, on up to two
hands), so the whole field drifts toward your hand. The MediaPipe bundle is
lazy-loaded, so it costs nothing until the feature is switched on. Needs a secure
context (works on `localhost`).

## Notes

- Particle count is set in `src/particles.js` (`createParticles(count = 100_000)`) — lower it there if it's not smooth on your machine.
- The current motion (`particles.rotation.y = ...` in `main.js`) and the trail/bloom parameters in `postprocessing.js` are placeholders, there to prove the pipeline works end to end. Swap them out once the real motion and visual design are decided.
- `three` and `vite` are pinned to `latest` in `package.json` so `npm install` grabs current versions — worth locking to specific versions once the project stabilizes.
