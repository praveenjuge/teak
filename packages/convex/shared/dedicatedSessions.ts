import { components } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";

// 30 days, matching `session.expiresIn` in auth.ts.
const SESSION_TTL_MS = 60 * 60 * 24 * 30 * 1000;
const SESSION_TOKEN_LENGTH = 32;
const SESSION_TOKEN_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export interface DedicatedSession {
  expiresAt: number;
  sessionToken: string;
}

export interface MintDedicatedSessionArgs {
  userAgent: string;
  userId: string;
}

/**
 * Generate a 32 random alphanumeric char token, matching Better Auth's own
 * session-token shape so the value works unchanged against the existing Convex
 * JWT exchange (`/api/auth/convex/token`) and `/api/auth/get-session`.
 */
export const generateSessionToken = (): string => {
  const bytes = new Uint8Array(SESSION_TOKEN_LENGTH);
  crypto.getRandomValues(bytes);
  let token = "";
  for (let index = 0; index < SESSION_TOKEN_LENGTH; index += 1) {
    token +=
      SESSION_TOKEN_ALPHABET[bytes[index] % SESSION_TOKEN_ALPHABET.length];
  }
  return token;
};

/**
 * Mint a dedicated Better Auth session directly via the component adapter.
 *
 * Each native surface (desktop, Safari, browser extension) gets its own
 * long-lived, independently revocable session rather than piggybacking on the
 * web browser session that authorized the device. `userAgent` is a
 * human-readable per-surface label so sessions are distinguishable in the
 * dashboard and future session-management UIs.
 */
export const mintDedicatedSession = async (
  ctx: MutationCtx,
  { userId, userAgent }: MintDedicatedSessionArgs
): Promise<DedicatedSession> => {
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  const sessionToken = generateSessionToken();

  await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: "session",
      data: {
        createdAt: now,
        expiresAt,
        token: sessionToken,
        updatedAt: now,
        userAgent,
        userId,
      },
    },
  });

  return { expiresAt, sessionToken };
};
