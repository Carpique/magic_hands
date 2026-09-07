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
- `src/style.css` — black full-bleed background, fullscreen button styling

## Notes

- Particle count is set in `src/particles.js` (`createParticles(count = 100_000)`) — lower it there if it's not smooth on your machine.
- The current motion (`particles.rotation.y = ...` in `main.js`) and the trail/bloom parameters in `postprocessing.js` are placeholders, there to prove the pipeline works end to end. Swap them out once the real motion and visual design are decided.
- `three` and `vite` are pinned to `latest` in `package.json` so `npm install` grabs current versions — worth locking to specific versions once the project stabilizes.
