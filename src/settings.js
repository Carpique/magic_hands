import { bloomStrengthFor } from './postprocessing.js';

// The one place to change what this app starts up with. Everything else --
// the settings panel's sliders, the bloom pass, the particle field -- gets
// its initial value from here instead of from scattered constants or from
// index.html's markup, so there's a single spot to edit a default.
export const DEFAULTS = {
  bloomStrength: 1.5, // pre-viewport-scaling base -- see bloomStrengthFor
  bloomThreshold: 0,
  trailLength: 30,
  gravity: 170,
  wrapEdges: false,
};

// Wires the slim overlay panel's controls to the bloom pass and the particle
// field, and the arrow button that shows/hides it.
export function initSettingsPanel(button, panel, bloomPass, particles, onStrengthOverride) {
  const strengthInput = panel.querySelector('#bloom-strength');
  const thresholdInput = panel.querySelector('#bloom-threshold');
  const trailLengthInput = panel.querySelector('#trail-length');
  const gravityInput = panel.querySelector('#landmark-gravity');
  const wrapInput = panel.querySelector('#wrap-edges');

  const strengthValue = panel.querySelector('#bloom-strength-value');
  const thresholdValue = panel.querySelector('#bloom-threshold-value');
  const trailLengthValue = panel.querySelector('#trail-length-value');
  const gravityValue = panel.querySelector('#landmark-gravity-value');

  function updateReadouts() {
    strengthValue.textContent = Number(strengthInput.value).toFixed(2);
    thresholdValue.textContent = Number(thresholdInput.value).toFixed(2);
    trailLengthValue.textContent = String(Math.round(Number(trailLengthInput.value)));
    gravityValue.textContent = String(Math.round(Number(gravityInput.value)));
  }

  // Push DEFAULTS into both the inputs (so the panel displays them) and the
  // pass/particle field (so they actually take effect) -- the markup's own
  // value/checked attributes are just a no-JS fallback, not the source of
  // truth.
  const effectiveStrength = bloomStrengthFor(window.innerWidth, window.innerHeight, DEFAULTS.bloomStrength);
  bloomPass.strength = effectiveStrength;
  strengthInput.value = effectiveStrength;

  bloomPass.threshold = DEFAULTS.bloomThreshold;
  thresholdInput.value = DEFAULTS.bloomThreshold;

  particles.setTrailLength(DEFAULTS.trailLength);
  trailLengthInput.value = DEFAULTS.trailLength;

  particles.setLandmarkGravity(DEFAULTS.gravity);
  gravityInput.value = DEFAULTS.gravity;

  particles.setWrapEdges(DEFAULTS.wrapEdges);
  wrapInput.checked = DEFAULTS.wrapEdges;

  updateReadouts();

  strengthInput.addEventListener('input', () => {
    bloomPass.strength = Number(strengthInput.value);
    updateReadouts();
    // Once the user sets strength by hand, stop auto-scaling it on resize.
    onStrengthOverride?.();
  });
  thresholdInput.addEventListener('input', () => {
    bloomPass.threshold = Number(thresholdInput.value);
    updateReadouts();
  });
  trailLengthInput.addEventListener('input', () => {
    particles.setTrailLength(Number(trailLengthInput.value));
    updateReadouts();
  });
  gravityInput.addEventListener('input', () => {
    particles.setLandmarkGravity(Number(gravityInput.value));
    updateReadouts();
  });
  wrapInput.addEventListener('change', () => {
    particles.setWrapEdges(wrapInput.checked);
  });

  button.addEventListener('click', () => {
    const isOpen = panel.classList.toggle('is-open');
    button.classList.toggle('is-open', isOpen);
    button.setAttribute('aria-expanded', String(isOpen));
  });
}
