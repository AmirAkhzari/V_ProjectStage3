import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'src/**/*.test.ts',
            'tests/unit/**/*.test.ts',
            'tests/boundaries/**/*.test.ts',
            'tests/contract/**/*.test.ts',
            'tests/outbox/**/*.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts', 'tests/rls/**/*.test.ts'],
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
