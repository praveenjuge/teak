/**
 * Better Auth Client Configuration
 * 
 * This creates the auth client for the React frontend.
 * It connects to the Better Auth backend running on port 3001.
 */

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_AUTH_URL || (import.meta.env.PROD ? "" : "http://localhost:3001"), // Backend URL
  fetchOptions: {
    onError(context) {
      // Log errors for debugging
      console.error("Auth error:", context.error);
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
