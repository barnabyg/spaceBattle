import { defineConfig } from 'vitest/config';

// The battle batches fight hours of battle per test. They are a project of their own so CI can
// run them on one runner and every other test on another, splitting the work about evenly.
const BATCHES = 'src/**/*Batch*.test.ts';

export default defineConfig({
  test: {
    environment: 'node',
    // Ordinary tests finish in well under 5 s; allow host contention without retries.
    // Longer simulation tests retain their explicit, more generous limits.
    testTimeout: 15_000,
    // Stop at the first failure in CI only; local runs report every failure.
    bail: process.env.CI ? 1 : 0,
    projects: [
      { extends: true, test: { name: 'batches', include: [BATCHES] } },
      { extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'], exclude: [BATCHES] } },
    ],
  },
});
