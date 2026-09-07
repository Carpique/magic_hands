import * as THREE from 'three';
import { createFloatingParticles } from './particles.js';
import { createComposer } from './postprocessing.js';
import { initFullscreenToggle } from './fullscreen.js';
import { initSettingsPanel } from './settings.js';
import { createHandTracker } from './handTracking.js';

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

const clock = new THREE.Clock();

function animate() {
  const delta = clock.getDelta();
  particles.setHandLandmarks(handTracker.update());
  particles.update(delta);
  composer.render();
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);

initFullscreenToggle(document.getElementById('fullscreen-btn'));
initSettingsPanel(
  document.getElementById('settings-btn'),
  document.getElementById('settings-panel'),
  bloomPass
);

// Camera hand tracking: toggled on demand so the browser only asks for camera
// permission when the user actually wants it.
const handBtn = document.getElementById('hand-btn');
const cameraPreview = document.getElementById('camera-preview');
cameraPreview.appendChild(handTracker.video);

handBtn.addEventListener('click', async () => {
  if (handTracker.running) {
    handTracker.stop();
    handBtn.classList.remove('is-active');
    handBtn.setAttribute('aria-pressed', 'false');
    cameraPreview.classList.remove('is-visible');
    return;
  }

  handBtn.classList.add('is-loading');
  try {
    await handTracker.start();
    handBtn.classList.add('is-active');
    handBtn.setAttribute('aria-pressed', 'true');
    cameraPreview.classList.add('is-visible');
  } catch (err) {
    console.error('Hand tracking failed to start:', err);
    handBtn.classList.add('is-error');
    setTimeout(() => handBtn.classList.remove('is-error'), 2000);
  } finally {
    handBtn.classList.remove('is-loading');
  }
});
