/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const domain = "tests.example.com";
let token: string;

interface FakeUser {
  created_at: string;
  email: string;
  email_verified: boolean;
  id: string;
  metadata: Record<string, string>;
}

// The WorkOS Management API boundary. Provider state lives in `users`.
function workos(users: Map<string, FakeUser>) {
  const writes: { method: string; id: string; body?: unknown }[] = [];
  const shape = (user: FakeUser) => ({
    object: "user",
    external_id: null,
    first_name: null,
    last_name: null,
    profile_picture_url: null,
    updated_at: user.created_at,
    ...user,
  });
  vi.stubGlobal(
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? "GET";
      if (url.pathname === "/user_management/users/user_WITNESS") {
        return Response.json(
          shape({
            id: "user_WITNESS",
            email: "witness@example.com",
            email_verified: true,
            created_at: new Date(0).toISOString(),
            metadata: {},
          })
        );
      }
      const id = /^\/user_management\/users\/([^/]+)$/.exec(url.pathname)?.[1];
      if (id) {
        const user = users.get(id);
        if (!user) {
          return Response.json({ message: "Not found" }, { status: 404 });
        }
        if (method === "PUT") {
          const body = JSON.parse(String(init?.body));
          writes.push({ method, id, body });
          user.metadata = { ...user.metadata, ...body.metadata };
        }
        if (method === "DELETE") {
          writes.push({ method, id });
          users.delete(id);
          return new Response(null, { status: 202 });
        }
        return Response.json(shape(user));
      }
      if (url.pathname === "/user_management/users" && method === "GET") {
        const email = url.searchParams.get("email");
        return Response.json({
          object: "list",
          data: [...users.values()]
            .filter((user) => user.email === email)
            .map(shape),
          list_metadata: {},
        });
      }
      throw new Error(`Unexpected provider request ${method} ${url.pathname}`);
    }
  );
  return writes;
}

beforeEach(() => {
  vi.useFakeTimers();
  token = crypto.randomUUID();
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
  vi.stubEnv("AUTH_PRIMARY", "workos");
  vi.stubEnv("E2E_CLEANUP_TOKEN", token);
  vi.stubEnv("E2E_EMAIL_DOMAIN", domain);
  vi.stubEnv("WORKOS_CLIENT_ID", "client_E2EPROOF");
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", "environment_E2EPROOF");
  vi.stubEnv("WORKOS_API_KEY", "reservation-test-key");
  vi.stubEnv("WORKOS_RECONCILIATION_WITNESS_ID", "user_WITNESS");
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "false");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  workflowTest.register(t);
  const post = async (path: string, body: unknown) => {
    const response = await t.fetch(`/api/auth/internal/e2e/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const reserve = async (requestId = crypto.randomUUID()) => {
    const { status, body } = await post("signup/reserve", { requestId });
    expect(status).toBe(200);
    return body as { reservationId: string; email: string; expiresAt: number };
  };
  const rows = () =>
    t.run((ctx) => ctx.db.query("e2eSignupReservations").collect());
  return { t, post, reserve, rows };
}

const signup = (
  email: string,
  overrides: Partial<FakeUser> = {}
): FakeUser => ({
  id: "user_SIGNUP",
  email,
  email_verified: false,
  created_at: new Date(Date.now() + 1000).toISOString(),
  metadata: {},
  ...overrides,
});

test("a retried reservation returns the same recipient and the live budget caps new ones", async () => {
  workos(new Map());
  const { post, reserve, rows } = setup();
  const requestId = crypto.randomUUID();
  const first = await reserve(requestId);
  expect(first.email).toMatch(/^e2e-signup-[0-9a-f]{32}@tests\.example\.com$/);
  expect(await reserve(requestId)).toEqual(first);
  await reserve();
  await reserve();
  expect(
    await post("signup/reserve", { requestId: crypto.randomUUID() })
  ).toEqual({ status: 429, body: { code: "E2E_RESERVATION_BUDGET" } });
  expect(await rows()).toHaveLength(3);
});

test("a provider user that exists at reservation time keeps the lease uncleared and unadoptable", async () => {
  const users = new Map<string, FakeUser>();
  workos(users);
  const { t, post, rows } = setup();
  const requestId = crypto.randomUUID();
  // Seed the conflicting user from inside the action's provider read.
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const pending = (await rows())[0];
      if (pending && !users.size) {
        users.set("user_SQUAT", signup(pending.email, { id: "user_SQUAT" }));
      }
      return realFetch(input, init);
    }
  );
  expect(await post("signup/reserve", { requestId })).toEqual({
    status: 409,
    body: { code: "E2E_RESERVATION_CONFLICT" },
  });
  const [row] = await rows();
  expect(row).toMatchObject({ state: "pending" });
  expect(row.clearedAt).toBeUndefined();
  const cleanup = await post("cleanup", { emails: [row.email] });
  expect(cleanup.status).toBe(500);
  expect(cleanup.body.deleted).toEqual([]);
  expect(users.get("user_SQUAT")?.metadata).toEqual({});
  expect(
    await t.run((ctx) => ctx.db.get("e2eSignupReservations", row._id))
  ).toMatchObject({ state: "pending" });
});

test("adoption binds before flagging, writes only the reservation keys and qualifies on real readiness", async () => {
  const users = new Map<string, FakeUser>();
  const writes = workos(users);
  const { t, post, reserve, rows } = setup();
  const { reservationId, email } = await reserve();
  users.set("user_SIGNUP", signup(email, { email_verified: true }));
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      teakUserId: "teak_signup",
      identityOrigin: "workos",
      email,
      emailVerified: true,
      workosEmail: email,
      workosEmailVerified: true,
      workosUserId: "user_SIGNUP",
    });
    await ctx.db.insert("workosProfiles", {
      workosUserId: "user_SIGNUP",
      teakUserId: "teak_signup",
      revision: 1,
      source: "event",
      providerUpdatedAt: new Date().toISOString(),
      profile: {
        email,
        emailVerified: true,
        externalId: null,
        firstName: null,
        lastName: null,
        profilePictureUrl: null,
      },
    });
  });
  expect(await post("signup/adopt", { reservationId, email })).toEqual({
    status: 200,
    body: { email },
  });
  expect(writes).toEqual([
    {
      method: "PUT",
      id: "user_SIGNUP",
      body: {
        metadata: { teak_e2e: "v1", teak_e2e_reservation: reservationId },
      },
    },
  ]);
  const [row] = await rows();
  expect(row).toMatchObject({ state: "bound", workosUserId: "user_SIGNUP" });
  expect(row.qualifiedAt).toBeDefined();
  // Repeating adoption is idempotent and writes nothing new.
  expect((await post("signup/adopt", { reservationId, email })).status).toBe(
    200
  );
  expect(writes).toHaveLength(1);
  // The adopted fixture now uses the unchanged flagged owner cleanup path.
  const cleanup = await post("cleanup", { emails: [email] });
  expect(cleanup.status).toBe(202);
  expect(
    await t.run((ctx) => ctx.db.query("accountDeletionStates").unique())
  ).toMatchObject({ userId: "teak_signup", workosUserId: "user_SIGNUP" });
});

test.each([
  ["foreign metadata", { metadata: { plan: "pro" } }],
  ["a flag without this reservation", { metadata: { teak_e2e: "v1" } }],
  [
    "a user created before the provider was seen empty",
    { created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() },
  ],
])(
  "adoption refuses %s without binding or writing",
  async (_name, overrides) => {
    const users = new Map<string, FakeUser>();
    const writes = workos(users);
    const { post, reserve, rows } = setup();
    const { reservationId, email } = await reserve();
    users.set("user_SIGNUP", signup(email, overrides));
    expect((await post("signup/adopt", { reservationId, email })).status).toBe(
      503
    );
    expect(writes).toEqual([]);
    const [row] = await rows();
    expect(row.state).toBe("reserved");
    expect(row.workosUserId).toBeUndefined();
  }
);

test("adoption refuses another reservation's ID and an expired lease", async () => {
  const users = new Map<string, FakeUser>();
  const writes = workos(users);
  const { post, reserve } = setup();
  const first = await reserve();
  const second = await reserve();
  users.set("user_SIGNUP", signup(first.email, { email_verified: true }));
  expect(
    await post("signup/adopt", {
      reservationId: second.reservationId,
      email: first.email,
    })
  ).toEqual({ status: 409, body: { code: "E2E_RESERVATION_UNAVAILABLE" } });
  vi.setSystemTime(first.expiresAt + 1);
  expect(
    await post("signup/adopt", {
      reservationId: first.reservationId,
      email: first.email,
    })
  ).toEqual({ status: 409, body: { code: "E2E_RESERVATION_UNAVAILABLE" } });
  expect(writes).toEqual([]);
});

test("a binding is immutable: a different provider user for the reservation is refused", async () => {
  const users = new Map<string, FakeUser>();
  const writes = workos(users);
  const { post, reserve, rows } = setup();
  const { reservationId, email } = await reserve();
  users.set("user_SIGNUP", signup(email));
  expect((await post("signup/adopt", { reservationId, email })).status).toBe(
    503
  );
  users.clear();
  users.set("user_OTHER", signup(email, { id: "user_OTHER" }));
  expect((await post("signup/adopt", { reservationId, email })).status).toBe(
    503
  );
  expect(writes.map((write) => write.id)).toEqual(["user_SIGNUP"]);
  expect((await rows())[0]).toMatchObject({ workosUserId: "user_SIGNUP" });
});

test("an interrupted unverified signup with no owner is deleted only through its exact binding", async () => {
  const users = new Map<string, FakeUser>();
  const writes = workos(users);
  const { post, reserve, rows } = setup();
  const { email } = await reserve();
  users.set("user_SIGNUP", signup(email));
  const cleanup = await post("cleanup", { emails: [email] });
  expect(cleanup).toMatchObject({ status: 200, body: { deleted: [email] } });
  expect(writes.map((write) => write.method)).toEqual(["PUT", "DELETE"]);
  expect((await rows())[0]).toMatchObject({
    state: "closed",
    closedReason: "provider_deleted",
    workosUserId: "user_SIGNUP",
  });
  expect((await rows())[0].ownerlessDeletionAt).toBeDefined();
});

test.each([
  ["a verified user whose owner may still be arriving", "verified", 202],
  ["a profile already bound to a Teak owner", "profile", 500],
])("ownerless deletion refuses %s", async (_name, kind, status) => {
  const users = new Map<string, FakeUser>();
  const writes = workos(users);
  const { t, post, reserve } = setup();
  const { email } = await reserve();
  users.set(
    "user_SIGNUP",
    signup(email, { email_verified: kind === "verified" })
  );
  if (kind === "profile") {
    await t.run((ctx) =>
      ctx.db.insert("workosProfiles", {
        workosUserId: "user_SIGNUP",
        teakUserId: "teak_elsewhere",
        revision: 1,
        source: "event",
      })
    );
  }
  expect((await post("cleanup", { emails: [email] })).status).toBe(status);
  expect(writes.some((write) => write.method === "DELETE")).toBe(false);
  expect(users.has("user_SIGNUP")).toBe(true);
});

test("provider absence during a lease reports nothing to delete but keeps the lease open", async () => {
  workos(new Map());
  const { post, reserve, rows } = setup();
  const { email } = await reserve();
  expect(await post("cleanup", { emails: [email] })).toMatchObject({
    status: 200,
    body: { alreadyDeleted: [email], deleted: [] },
  });
  const [row] = await rows();
  expect(row.state).toBe("reserved");
  expect(row.closedAt).toBeUndefined();
});

test("the sweep adopts a late in-window signup from an expired lease and deletes it", async () => {
  const users = new Map<string, FakeUser>();
  const writes = workos(users);
  const { post, reserve, rows } = setup();
  const { email, expiresAt } = await reserve();
  users.set("user_SIGNUP", signup(email));
  vi.setSystemTime(expiresAt + 40 * 60 * 1000);
  const sweep = await post("cleanup", {});
  expect(sweep).toMatchObject({ status: 200, body: { deleted: [email] } });
  expect(writes.map((write) => write.method)).toEqual(["PUT", "DELETE"]);
  expect((await rows())[0].state).toBe("closed");
});

test("a rotated credential cannot advance an existing reservation", async () => {
  const users = new Map<string, FakeUser>();
  const writes = workos(users);
  const { post, reserve, rows } = setup();
  const { reservationId, email } = await reserve();
  users.set("user_SIGNUP", signup(email, { email_verified: true }));
  vi.stubEnv("WORKOS_API_KEY", "rotated-test-key");
  expect((await post("signup/adopt", { reservationId, email })).status).toBe(
    503
  );
  expect(writes).toEqual([]);
  expect((await rows())[0].state).toBe("reserved");
});
