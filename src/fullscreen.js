export function initFullscreenToggle(button) {
  const syncState = () => {
    const isFullscreen = Boolean(document.fullscreenElement);
    button.classList.toggle('is-fullscreen', isFullscreen);
  };

  button.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => {
        // Request can be rejected (no user gesture, unsupported browser, etc).
        // Fail silently — the button just won't visually toggle.
      });
    }
  });

  document.addEventListener('fullscreenchange', syncState);
  syncState();
}
