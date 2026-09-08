import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Bloom strength was tuned on a desktop; on a small viewport the same value
// floods the frame (each glowing particle covers relatively more of it). Scale
// strength by the short edge of the viewport against a reference, clamped.
const BASE_STRENGTH = 0.8;
const REF_SHORT_EDGE = 900;

export function bloomStrengthFor(width, height) {
  const k = THREE.MathUtils.clamp(Math.min(width, height) / REF_SHORT_EDGE, 0.5, 1.15);
  return BASE_STRENGTH * k;
}

export function createComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);

  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    bloomStrengthFor(window.innerWidth, window.innerHeight),
    0.4, // radius
    0.1  // threshold
  );
  composer.addPass(bloomPass);

  composer.addPass(new OutputPass());

  return { composer, bloomPass };
}
