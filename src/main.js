import * as THREE from 'three';
import { createFloatingParticles } from './particles.js';
import { createComposer } from './postprocessing.js';
import { initFullscreenToggle } from './fullscreen.js';
import { initSettingsPanel } from './settings.js';

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

const clock = new THREE.Clock();

function animate() {
  const delta = clock.getDelta();
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
