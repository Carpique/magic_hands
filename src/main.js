import * as THREE from 'three';
import { createFloatingParticles } from './particles.js';
import { createComposer } from './postprocessing.js';
import { initFullscreenToggle } from './fullscreen.js';
import { initSettingsPanel } from './settings.js';
import { createHandTracker } from './handTracking.js';
import { createHandOverlay } from './handOverlay.js';

const canvas = document.getElementById('scene');

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.z = 14;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const particles = createFloatingParticles(renderer, camera);
scene.add(particles.points);

const { composer, bloomPass } = createComposer(renderer, scene, camera);

const handTracker = createHandTracker();

const handOverlay = createHandOverlay();
handOverlay.setSize(window.innerWidth, window.innerHeight);

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  particles.setDomain(camera);
  handOverlay.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

// Space toggles the simulation. Rendering keeps going so the frozen frame (and
// the "Pause" overlay) stays on screen.
const pauseOverlay = document.getElementById('pause-overlay');
let paused = false;
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat) return;
  e.preventDefault();
  paused = !paused;
  pauseOverlay.hidden = !paused;
});

const timer = new THREE.Timer();

function animate() {
  timer.update();
  const delta = timer.getDelta();

  if (!paused) {
    particles.setHandLandmarks(handTracker.update());
    handOverlay.update(particles.getHandTargets());
    particles.update(delta);
  }

  composer.render();
  if (handOverlay.visible) {
    renderer.autoClear = false;
    renderer.render(handOverlay.scene, camera);
    renderer.autoClear = true;
  }

  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);

initFullscreenToggle(document.getElementById('fullscreen-btn'));
initSettingsPanel(
  document.getElementById('settings-btn'),
  document.getElementById('settings-panel'),
  bloomPass
);

// The camera + hand tracking run from page load; the particles always react.
// The hand button toggles the landmark skeleton drawn in the scene; the camera
// button toggles the mirrored camera thumbnail. They're independent.
const handBtn = document.getElementById('hand-btn');
const cameraBtn = document.getElementById('camera-btn');
const cameraPreview = document.getElementById('camera-preview');
cameraPreview.appendChild(handTracker.video);

handTracker.start().catch((err) => {
  console.error('Hand tracking failed to start:', err);
  handBtn.classList.add('is-error');
});

// Hand landmark overlay: on by default.
function setHandOverlay(show) {
  handOverlay.setVisible(show);
  handBtn.classList.toggle('is-active', show);
  handBtn.setAttribute('aria-pressed', String(show));
}
setHandOverlay(true);

handBtn.addEventListener('click', () => {
  setHandOverlay(!handOverlay.visible);
  handBtn.blur(); // so Space (pause) doesn't re-trigger the focused button
});

// Camera preview thumbnail: off by default.
let cameraVisible = false;
cameraBtn.addEventListener('click', () => {
  cameraVisible = !cameraVisible;
  cameraPreview.classList.toggle('is-visible', cameraVisible);
  cameraBtn.classList.toggle('is-active', cameraVisible);
  cameraBtn.setAttribute('aria-pressed', String(cameraVisible));
  cameraBtn.blur();
});

window.__debug = { particles, handOverlay, setPaused: (v) => { paused = v; pauseOverlay.hidden = !v; } };
