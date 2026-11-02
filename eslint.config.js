import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// The simulation core and the battle runner must stay headless (ADR-0001):
// no rendering library, no UI code and no browser globals.
const headlessRestrictions = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['three', 'three/*'],
          message: 'The simulation core must not import rendering code.',
        },
        { group: ['**/ui/**', '**/ui'], message: 'The simulation core must not import UI code.' },
      ],
    },
  ],
  'no-restricted-globals': [
    'error',
    ...[
      'window',
      'document',
      'navigator',
      'requestAnimationFrame',
      'performance',
      'localStorage',
    ].map((name) => ({ name, message: 'The simulation core must not use browser globals.' })),
  ],
};

export default defineConfig(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', '.claude'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['src/ui/**', 'src/main.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['*.ts', '*.js', 'e2e/**'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/sim/**', 'src/game/**'],
    rules: headlessRestrictions,
  },
);
