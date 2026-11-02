import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Stop at the first failure in CI only; local runs report every failure.
    bail: process.env.CI ? 1 : 0,
  },
});
