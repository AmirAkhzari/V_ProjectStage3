import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import boundaries from 'eslint-plugin-boundaries';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'db/migrations/meta/**',
      'openapi/**',
      'tests/boundaries/fixtures/**',
      'scripts/**',
      '.dependency-cruiser.cjs',
      'eslint.config.js',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  prettier,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'import/resolver': {
        typescript: { alwaysTryTypes: true, project: './tsconfig.json' },
      },
      'boundaries/include': ['src/**/*'],
      'boundaries/elements': [
        { type: 'platform', pattern: 'src/platform', partialMatch: false },
        { type: 'http', pattern: 'src/http', partialMatch: false },
        { type: 'module', pattern: 'src/modules/*', partialMatch: false, capture: ['module'] },
      ],
      'boundaries/files': [
        { pattern: 'src/app.ts', category: 'bootstrap' },
        { pattern: 'src/main.ts', category: 'bootstrap' },
        { pattern: 'src/worker.ts', category: 'bootstrap' },
        { pattern: 'src/modules/register.ts', category: 'module-register' },
        { pattern: 'src/modules/*/api.ts', category: 'module-public' },
        { pattern: 'src/modules/*/events.ts', category: 'module-public' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          message:
            '{{from.element.types.[0]}} is not allowed to depend on {{to.element.types.[0]}} {{to.module.source}}',
          policies: [
            { allow: { to: { module: { origin: 'core' } } } },
            { allow: { to: { module: { origin: 'external' } } } },
            {
              from: { element: { type: 'platform' } },
              allow: { to: { element: { type: 'platform' } } },
            },
            {
              from: { element: { type: 'http' } },
              allow: { to: { element: { type: ['http', 'platform'] } } },
            },
            {
              from: { file: { categories: 'bootstrap' } },
              allow: {
                to: [
                  { element: { type: ['http', 'platform', 'module'] } },
                  { file: { categories: ['bootstrap', 'module-register', 'module-public'] } },
                ],
              },
            },
            {
              from: { file: { categories: 'module-register' } },
              allow: { to: { element: { type: ['module', 'platform'] } } },
            },
            {
              from: { element: { type: 'module' } },
              allow: { dependency: { relationship: { to: 'internal' } } },
            },
            {
              from: { element: { type: 'module' } },
              allow: { to: { file: { categories: 'module-public' } } },
            },
            {
              from: { element: { type: 'module' } },
              allow: { to: { element: { type: 'platform' } } },
            },
            {
              from: { file: { categories: 'bootstrap' } },
              disallow: {
                to: { file: { path: ['**/infra/mock/**', '**/providers/mock.ts'] } },
              },
            },
            {
              from: { file: { path: '**/domain/**' } },
              disallow: {
                to: {
                  module: {
                    origin: 'external',
                    source: ['fastify', 'drizzle-orm', 'ioredis', 'pg', '@fastify/swagger'],
                  },
                },
              },
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/modules/identity/**',
      'src/main.ts',
      'src/platform/config.ts',
      'src/platform/config.test.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Identifier[name='DATABASE_URL_IDENTITY']",
          message:
            'only identity code and the composition root may use DATABASE_URL_IDENTITY (AppSec 7-6)',
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/platform/db/tenant.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value='app.is_platform']",
          message:
            "is_platform may only be named in tenant.ts; login uses lookup_driver_login, not set_config('app.is_platform') (AppSec 7-7)",
        },
      ],
    },
  },
);
