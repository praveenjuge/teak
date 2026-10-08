import { afterEach, beforeEach, mock } from "bun:test";
import { getFunctionName } from "convex/server";

const TEST_CLIENT_ID = "client_sessiontests";
const originalClientId = process.env.WORKOS_CLIENT_ID;
beforeEach(() => {
  process.env.WORKOS_CLIENT_ID ??= TEST_CLIENT_ID;
});
afterEach(() => {
  if (originalClientId === undefined) {
    delete process.env.WORKOS_CLIENT_ID;
  } else {
    process.env.WORKOS_CLIENT_ID = originalClientId;
  }
});

interface Identity {
  email?: string;
  subject: string;
}
interface TestContext {
  auth?: { getUserIdentity: () => Promise<Identity | null> };
  runQuery?: (...args: any[]) => any;
}
interface Mapping {
  deletedAt?: number;
  role?: "admin";
}

const workosUserIdFor = (teakUserId: string) =>
  `user_${Buffer.from(teakUserId).toString("hex")}`;

// The WorkOS owner resolver and profile read, answered from a mapping fixture
// keyed by the permanent Teak user id. Deletion denies the owner.
export const answerIdentityQuery = (
  ref: any,
  args: any,
  mapping: Mapping,
  email?: string
): { handled: true; value: unknown } | { handled: false } => {
  let name: string;
  try {
    name = getFunctionName(ref);
  } catch {
    // Component references (e.g. the API key component) are not identity reads.
    return { handled: false };
  }
  if (
    name === "accountDeletion:isDeleting" &&
    typeof args?.userId === "string"
  ) {
    return { handled: true, value: false };
  }
  if (
    name === "securitySessions:identityMapping" &&
    typeof args?.teakUserId === "string"
  ) {
    return {
      handled: true,
      value: {
        teakUserId: args.teakUserId,
        email: email ?? "",
        emailVerified: true,
        workosUserId: workosUserIdFor(args.teakUserId),
        ...mapping,
      },
    };
  }
  if (name === "workosIdentity:resolveWorkosOwner") {
    return {
      handled: true,
      value:
        mapping.deletedAt === undefined && typeof args?.externalId === "string"
          ? { status: "ok", teakUserId: args.externalId }
          : { status: "denied", reason: "deleted_user" },
    };
  }
  if (name === "workosProfileRead:getProfile") {
    const teakUserId = Buffer.from(
      String(args?.workosUserId ?? "").replace(/^user_/, ""),
      "hex"
    ).toString();
    return {
      handled: true,
      value: {
        email: email ?? `${teakUserId}@example.com`,
        emailVerified: true,
        name: null,
        profilePictureUrl: null,
      },
    };
  }
  return { handled: false };
};

// Business-logic unit tests supply an authenticated identity. This turns it
// into a verified AuthKit session whose external id is the test's permanent
// Teak user id. Forged and revoked sessions are covered against the real
// resolver in the edge tests, without this fixture.
export function withTestSession<T extends TestContext>(
  ctx: T,
  mapping: Mapping = {}
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
          issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
          subject: workosUserIdFor(user.subject),
          sid: "session_test",
          email_verified: true,
          external_id: user.subject,
        }
      : null;
  };
  const sourceRunQuery = ctx.runQuery;
  const runQuery = mock(async (ref: any, args: any) => {
    const user = await auth.getUserIdentity();
    const answer = answerIdentityQuery(ref, args, mapping, user?.email);
    return answer.handled ? answer.value : sourceRunQuery?.(ref, args);
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
      const answer = answerIdentityQuery(ref, args, {});
      return answer.handled ? answer.value : await sourceRunQuery?.(ref, args);
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
