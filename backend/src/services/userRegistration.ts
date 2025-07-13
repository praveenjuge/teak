import { count } from 'drizzle-orm';
import { db, users } from '../db';

/**
 * Check if multi-user registration is allowed
 */
export function isMultiUserRegistrationAllowed(): boolean {
  const allowMultiUser = process.env['ALLOW_MULTI_USER_REGISTRATION'];
  return allowMultiUser === 'true';
}

/**
 * Get the total count of users in the system
 */
export async function getUserCount(): Promise<number> {
  try {
    const result = await db.select({ count: count() }).from(users);
    return result[0]?.count || 0;
  } catch (error) {
    console.error('Error counting users:', error);
    throw new Error('Failed to count users');
  }
}

/**
 * Validate if a new user registration should be allowed
 * @returns true if registration is allowed, false otherwise
 * @throws Error with appropriate message if registration is not allowed
 */
export async function validateUserRegistration(): Promise<void> {
  const isMultiUserAllowed = isMultiUserRegistrationAllowed();

  // If multi-user registration is allowed, no validation needed
  if (isMultiUserAllowed) {
    return;
  }

  // Check if any users already exist
  const userCount = await getUserCount();

  if (userCount > 0) {
    throw new Error(
      'Registration is currently closed. Please refer to the documentation on how to enable multi-user registration.'
    );
  }
}
