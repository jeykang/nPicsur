import { defineConfig } from 'vitest/config';

// Unit tests, these run against the TypeScript sources directly
export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
  },
});
