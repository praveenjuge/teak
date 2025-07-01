// Consolidated type definitions - single source of truth
export * from '../../../../backend/src/db/schema';

import { users, sessions, accounts, verifications } from '../../../../backend/src/db/schema';

// Database entity types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;

// API response types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface UserResponse extends ApiResponse<{ users: User[] }> { }
export interface SingleUserResponse extends ApiResponse<{ user: User }> { }

// Auth form types
export interface AuthFormData {
  email: string;
  password: string;
  confirmPassword?: string;
  name?: string;
}

// Common UI state types
export interface AsyncState {
  isLoading: boolean;
  error: string;
  success: boolean;
}
