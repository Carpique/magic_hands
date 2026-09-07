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

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  particles.setDomain(camera);
}
window.addEventListener('resize', onResize);

const handTracker = createHandTracker();

const handOverlay = createHandOverlay();

const clock = new THREE.Clock();

function animate() {
  const delta = clock.getDelta();
  particles.setHandLandmarks(handTracker.update());
  handOverlay.update(particles.getHandTargets());
  particles.update(delta);

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
// The hand button only toggles the debug view: the gray landmark skeleton drawn
// in the scene, plus the mirrored camera thumbnail.
const handBtn = document.getElementById('hand-btn');
const cameraPreview = document.getElementById('camera-preview');
cameraPreview.appendChild(handTracker.video);

handTracker.start().catch((err) => {
  console.error('Hand tracking failed to start:', err);
  handBtn.classList.add('is-error');
});

handBtn.addEventListener('click', () => {
  const show = !handOverlay.visible;
  handOverlay.setVisible(show);
  handBtn.classList.toggle('is-active', show);
  handBtn.setAttribute('aria-pressed', String(show));
  cameraPreview.classList.toggle('is-visible', show);
});
