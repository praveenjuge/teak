import { createAuthMiddleware } from "@better-auth/core/api";
import type { BetterAuthPlugin } from "better-auth";
import type { MutationCtx } from "./_generated/server";
import { classifyBetterAuthSignIn } from "./authMonitoring";
import { isE2EEmail, normalizeE2EEmailDomain } from "./e2eAccounts";
import { scheduleAuthOutcome } from "./telemetry/schedule";

const SIGN_IN_PATHS = new Set([
  "/sign-in/email",
  "/sign-in/social",
  "/callback/:id",
]);

const isSynthetic = (
  email: unknown,
  e2eEmailDomain: string | undefined
): boolean | undefined => {
  if (typeof email !== "string" || !e2eEmailDomain) {
    return;
  }
  try {
    return isE2EEmail(email, normalizeE2EEmailDomain(e2eEmailDomain));
  } catch {
    // An invalid automation domain leaves the attempt unclassified.
    return undefined;
  }
};

/**
 * Records one `teak.auth.sign_in` outcome per Better Auth sign-in attempt,
 * tagged with `auth.method` so it never mixes with the broader `onAPIError`
 * failures. Only the method, provider, a normalized reason and whether the
 * account is an E2E fixture leave this hook; the email is read only to make
 * that decision.
 */
export const authSignInMonitoring = (
  ctx: object,
  e2eEmailDomain: string | undefined
): BetterAuthPlugin => ({
  id: "teak-auth-sign-in-monitoring",
  hooks: {
    after: [
      {
        matcher: (context) => SIGN_IN_PATHS.has(context.path ?? ""),
        handler: createAuthMiddleware(async (context) => {
          try {
            if (!("scheduler" in ctx)) {
              return;
            }
            const body = context.body as
              | { email?: unknown; provider?: unknown }
              | undefined;
            const newSession = context.context.newSession;
            const attempt = classifyBetterAuthSignIn({
              newSession,
              path: context.path,
              providerId: context.params?.id ?? body?.provider,
              returned: context.context.returned,
            });
            if (!attempt) {
              return;
            }
            const synthetic = isSynthetic(
              newSession?.user.email ?? body?.email,
              e2eEmailDomain
            );
            await scheduleAuthOutcome(ctx as Pick<MutationCtx, "scheduler">, {
              method: attempt.method,
              outcome: attempt.outcome,
              reason: attempt.reason,
              stage: "sign_in",
              ...(attempt.provider ? { provider: attempt.provider } : {}),
              ...(synthetic === undefined ? {} : { synthetic }),
            });
          } catch {
            // Monitoring must never alter sign-in.
          }
        }),
      },
    ],
  },
});
