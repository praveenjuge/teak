import { afterEach, beforeEach, mock } from "bun:test";
import { getFunctionName } from "convex/server";

const originalConvexSiteUrl = process.env.CONVEX_SITE_URL;
beforeEach(() => {
  process.env.CONVEX_SITE_URL ??= "https://session-tests.convex.site";
});
afterEach(() => {
  if (originalConvexSiteUrl === undefined) {
    delete process.env.CONVEX_SITE_URL;
  } else {
    process.env.CONVEX_SITE_URL = originalConvexSiteUrl;
  }
});

interface Identity {
  issuer?: string;
  sessionId?: string;
  subject: string;
}
interface TestContext {
  auth?: { getUserIdentity: () => Promise<Identity | null> };
  runQuery?: (...args: any[]) => any;
}

// Business-logic unit tests supply an authenticated identity and its matching
// live session. Revoked, expired, and forged sessions are covered with the real
// Better Auth component in securitySessions.test.ts, without this fixture.
export function withTestSession<T extends TestContext>(
  ctx: T,
  mapping: { role?: "admin"; deletedAt?: number } = {}
): T {
  const auth = ctx.auth;
  if (!auth) {
    return ctx;
  }
  const identity = async () => {
    const user = await auth.getUserIdentity();
    return user
      ? {
          ...user,
          issuer: user.issuer ?? process.env.CONVEX_SITE_URL,
          sessionId: user.sessionId ?? "test-session",
        }
      : null;
  };
  const sourceRunQuery = ctx.runQuery;
  const runQuery = mock(async (...args: any[]) => {
    // Deletion admission is covered with the real database in workflow tests.
    if (
      typeof args[1]?.userId === "string" &&
      getFunctionName(args[0]) === "accountDeletion:isDeleting"
    ) {
      return false;
    }
    if (
      typeof args[1]?.teakUserId === "string" &&
      getFunctionName(args[0]) === "securitySessions:identityMapping"
    ) {
      const user = await identity();
      return user
        ? { teakUserId: user.subject, emailVerified: false, ...mapping }
        : null;
    }
    const queryArgs = args[1] as { model?: string } | undefined;
    if (queryArgs?.model === "session") {
      const originalUser = await auth.getUserIdentity();
      if (originalUser?.sessionId && sourceRunQuery) {
        return sourceRunQuery(...args);
      }
      const user = await identity();
      return user
        ? {
            _id: user.sessionId,
            userId: user.subject,
            createdAt: Date.now(),
            expiresAt: Date.now() + 60_000,
          }
        : null;
    }
    return sourceRunQuery?.(...args);
  });
  return {
    ...ctx,
    auth: { ...auth, getUserIdentity: identity },
    runQuery,
  };
}

// A persisted mapping fixture for bearer and internal-job business-logic tests.
// Missing/tombstoned mappings are exercised against the database in edge tests.
export function withMappedOwner<
  T extends { runQuery?: (...args: any[]) => any },
>(ctx: T): T {
  const sourceRunQuery = ctx.runQuery;
  return {
    ...ctx,
    runQuery: mock(async (ref: any, args: any) => {
      if (
        typeof args?.userId === "string" &&
        getFunctionName(ref) === "accountDeletion:isDeleting"
      ) {
        return false;
      }
      if (
        typeof args?.teakUserId === "string" &&
        getFunctionName(ref) === "securitySessions:identityMapping"
      ) {
        return { teakUserId: args.teakUserId, emailVerified: false };
      }
      return await sourceRunQuery?.(ref, args);
    }),
  };
}

// Minimal db surface for the inline card search sync in mocked mutation
// contexts. Spread FIRST in a db literal so the test's own mocks override
// these defaults.
export const inlineSearchSyncDb = () => ({
  get: mock().mockResolvedValue(null),
  query: mock().mockReturnValue({
    withIndex: mock().mockReturnValue({
      unique: mock().mockResolvedValue(null),
    }),
  }),
  insert: mock().mockResolvedValue("sync_1"),
  patch: mock().mockResolvedValue(null),
  replace: mock().mockResolvedValue(null),
  delete: mock().mockResolvedValue(null),
});
