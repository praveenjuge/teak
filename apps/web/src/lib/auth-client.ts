/**
 * Better Auth Client Configuration
 * This creates the auth client for the React frontend.
 */

import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: import.meta.env.PROD ? '' : 'http://localhost:3001',
  fetchOptions: {
    onError(context) {
      // Log errors for debugging
      console.error('Auth error:', context.error);
    },
  },
});

// Export specific methods for easier imports
export const {
  signIn,
  signUp,
  signOut,
  useSession,
  getSession,
  resetPassword,
  requestPasswordReset,
} = authClient;
