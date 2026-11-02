import { defineConfig } from 'vite';

// `npm run dev` opens the game in Firefox, the only supported browser (ADR-0003).
process.env.BROWSER ??= 'firefox';

export default defineConfig({
  build: {
    target: 'es2023',
    // Three.js alone is about 600 kB minified. The game is one desktop page with nothing to
    // gain from splitting it, so the limit sits just above the bundle; revisit if it grows past it.
    chunkSizeWarningLimit: 1000,
  },
});
