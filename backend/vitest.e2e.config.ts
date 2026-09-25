import { defineConfig } from 'vitest/config';

// End-to-end tests: boot the compiled backend against a throwaway database and
// talk to it over HTTP. Build the backend (pnpm build) before running these.
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.test.ts'],
    globalSetup: ['test/e2e/global-setup.ts'],
    // All test files share one server, run them one at a time so tests that
    // change global settings do not interfere with each other
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
