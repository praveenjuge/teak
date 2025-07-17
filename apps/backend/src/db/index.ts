import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import {
  accounts,
  cards,
  cardType,
  sessions,
  users,
  verifications,
} from './schema';

// Create PostgreSQL connection pool
const buildConnectionString = () => {
  const user = process.env.POSTGRES_USER || 'teak_user';
  const password = process.env.POSTGRES_PASSWORD || 'teak_dev_password';
  const database = process.env.POSTGRES_DB || 'teak_db';

  return `postgresql://${user}:${password}@db:5432/${database}`;
};

export const pool = new Pool({
  connectionString: buildConnectionString(),
});

// Create Drizzle database instance
const schema = { users, sessions, accounts, verifications, cards, cardType };
export const db = drizzle({ client: pool, schema });

// Export the schema for use in other parts of the application
export * from './schema';
