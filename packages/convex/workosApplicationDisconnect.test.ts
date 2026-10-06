/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const principal = {
  workosUserId: "user_ONE",
  clientId: "client_ONE",
  consentId: "app_consent_ONE",
  externalId: "owner",
};
beforeEach(() => {
  vi.stubEnv("WORKOS_API_KEY", "sk_test");
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", "environment_TEST");
  vi.stubEnv("WORKOS_CLIENT_ID", "client_ENV");
  vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", "https://disconnect-tests.authkit.app");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      teakUserId: "owner",
      workosUserId: principal.workosUserId,
      email: "owner@example.test",
      emailVerified: true,
      workosEmailVerified: true,
    });
    await ctx.db.insert("workosProfiles", {
      workosUserId: principal.workosUserId,
      teakUserId: "owner",
      providerUpdatedAt: "2026-10-04T00:00:00Z",
      revision: 1,
      source: "event",
      profile: {
        email: "owner@example.test",
        emailVerified: true,
        externalId: "owner",
        firstName: null,
        lastName: null,
        profilePictureUrl: null,
      },
    });
    await ctx.db.insert("workosConsents", {
      workosUserId: principal.workosUserId,
      clientId: principal.clientId,
      consentId: principal.consentId,
      userId: "owner",
      firstSeenAt: 1,
      lastSeenAt: 1,
    });
  });
  return t;
}
function provider(deleteResult: () => Promise<Response>) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (init?.method === "DELETE") {
      return deleteResult();
    }
    expect(url.origin).toBe("https://api.workos.com");
    return Promise.resolve(
      Response.json({
        data: [
          { application: { id: "connect_app_ONE", client_id: "client_ONE" } },
          {
            application: { id: "connect_app_OTHER", client_id: "client_OTHER" },
          },
        ],
        list_metadata: {},
      })
    );
  });
}
test("completed old logout replay never deletes provider authorization twice", async () => {
  const t = await setup();
  const fetcher = provider(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  expect(
    await t.action(internal.workosApplicationDisconnect.run, principal)
  ).toBe(204);
  expect(
    await t.action(internal.workosApplicationDisconnect.run, principal)
  ).toBe(204);
  expect(
    fetcher.mock.calls.filter(([, options]) => options?.method === "DELETE")
  ).toHaveLength(1);
  expect(
    String(
      fetcher.mock.calls.find(
        ([, options]) => options?.method === "DELETE"
      )?.[0]
    )
  ).toContain("/connect_app_ONE");
  const rows = await t.run((ctx) =>
    ctx.db.query("workosApplicationDisconnects").take(2)
  );
  expect(rows[0].state).toBe("completed");
  expect(
    (await t.run((ctx) => ctx.db.query("workosConsents").take(2)))[0]
      .disconnectCompletedAt
  ).toBeTypeOf("number");
});
test("unknown DELETE outcome remains fenced with zero automatic retries", async () => {
  const t = await setup();
  const fetcher = provider(() =>
    Promise.reject(new Error("lost acknowledgement"))
  );
  vi.stubGlobal("fetch", fetcher);
  expect(
    await t.action(internal.workosApplicationDisconnect.run, principal)
  ).toBe(503);
  expect(
    await t.action(internal.workosApplicationDisconnect.run, principal)
  ).toBe(503);
  expect(
    fetcher.mock.calls.filter(([, options]) => options?.method === "DELETE")
  ).toHaveLength(1);
  expect(
    (
      await t.run((ctx) => ctx.db.query("workosApplicationDisconnects").take(2))
    )[0].state
  ).toBe("unknown");
});
test("provider 404 cannot acknowledge a DELETE", async () => {
  const t = await setup();
  vi.stubGlobal(
    "fetch",
    provider(async () => new Response(null, { status: 404 }))
  );
  expect(
    await t.action(internal.workosApplicationDisconnect.run, principal)
  ).toBe(503);
  expect(
    (
      await t.run((ctx) => ctx.db.query("workosApplicationDisconnects").take(2))
    )[0].state
  ).toBe("unknown");
});
test("credential target change refuses pending operation before external lookup", async () => {
  const t = await setup();
  vi.stubGlobal(
    "fetch",
    provider(() => Promise.reject(new Error("timeout")))
  );
  expect(
    await t.action(internal.workosApplicationDisconnect.run, principal)
  ).toBe(503);
  vi.stubEnv("WORKOS_API_KEY", "sk_wrong_environment");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  expect(
    await t.action(internal.workosApplicationDisconnect.run, principal)
  ).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
});

test("fresh consent can log out again after cooldown without old replay affecting it", async () => {
  const t = await setup();
  const fetcher = provider(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now);
  expect(
    await t.action(internal.workosApplicationDisconnect.run, principal)
  ).toBe(204);
  const next = {
    ...principal,
    consentId: "app_consent_NEW",
    tokenExpiresAt: (now + 600_000) / 1000,
  };
  vi.spyOn(Date, "now").mockReturnValue(now + 304_999);
  expect(await t.action(internal.workosApplicationDisconnect.run, next)).toBe(
    503
  );
  expect(
    await t.run((ctx) => ctx.db.query("workosConsents").take(10))
  ).toHaveLength(1);
  vi.spyOn(Date, "now").mockReturnValue(now + 305_000);
  await t.run((ctx) =>
    ctx.db.insert("workosConsents", {
      ...{
        workosUserId: next.workosUserId,
        clientId: next.clientId,
        consentId: next.consentId,
      },
      userId: "owner",
      firstSeenAt: now + 305_000,
      lastSeenAt: now + 305_000,
    })
  );
  expect(await t.action(internal.workosApplicationDisconnect.run, next)).toBe(
    204
  );
  expect(
    await t.action(internal.workosApplicationDisconnect.run, {
      ...principal,
      tokenExpiresAt: now / 1000 - 1,
    })
  ).toBe(204);
  expect(
    fetcher.mock.calls.filter(([, options]) => options?.method === "DELETE")
  ).toHaveLength(2);
});
test("expired unseen or locally revoked bearer cannot delete a renewed grant", async () => {
  const t = await setup();
  const fetcher = provider(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  expect(
    await t.action(internal.workosApplicationDisconnect.run, {
      ...principal,
      tokenExpiresAt: Date.now() / 1000 - 1,
    })
  ).toBe(401);
  await t.run(async (ctx) => {
    const row = (await ctx.db.query("workosConsents").take(1))[0];
    await ctx.db.patch(row._id, { revokedAt: Date.now() - 1000 });
  });
  expect(
    await t.action(internal.workosApplicationDisconnect.run, {
      ...principal,
      tokenExpiresAt: Date.now() / 1000 - 1,
    })
  ).toBe(401);
  expect(
    await t.action(internal.workosApplicationDisconnect.run, {
      ...principal,
      consentId: "app_consent_UNSEEN",
      tokenExpiresAt: Date.now() / 1000 - 1,
    })
  ).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    await t.run((ctx) => ctx.db.query("workosApplicationDisconnects").take(1))
  ).toHaveLength(0);
});
test("unseen live consent starts a new generation after the old fence", async () => {
  const t = await setup();
  const fetcher = provider(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now);
  expect(
    await t.action(internal.workosApplicationDisconnect.run, principal)
  ).toBe(204);
  vi.spyOn(Date, "now").mockReturnValue(now + 305_000);
  const next = {
    ...principal,
    consentId: "app_consent_UNSEEN",
    tokenExpiresAt: (now + 600_000) / 1000,
  };
  expect(await t.action(internal.workosApplicationDisconnect.run, next)).toBe(
    204
  );
  expect(
    fetcher.mock.calls.filter(([, options]) => options?.method === "DELETE")
  ).toHaveLength(2);
  const row = await t.run((ctx) =>
    ctx.db
      .query("workosConsents")
      .withIndex("by_consentId", (q) => q.eq("consentId", next.consentId))
      .unique()
  );
  expect(row?.disconnectCompletedAt).toBeTypeOf("number");
});
test("lookup failure removes only the prepared fence and preserves usable consent", async () => {
  const t = await setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 503 }))
  );
  expect(
    await t.action(internal.workosApplicationDisconnect.run, principal)
  ).toBe(503);
  expect(
    await t.run((ctx) => ctx.db.query("workosApplicationDisconnects").take(1))
  ).toHaveLength(0);
  const row = (await t.run((ctx) => ctx.db.query("workosConsents").take(1)))[0];
  expect(row.revokedAt).toBeUndefined();
  expect(row.disconnectCompletedAt).toBeUndefined();
  vi.stubGlobal(
    "fetch",
    provider(async () => new Response(null, { status: 204 }))
  );
  expect(
    await t.action(internal.workosApplicationDisconnect.run, principal)
  ).toBe(204);
});
test("absent application fails before dispatch without permanently denying access", async () => {
  const t = await setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ data: [], list_metadata: {} }))
  );
  expect(
    await t.action(internal.workosApplicationDisconnect.run, principal)
  ).toBe(503);
  expect(
    await t.run((ctx) => ctx.db.query("workosApplicationDisconnects").take(1))
  ).toHaveLength(0);
  expect(
    (await t.run((ctx) => ctx.db.query("workosConsents").take(1)))[0].revokedAt
  ).toBeUndefined();
});
test("acknowledgement survives local cleanup failure and retry never issues another DELETE", async () => {
  const t = await setup();
  const fetcher = provider(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  const sibling = await t.run((ctx) =>
    ctx.db.insert("workosConsents", {
      workosUserId: principal.workosUserId,
      clientId: principal.clientId,
      consentId: "app_consent_CONFLICT",
      userId: "wrong",
      firstSeenAt: 1,
      lastSeenAt: 1,
    })
  );
  expect(
    await t.action(internal.workosApplicationDisconnect.run, principal)
  ).toBe(503);
  expect(
    (
      await t.run((ctx) => ctx.db.query("workosApplicationDisconnects").take(1))
    )[0].state
  ).toBe("acknowledged");
  await t.run((ctx) => ctx.db.patch(sibling, { userId: "owner" }));
  expect(
    await t.action(internal.workosApplicationDisconnect.run, principal)
  ).toBe(204);
  expect(
    fetcher.mock.calls.filter(([, options]) => options?.method === "DELETE")
  ).toHaveLength(1);
});
test("all known sibling receipts become terminal across bounded cleanup batches", async () => {
  const t = await setup();
  const fetcher = provider(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  await t.run(async (ctx) => {
    for (let index = 0; index < 205; index++) {
      await ctx.db.insert("workosConsents", {
        workosUserId: principal.workosUserId,
        clientId: principal.clientId,
        consentId: `app_consent_S${index}`,
        userId: "owner",
        firstSeenAt: 1,
        lastSeenAt: 1,
        ...(index % 2 ? { revokedAt: 2 } : {}),
      });
    }
    await ctx.db.insert("workosConsents", {
      workosUserId: principal.workosUserId,
      clientId: "client_OTHER",
      consentId: "app_consent_OTHER",
      userId: "owner",
      firstSeenAt: 1,
      lastSeenAt: 1,
    });
  });
  expect(
    await t.action(internal.workosApplicationDisconnect.run, principal)
  ).toBe(204);
  const rows = await t.run((ctx) => ctx.db.query("workosConsents").take(300));
  expect(
    rows
      .filter((row) => row.clientId === principal.clientId)
      .every(
        (row) =>
          row.revokedAt !== undefined && row.disconnectCompletedAt !== undefined
      )
  ).toBe(true);
  expect(
    rows.find((row) => row.clientId === "client_OTHER")?.revokedAt
  ).toBeUndefined();
  expect(
    await t.action(internal.workosApplicationDisconnect.run, {
      ...principal,
      consentId: "app_consent_S1",
      tokenExpiresAt: 1,
    })
  ).toBe(204);
  expect(
    fetcher.mock.calls.filter(([, options]) => options?.method === "DELETE")
  ).toHaveLength(1);
});

test("expired saved token resumes acknowledged cleanup without another provider dispatch", async () => {
  const t = await setup();
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now);
  const proof = { ...principal, tokenExpiresAt: (now + 1000) / 1000 };
  const fetcher = provider(() =>
    Promise.resolve(new Response(null, { status: 204 }))
  );
  vi.stubGlobal("fetch", fetcher);
  const conflict = await t.run((ctx) =>
    ctx.db.insert("workosConsents", {
      workosUserId: principal.workosUserId,
      clientId: principal.clientId,
      consentId: "app_consent_WRONG",
      userId: "wrong",
      firstSeenAt: 1,
      lastSeenAt: 1,
    })
  );
  expect(await t.action(internal.workosApplicationDisconnect.run, proof)).toBe(
    503
  );
  expect(
    (
      await t.run((ctx) => ctx.db.query("workosApplicationDisconnects").take(1))
    )[0].state
  ).toBe("acknowledged");
  vi.spyOn(Date, "now").mockReturnValue(now + 2000);
  await t.run((ctx) => ctx.db.patch(conflict, { userId: "owner" }));
  expect(await t.action(internal.workosApplicationDisconnect.run, proof)).toBe(
    204
  );
  expect(
    fetcher.mock.calls.filter(([, options]) => options?.method === "DELETE")
  ).toHaveLength(1);
});

test("access expiry during provider lookup cancels prepared operation without DELETE", async () => {
  const t = await setup();
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now);
  const fetcher = vi.fn(() => {
    vi.spyOn(Date, "now").mockReturnValue(now + 2000);
    return Promise.resolve(
      Response.json({
        data: [
          {
            application: {
              id: "connect_app_ONE",
              client_id: principal.clientId,
            },
          },
        ],
        list_metadata: {},
      })
    );
  });
  vi.stubGlobal("fetch", fetcher);
  expect(
    await t.action(internal.workosApplicationDisconnect.run, {
      ...principal,
      tokenExpiresAt: (now + 1000) / 1000,
    })
  ).toBe(503);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    await t.run((ctx) => ctx.db.query("workosApplicationDisconnects").take(1))
  ).toHaveLength(0);
  expect(
    (await t.run((ctx) => ctx.db.query("workosConsents").take(1)))[0].revokedAt
  ).toBeUndefined();
});

test("delayed callbacks from an earlier generation cannot alter the renewed generation", async () => {
  const t = await setup();
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now);
  vi.stubGlobal(
    "fetch",
    provider(() => Promise.resolve(new Response(null, { status: 204 })))
  );
  expect(
    await t.action(internal.workosApplicationDisconnect.run, principal)
  ).toBe(204);
  const old = (
    await t.run((ctx) => ctx.db.query("workosApplicationDisconnects").take(1))
  )[0];
  vi.spyOn(Date, "now").mockReturnValue(now + 305_000);
  const next = {
    ...principal,
    consentId: "app_consent_NEXT",
    tokenExpiresAt: (now + 600_000) / 1000,
  };
  expect(await t.action(internal.workosApplicationDisconnect.run, next)).toBe(
    204
  );
  expect(
    await t.mutation(internal.workosApplicationDisconnect.finish, {
      fenceId: old._id,
      operationId: old.operationId,
      success: false,
    })
  ).toBe(false);
  expect(
    await t.mutation(internal.workosApplicationDisconnect.acknowledge, {
      fenceId: old._id,
      operationId: old.operationId,
    })
  ).toBe(false);
  expect(
    await t.mutation(internal.workosApplicationDisconnect.cancelPrepared, {
      fenceId: old._id,
      operationId: old.operationId,
    })
  ).toBe(false);
  const current = (
    await t.run((ctx) => ctx.db.query("workosApplicationDisconnects").take(1))
  )[0];
  expect(current.operationId).not.toBe(old.operationId);
  expect(current.state).toBe("completed");
  expect(current.triggerConsentId).toBe(next.consentId);
});

test("concurrent logout requests dispatch only one provider DELETE", async () => {
  const t = await setup();
  const fetcher = provider(() =>
    Promise.resolve(new Response(null, { status: 204 }))
  );
  vi.stubGlobal("fetch", fetcher);
  const statuses: number[] = await Promise.all([
    t.action(internal.workosApplicationDisconnect.run, principal),
    t.action(internal.workosApplicationDisconnect.run, principal),
  ]);
  expect(statuses).toContain(204);
  expect(statuses.every((status) => status === 204 || status === 503)).toBe(
    true
  );
  expect(
    fetcher.mock.calls.filter(([, options]) => options?.method === "DELETE")
  ).toHaveLength(1);
  expect(
    (
      await t.run((ctx) => ctx.db.query("workosApplicationDisconnects").take(1))
    )[0].state
  ).toBe("completed");
});
