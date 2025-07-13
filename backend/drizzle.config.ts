import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url:
      process.env['DATABASE_URL'] ||
      'postgresql://teak_user:teak_dev_password@localhost:5432/teak_db',
  },
});
