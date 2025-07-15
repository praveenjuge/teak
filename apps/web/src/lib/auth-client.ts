/**
 * Better Auth Client Configuration
 *
 * This creates the auth client for the React frontend.
 * It connects to the Better Auth backend running on port 3001.
 */

import { createAuthClient } from 'better-auth/react';

// Determine the auth base URL based on environment
const getAuthBaseURL = () => {
  // In production, use relative URL (same origin)
  if (import.meta.env.PROD) {
    return '';
  }
  
  // In development, check for custom API URL or default to localhost
  return import.meta.env.VITE_API_URL || 'http://localhost:3001';
};

export const authClient = createAuthClient({
  baseURL: getAuthBaseURL(),
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
