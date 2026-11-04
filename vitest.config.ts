import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Ordinary tests finish in well under 5 s; allow host contention without retries.
    // Longer simulation tests retain their explicit, more generous limits.
    testTimeout: 15_000,
    // Stop at the first failure in CI only; local runs report every failure.
    bail: process.env.CI ? 1 : 0,
  },
});
