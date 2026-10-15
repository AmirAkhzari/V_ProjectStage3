import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/platform/db/schema.ts', './src/modules/*/infra/db/schema.ts'],
  out: './db/migrations',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://vproject:vproject@127.0.0.1:5432/vproject',
  },
});
