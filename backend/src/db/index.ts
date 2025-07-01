import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Create PostgreSQL connection pool
export const pool = new Pool({
  connectionString: process.env['DATABASE_URL'] || 'postgresql://teak_user:teak_dev_password@localhost:5432/teak_dev',
});

// Create Drizzle database instance
export const db = drizzle({ client: pool, schema });

// Export the schema for use in other parts of the application
export * from './schema';
