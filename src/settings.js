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

  // Seed the bloom sliders from the pass's actual defaults, so the two stay in
  // sync. Trail length, gravity, and wrap go the other way -- the markup is
  // the source of truth, so push their initial values into the particle field.
  strengthInput.value = bloomPass.strength;
  thresholdInput.value = bloomPass.threshold;
  particles.setTrailLength(Number(trailLengthInput.value));
  particles.setLandmarkGravity(Number(gravityInput.value));
  particles.setWrapEdges(wrapInput.checked);
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
