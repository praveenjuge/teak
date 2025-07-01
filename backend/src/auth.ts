/**
 * Better Auth Configuration
 * 
 * Current setup:
 * - Email/password authentication enabled
 * - Email verification disabled (no email service configured)
 * - Password reset emails logged to console (for development)
 * 
 * TODO: Add email service integration
 * Popular options:
 * - Resend (resend.com)
 * - SendGrid
 * - AWS SES
 * - Nodemailer with SMTP
 */

import { betterAuth } from "better-auth";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env["DATABASE_URL"] || "postgresql://teak_user:your_secure_password_here@localhost:5432/teak",
});

export const auth = betterAuth({
  database: pool,
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
  ],

  // Advanced security settings
  advanced: {
    useSecureCookies: process.env["NODE_ENV"] === "production",
    crossSubDomainCookies: {
      enabled: false, // Change to true if you need cross-subdomain cookies
    },
  },
});
