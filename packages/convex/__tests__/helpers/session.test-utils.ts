import { mock } from "bun:test";

interface Identity {
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
export function withTestSession<T extends TestContext>(ctx: T): T {
  const auth = ctx.auth;
  if (!auth) {
    return ctx;
  }
  const identity = async () => {
    const user = await auth.getUserIdentity();
    return user
      ? { ...user, sessionId: user.sessionId ?? "test-session" }
      : null;
  };
  const sourceRunQuery = ctx.runQuery;
  const runQuery = mock(async (...args: any[]) => {
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
