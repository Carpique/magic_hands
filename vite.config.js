import { defineConfig } from 'vite';

// Deployed to GitHub Pages at https://carpique.github.io/magic_hands/, so assets
// must be served from that subpath. Locally `npm run dev` ignores `base`.
export default defineConfig({
  base: '/magic_hands/',
});
