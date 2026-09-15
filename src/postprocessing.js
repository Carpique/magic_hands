import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Bloom strength was tuned on a desktop; on a small viewport the same value
// floods the frame (each glowing particle covers relatively more of it). Scale
// baseStrength (DEFAULTS.bloomStrength in settings.js -- that's the one place
// to change the default) by the short edge of the viewport against a
// reference, clamped.
const REF_SHORT_EDGE = 900;

export function bloomStrengthFor(width, height, baseStrength) {
  const k = THREE.MathUtils.clamp(Math.min(width, height) / REF_SHORT_EDGE, 0.5, 1.15);
  return baseStrength * k;
}

// Strength/threshold are placeholders here -- initSettingsPanel (settings.js)
// overwrites both from DEFAULTS as soon as it runs, before the first frame
// renders, so this module doesn't need to know what the actual defaults are.
export function createComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);

  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1,   // strength
    0,   // radius -- fixed; no longer exposed in the settings panel
    0    // threshold
  );
  composer.addPass(bloomPass);

  composer.addPass(new OutputPass());

  return { composer, bloomPass };
}
