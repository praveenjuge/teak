import { afterEach, beforeEach, mock } from "bun:test";
import { getFunctionAddress, getFunctionName } from "convex/server";

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
  db?: any;
  runQuery?: (...args: any[]) => any;
  [member: string]: unknown;
}
interface Mapping {
  deletedAt?: number;
  role?: "admin";
}

const workosUserIdFor = (teakUserId: string) =>
  `user_${Buffer.from(teakUserId).toString("hex")}`;
const teakUserIdFor = (workosUserId: string) =>
  Buffer.from(workosUserId.replace(/^user_/, ""), "hex").toString();

const ownerRow = (teakUserId: string, mapping: Mapping, email?: string) => ({
  _id: `users_${teakUserId}`,
  teakUserId,
  email: email ?? `${teakUserId}@example.com`,
  emailVerified: true,
  workosUserId: workosUserIdFor(teakUserId),
  ...mapping,
});

const identityRows = (
  table: string,
  filters: Record<string, unknown>,
  mapping: Mapping,
  email?: string
): unknown[] => {
  if (table !== "users") {
    return [];
  }
  let teakUserId: string | undefined;
  if (typeof filters.teakUserId === "string") {
    teakUserId = filters.teakUserId;
  } else if (typeof filters.workosUserId === "string") {
    teakUserId = teakUserIdFor(filters.workosUserId);
  }
  return teakUserId ? [ownerRow(teakUserId, mapping, email)] : [];
};

const IDENTITY_TABLES = new Set([
  "users",
  "migrationQuarantine",
  "accountDeletionStates",
]);

function withIdentityDb(db: any, mapping: Mapping, email?: () => string) {
  const original = db.query?.bind(db);
  return {
    ...db,
    query: mock((table: string) => {
      if (IDENTITY_TABLES.has(table)) {
        return identityQuery(table, mapping, email);
      }
      return original ? original(table) : identityQuery("", mapping, email);
    }),
  };
}

function identityQuery(table: string, mapping: Mapping, email?: () => string) {
  return {
    withIndex: (_index: string, build: (q: any) => any) => {
      const filters: Record<string, unknown> = {};
      const q = {
        eq: (field: string, value: unknown) => {
          filters[field] = value;
          return q;
        },
        gte: () => q,
        lte: () => q,
      };
      build(q);
      const rows = () => identityRows(table, filters, mapping, email?.());
      return {
        first: async () => rows()[0] ?? null,
        unique: async () => rows()[0] ?? null,
        take: async (n: number) => rows().slice(0, n),
        collect: async () => rows(),
      };
    },
  };
}

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
    const address = getFunctionAddress(ref) as { reference?: string };
    if (
      address.reference?.endsWith("/workOSAuthKit/lib/getAuthUser") &&
      typeof args?.id === "string"
    ) {
      const teakUserId = teakUserIdFor(args.id);
      return {
        handled: true,
        value: {
          id: args.id,
          email: email ?? `${teakUserId}@example.com`,
          emailVerified: true,
        },
      };
    }
    return { handled: false };
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
  if (
    name === "workosIdentity:resolveStoredWorkosOwner" &&
    typeof args?.teakUserId === "string"
  ) {
    return {
      handled: true,
      value:
        mapping.deletedAt === undefined
          ? { status: "ok", teakUserId: args.teakUserId }
          : { status: "denied", reason: "deleted_user" },
    };
  }
  if (name === "workosIdentity:resolveWorkosOwner") {
    return {
      handled: true,
      value:
        mapping.deletedAt === undefined &&
        typeof args?.workosUserId === "string"
          ? { status: "ok", teakUserId: teakUserIdFor(args.workosUserId) }
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
        }
      : null;
  };
  const sourceRunQuery = ctx.runQuery;
  const runQuery = mock(async (ref: any, args: any) => {
    const user = await auth.getUserIdentity();
    const answer = answerIdentityQuery(ref, args, mapping, user?.email);
    return answer.handled ? answer.value : sourceRunQuery?.(ref, args);
  });
  let email: string | undefined;
  const runQueryWithEmail = mock(async (ref: any, args: any) => {
    email = (await auth.getUserIdentity())?.email;
    return runQuery(ref, args);
  });
  return {
    ...ctx,
    auth: {
      ...auth,
      getUserIdentity: async () => {
        const user = await identity();
        email = user?.email as string | undefined;
        return user;
      },
    },
    ...(ctx.db
      ? { db: withIdentityDb(ctx.db, mapping, () => email as string) }
      : {}),
    runQuery: runQueryWithEmail,
  };
}

export function withMappedOwner<T extends TestContext>(ctx: T): T {
  const sourceRunQuery = ctx.runQuery;
  return {
    ...ctx,
    ...(ctx.db ? { db: withIdentityDb(ctx.db, {}) } : {}),
    runQuery: mock(async (ref: any, args: any) => {
      const answer = answerIdentityQuery(ref, args, {});
      return answer.handled ? answer.value : await sourceRunQuery?.(ref, args);
    }),
  };
}

export const withSearchSyncDb = <Db extends object>(db: Db) => ({
  get: mock().mockResolvedValue(null),
  query: mock().mockReturnValue({
    withIndex: mock().mockReturnValue({
      take: mock().mockResolvedValue([]),
      unique: mock().mockResolvedValue(null),
    }),
  }),
  insert: mock().mockResolvedValue("sync_1"),
  patch: mock().mockResolvedValue(null),
  replace: mock().mockResolvedValue(null),
  delete: mock().mockResolvedValue(null),
  ...db,
});
