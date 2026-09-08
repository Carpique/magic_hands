export function initFullscreenToggle(button) {
  // iPhone Safari has no Fullscreen API for regular elements -- the request just
  // rejects. When it's missing we still toggle the green "active" tint so the
  // tap gives feedback, but we leave the icon alone.
  const supported = typeof document.documentElement.requestFullscreen === 'function';

  const syncState = () => {
    const isFullscreen = Boolean(document.fullscreenElement);
    button.classList.toggle('is-fullscreen', isFullscreen); // swaps expand/compress icon
    if (supported) button.classList.toggle('is-active', isFullscreen);
  };

  button.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (supported) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      button.classList.toggle('is-active');
    }
    button.blur();
  });

  document.addEventListener('fullscreenchange', syncState);
  syncState();
}
