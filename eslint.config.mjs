// @ts-check

import eslintConfigPrettier from 'eslint-config-prettier/flat';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/dist/',
    // Angular's build cache
    'frontend/.angular/',
    // Kept out of the build on purpose
    '**/*.exclude.*',
  ]),
  {
    files: ['**/*.{js,cjs,mjs,ts,cts,mts}'],
    extends: [tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      // Parameters a method has to take, but does not use, start with _
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
  // Formatting is left to Prettier, this turns off the rules that would
  // conflict with it
  eslintConfigPrettier,
);
