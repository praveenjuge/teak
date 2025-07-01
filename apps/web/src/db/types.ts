// Import schema and types from the backend (single source of truth)
// This ensures type safety without duplicating schema definitions

// Re-export the schema from backend
export * from '../../../../backend/src/db/schema';

// Create properly typed interfaces from the schema
import { users, sessions, accounts, verifications } from '../../../../backend/src/db/schema';

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;
