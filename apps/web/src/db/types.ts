// Database schema imports for Drizzle operations
import type {
  accounts,
  sessions,
  users,
  verifications,
} from '../../../backend/src/db/schema';

// Database entity types inferred from Drizzle schema
export type DrizzleUser = typeof users.$inferSelect;
export type NewDrizzleUser = typeof users.$inferInsert;
export type DrizzleSession = typeof sessions.$inferSelect;
export type NewDrizzleSession = typeof sessions.$inferInsert;
export type DrizzleAccount = typeof accounts.$inferSelect;
export type NewDrizzleAccount = typeof accounts.$inferInsert;
export type DrizzleVerification = typeof verifications.$inferSelect;
export type NewDrizzleVerification = typeof verifications.$inferInsert;

// Re-export shared types - everything else is now in shared-types
export * from '@teak/shared-types';

// Response types specific to user endpoints
import type { ApiResponse, User } from '@teak/shared-types';

export interface UserResponse extends ApiResponse<{ users: User[] }> {}
export interface SingleUserResponse extends ApiResponse<{ user: User }> {}
