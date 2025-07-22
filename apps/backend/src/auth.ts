/**
 * Better Auth Configuration
 *
 * TODO: Add email service integration
 */

import { expo } from '@better-auth/expo';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { db } from './db';
import {
  accounts as accountSchema,
  sessions as sessionSchema,
  users as userSchema,
  verifications as verificationSchema,
} from './db/schema';
import { validateUserRegistration } from './services/user-registration';

export const auth = betterAuth({
  plugins: [expo()],
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: userSchema,
      session: sessionSchema,
      account: accountSchema,
      verification: verificationSchema,
    },
  }),
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3001',
  secret: process.env.BETTER_AUTH_SECRET || 'fallback-secret-for-dev',

  // Enable email and password authentication
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Set to true if you want to require email verification
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/sign-up/email') {
        try {
          // Validate user registration before proceeding
          await validateUserRegistration();
        } catch (error) {
          throw new APIError('BAD_REQUEST', {
            message:
              error instanceof Error
                ? error.message
                : 'Registration not allowed',
          });
        }
      }
    }),
  },

  // Email verification configuration (for when you add email service)
  emailVerification: {
    sendOnSignUp: false, // Don't send verification emails on signup for now
  },

  // Configure trusted origins
  trustedOrigins: [
    'http://localhost:3000', // Frontend
    'http://localhost:3001', // Backend
    'teak://', // Mobile app scheme
    'chrome-extension://jeeggjljhpafpnnolmhkpdhaccjodebb', // Chrome extension
  ],

  // Advanced security settings
  advanced: {
    useSecureCookies: process.env.NODE_ENV === 'production',
    crossSubDomainCookies: {
      enabled: false, // Change to true if you need cross-subdomain cookies
    },
  },
});
