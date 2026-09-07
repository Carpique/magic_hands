// Wires the slim overlay panel's sliders to the bloom pass, and the arrow
// button that shows/hides it.
export function initSettingsPanel(button, panel, bloomPass) {
  const strengthInput = panel.querySelector('#bloom-strength');
  const radiusInput = panel.querySelector('#bloom-radius');
  const thresholdInput = panel.querySelector('#bloom-threshold');

  const strengthValue = panel.querySelector('#bloom-strength-value');
  const radiusValue = panel.querySelector('#bloom-radius-value');
  const thresholdValue = panel.querySelector('#bloom-threshold-value');

  function updateReadouts() {
    strengthValue.textContent = Number(strengthInput.value).toFixed(2);
    radiusValue.textContent = Number(radiusInput.value).toFixed(2);
    thresholdValue.textContent = Number(thresholdInput.value).toFixed(2);
  }

  // Seed the sliders from the pass's actual defaults, so the two stay in sync.
  strengthInput.value = bloomPass.strength;
  radiusInput.value = bloomPass.radius;
  thresholdInput.value = bloomPass.threshold;
  updateReadouts();

  strengthInput.addEventListener('input', () => {
    bloomPass.strength = Number(strengthInput.value);
    updateReadouts();
  });
  radiusInput.addEventListener('input', () => {
    bloomPass.radius = Number(radiusInput.value);
    updateReadouts();
  });
  thresholdInput.addEventListener('input', () => {
    bloomPass.threshold = Number(thresholdInput.value);
    updateReadouts();
  });

  button.addEventListener('click', () => {
    const isOpen = panel.classList.toggle('is-open');
    button.classList.toggle('is-open', isOpen);
    button.setAttribute('aria-expanded', String(isOpen));
  });
}
