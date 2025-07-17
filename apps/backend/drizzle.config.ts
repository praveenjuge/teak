import { defineConfig } from 'drizzle-kit';

const buildConnectionString = () => {
  const user = process.env.POSTGRES_USER || 'teak_user';
  const password = process.env.POSTGRES_PASSWORD || 'teak_dev_password';
  const database = process.env.POSTGRES_DB || 'teak_db';

  return `postgresql://${user}:${password}@db:5432/${database}`;
};

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: buildConnectionString(),
  },
});
