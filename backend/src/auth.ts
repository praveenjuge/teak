/**
 * Better Auth Configuration
 * 
 * Current setup:
 * - Email/password authentication enabled
 * - Email verification disabled (no email service configured)
 * - Password reset emails logged to console (for development)
 * - Using Drizzle ORM adapter for database operations
 * 
 * TODO: Add email service integration
 * - Resend (resend.com)
 * - SendGrid
 * - AWS SES
 * - Nodemailer with SMTP
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { expo } from "@better-auth/expo";
import { db } from "./db";
import * as schema from "./db/schema";

export const auth = betterAuth({
  plugins: [expo()],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  baseURL: process.env["BETTER_AUTH_URL"] || "http://localhost:3001",
  secret: process.env["BETTER_AUTH_SECRET"] || "fallback-secret-for-dev",

  // Enable email and password authentication
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Set to true if you want to require email verification
    minPasswordLength: 8,
    maxPasswordLength: 128,
    sendResetPassword: async ({ user, url, token }) => {
      // TODO: Replace with actual email service when available
      console.log('📧 Password reset email would be sent to:', user.email);
      console.log('🔗 Reset URL:', url);
      console.log('🎫 Reset token:', token);
      console.log('Note: Configure email service to actually send emails');
    },
  },

  // Email verification configuration (for when you add email service)
  emailVerification: {
    sendVerificationEmail: async ({ user, url, token }) => {
      // TODO: Replace with actual email service when available
      console.log('📧 Verification email would be sent to:', user.email);
      console.log('🔗 Verification URL:', url);
      console.log('🎫 Verification token:', token);
      console.log('Note: Configure email service to actually send emails');
    },
    sendOnSignUp: false, // Don't send verification emails on signup for now
  },

  // Configure trusted origins
  trustedOrigins: [
    "http://localhost:3000", // Frontend
    "http://localhost:3001", // Backend
    "teak://", // Mobile app scheme
  ],

  // Advanced security settings
  advanced: {
    useSecureCookies: process.env["NODE_ENV"] === "production",
    crossSubDomainCookies: {
      enabled: false, // Change to true if you need cross-subdomain cookies
    },
  },
});
