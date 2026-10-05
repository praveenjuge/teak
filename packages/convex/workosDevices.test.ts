/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components } from "./_generated/api";
import schema from "./schema";
import {
  getWorkosBootstrapIdentity,
  readWorkosSessionIdentity,
} from "./securitySessions";

const modules = import.meta.glob("./**/*.ts");
const claims = {
  subject: "user_OWNER",
  issuer: "https://api.workos.com/user_management/client_DEVICES",
  sid: "session_CURRENT",
  emailVerified: true,
  email: "owner@example.test",
  external_id: "owner",
};
let calls: URL[];
let revoked: string[];
let pages: Record<string, ReturnType<typeof session>[]>;
let unavailable: boolean;
let failRevoke: boolean;
let repeated: boolean;
let loseRevokeResponse: boolean;
let omitRevoked: boolean;
let revokeStatus: number | null;
function session(id: string, overrides = {}) {
  return {
    object: "session",
    id,
    user_id: "user_OWNER",
    status: "active",
    user_agent: "Mozilla/5.0 (Macintosh) Chrome/140",
    ip_address: null,
    auth_method: "password",
    ended_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}
beforeEach(() => {
  vi.stubEnv("AUTH_PRIMARY", "workos");
  vi.stubEnv("WORKOS_CLIENT_ID", "client_DEVICES");
  vi.stubEnv("WORKOS_API_KEY", "sk_test_devices");
  calls = [];
  revoked = [];
  pages = { "": [session("session_CURRENT")] };
  unavailable = false;
  failRevoke = false;
  repeated = false;
  loseRevokeResponse = false;
  omitRevoked = false;
  revokeStatus = null;
  // Only the external WorkOS HTTP boundary is replaced. SDK deserialization and actions run normally.
  vi.stubGlobal(
    "fetch",
    async (input: Request | URL | string, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      calls.push(url);
      if (url.origin !== "https://api.workos.com") {
        throw new Error("Unexpected provider");
      }
      if (unavailable) {
        return await Promise.resolve(
          Response.json({ message: "Outage" }, { status: 503 })
        );
      }
      if (url.pathname === "/user_management/sessions/revoke") {
        if (revokeStatus !== null) {
          return Response.json(
            { message: "Provider rejected revoke" },
            { status: revokeStatus }
          );
        }
        if (failRevoke) {
          return await Promise.resolve(
            Response.json({ message: "Outage" }, { status: 503 })
          );
        }
        const body = JSON.parse(String(init?.body));
        if (omitRevoked && revoked.includes(body.session_id)) {
          return Response.json(
            { message: "Session not found" },
            { status: 404 }
          );
        }
        revoked.push(body.session_id);
        if (loseRevokeResponse) {
          pages[""] = omitRevoked
            ? []
            : [session(body.session_id, { status: "revoked" })];
          throw new Error("Revoke response was lost");
        }
        return new Response(null, { status: 204 });
      }
      expect(url.pathname).toBe("/user_management/users/user_OWNER/sessions");
      const cursor = url.searchParams.get("after") ?? "";
      const data = pages[cursor] ?? [];
      let next: string | null = null;
      if (repeated) {
        next = `session_PAGE${calls.length}`;
      } else if (cursor === "" && pages.session_NEXT) {
        next = "session_NEXT";
      }
      return await Promise.resolve(
        Response.json({
          object: "list",
          data,
          list_metadata: { before: null, after: next },
        })
      );
    }
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function setup(overrides = {}, owner = {}) {
  const t = convexTest(schema, modules);
  workosTest.register(t);
  const row = await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "owner",
      email: "legacy@example.test",
      emailVerified: true,
      workosUserId: "user_OWNER",
      workosEmail: "owner@example.test",
      workosEmailVerified: true,
      ...owner,
    })
  );
  await t.run(async (ctx) => {
    const current = await ctx.db.get(row);
    if (!current) {
      throw new Error("Missing device fixture owner");
    }
    await ctx.db.insert("workosProfiles", {
      workosUserId: "user_OWNER",
      teakUserId: "owner",
      revision: 1,
      source: "reconciliation",
      providerUpdatedAt: "2026-01-01T00:00:00Z",
      profile: {
        email: current.workosEmail ?? current.email,
        emailVerified: current.workosEmailVerified === true,
        externalId: "owner",
        firstName: null,
        lastName: null,
        profilePictureUrl: null,
      },
    });
  });
  return { t, row, user: t.withIdentity({ ...claims, ...overrides }) };
}
const paginationOpts = { cursor: null, numItems: 25 };
// Failure modes: provider/owner confusion; invalid/inactive data; foreign target; late-page ownership;
// unbounded pagination; transport/revoke outage; bootstrap verification and legacy regression.
describe("owned WorkOS devices", () => {
  test("Better Auth clients cannot enter WorkOS actions", async () => {
    vi.stubEnv("AUTH_PRIMARY", "betterauth");
    const t = convexTest(schema, modules);
    betterAuthTest.register(t);
    const current = await t.mutation(components.betterAuth.adapter.create, {
      input: {
        model: "session",
        data: {
          userId: "owner",
          token: "live-better-auth-session",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          expiresAt: Date.now() + 60_000,
        },
      },
    });
    const user = t.withIdentity({
      issuer: process.env.CONVEX_SITE_URL,
      subject: "owner",
      sessionId: current._id,
    });
    expect(
      (await user.query(api.securitySessions.listSessions, { paginationOpts }))
        .page
    ).toMatchObject([{ id: current._id, current: true }]);
    await expect(
      user.action(api.securitySessions.listAuthkitSessions, {
        paginationOpts,
      })
    ).rejects.toThrow("sign in");
    await expect(
      user.action(api.securitySessions.revokeAuthkitSession, {
        sessionId: claims.sid,
      })
    ).rejects.toThrow("sign in");
    expect(calls).toEqual([]);
  });
  test("WorkOS claims cannot enter shipped Better Auth query and mutation", async () => {
    const f = await setup();
    expect(
      await f.user.query(api.securitySessions.listSessions, { paginationOpts })
    ).toEqual({ page: [], isDone: true, continueCursor: "" });
    await expect(
      f.user.mutation(api.securitySessions.revokeSession, {
        sessionId: claims.sid,
      })
    ).rejects.toThrow("sign in");
    expect(calls).toEqual([]);
  });
  test("lists active owned sessions with safe labels and follows provider pagination", async () => {
    const f = await setup();
    pages[""] = [
      session("session_CURRENT"),
      session("session_EXPIRED", { expires_at: "2000-01-01T00:00:00.000Z" }),
      session("session_REVOKED", { status: "revoked" }),
    ];
    pages.session_NEXT = [
      session("session_OTHER", { user_agent: "<script>private</script>" }),
    ];
    expect(
      await f.user.action(api.securitySessions.listAuthkitSessions, {
        paginationOpts,
      })
    ).toEqual({
      page: [
        {
          id: "session_CURRENT",
          name: "Chrome on macOS",
          current: true,
          signedInAt: Date.parse("2026-01-01T00:00:00.000Z"),
        },
      ],
      isDone: false,
      continueCursor: "session_NEXT",
    });
    const next = await f.user.action(api.securitySessions.listAuthkitSessions, {
      paginationOpts: { cursor: "session_NEXT", numItems: 500 },
    });
    expect(next.page).toMatchObject([
      { id: "session_OTHER", name: "Browser", current: false },
    ]);
    expect(next.isDone).toBe(true);
    expect(calls[1].searchParams.get("limit")).toBe("100");
  });
  test("proves target ownership on a later page before provider revoke", async () => {
    const f = await setup();
    pages.session_NEXT = [session("session_OTHER")];
    await f.user.action(api.securitySessions.revokeAuthkitSession, {
      sessionId: "session_OTHER",
    });
    expect(revoked).toEqual(["session_OTHER"]);
    expect(
      calls.slice(0, 2).map((url) => url.searchParams.get("after"))
    ).toEqual([null, "session_NEXT"]);
  });
  test("revokes the real current AuthKit sid", async () => {
    const f = await setup();
    await f.user.action(api.securitySessions.revokeAuthkitSession, {
      sessionId: claims.sid,
    });
    expect(revoked).toEqual([claims.sid]);
  });
  test.each(["session_FOREIGN", "app_consent_GRANT", "session_bad/id"])(
    "never revokes unowned or malformed target %s",
    async (sessionId) => {
      const f = await setup();
      await expect(
        f.user.action(api.securitySessions.revokeAuthkitSession, { sessionId })
      ).rejects.toThrow();
      expect(revoked).toEqual([]);
    }
  );
  test.each([
    { issuer: "https://api.workos.com/user_management/client_OTHER" },
    { sid: "app_consent_GRANT" },
    { emailVerified: false },
  ])(
    "denies invalid authenticated claims %j before provider access",
    async (overrides) => {
      const f = await setup(overrides);
      await expect(
        f.user.action(api.securitySessions.revokeAuthkitSession, {
          sessionId: claims.sid,
        })
      ).rejects.toThrow("sign in");
      expect(calls).toEqual([]);
    }
  );
  test("denies anonymous and deleting owners before provider access", async () => {
    const f = await setup();
    await expect(
      f.t.action(api.securitySessions.revokeAuthkitSession, {
        sessionId: claims.sid,
      })
    ).rejects.toThrow("sign in");
    await f.t.run((ctx) =>
      ctx.db.insert("accountDeletionStates", { userId: "owner", startedAt: 1 })
    );
    await expect(
      f.user.action(api.securitySessions.revokeAuthkitSession, {
        sessionId: claims.sid,
      })
    ).rejects.toThrow("sign in");
    expect(calls).toEqual([]);
  });
  test.each([
    { user_id: "user_FOREIGN" },
    { id: "app_consent_GRANT" },
    { status: "unknown" },
    { expires_at: "invalid" },
  ])("rejects inconsistent provider data %j", async (overrides) => {
    const f = await setup();
    pages[""] = [session("session_OTHER", overrides)];
    await expect(
      f.user.action(api.securitySessions.listAuthkitSessions, {
        paginationOpts,
      })
    ).rejects.toThrow("invalid session");
    await expect(
      f.user.action(api.securitySessions.revokeAuthkitSession, {
        sessionId: "session_OTHER",
      })
    ).rejects.toThrow("invalid session");
    expect(revoked).toEqual([]);
  });
  test.each([
    { status: "revoked" },
    { status: "expired" },
    { expires_at: "2000-01-01T00:00:00.000Z" },
  ])("owned inactive target %j is already signed out", async (overrides) => {
    const f = await setup();
    pages[""] = [session("session_OTHER", overrides)];
    expect(
      await f.user.action(api.securitySessions.revokeAuthkitSession, {
        sessionId: "session_OTHER",
      })
    ).toBeNull();
    expect(revoked).toEqual([]);
  });
  test("current-session retry succeeds when provider omits the revoked session", async () => {
    const f = await setup();
    loseRevokeResponse = true;
    omitRevoked = true;
    await expect(
      f.user.action(api.securitySessions.revokeAuthkitSession, {
        sessionId: claims.sid,
      })
    ).rejects.toThrow();
    expect(revoked).toEqual([claims.sid]);
    expect(
      await f.user.action(api.securitySessions.revokeAuthkitSession, {
        sessionId: claims.sid,
      })
    ).toBeNull();
    expect(revoked).toEqual([claims.sid]);
    expect(pages[""]).toEqual([]);
    expect(calls.every((url) => url.pathname.endsWith("/revoke"))).toBe(true);
  });
  test.each([400, 401, 403, 429, 503])(
    "current-session revoke failure %s remains a failure",
    async (status) => {
      const f = await setup();
      pages[""] = [];
      revokeStatus = status;
      await expect(
        f.user.action(api.securitySessions.revokeAuthkitSession, {
          sessionId: claims.sid,
        })
      ).rejects.toThrow();
      expect(revoked).toEqual([]);
    }
  );
  test("a non-current target cannot use the signed-current-session exception", async () => {
    const f = await setup();
    pages[""] = [];
    revokeStatus = 404;
    await expect(
      f.user.action(api.securitySessions.revokeAuthkitSession, {
        sessionId: "session_FOREIGN",
      })
    ).rejects.toThrow("not found");
    expect(calls).toHaveLength(1);
    expect(calls[0].pathname).toBe(
      "/user_management/users/user_OWNER/sessions"
    );
    expect(revoked).toEqual([]);
  });
  test("bounds ownership search to twenty pages and never revokes without proof", async () => {
    const f = await setup();
    repeated = true;
    pages[""] = [];
    await expect(
      f.user.action(api.securitySessions.revokeAuthkitSession, {
        sessionId: "session_MISSING",
      })
    ).rejects.toThrow("contact support");
    expect(calls).toHaveLength(20);
    expect(revoked).toEqual([]);
  });
  test("list and revoke provider outages reject without claiming sign-out", async () => {
    const f = await setup();
    unavailable = true;
    await expect(
      f.user.action(api.securitySessions.listAuthkitSessions, {
        paginationOpts,
      })
    ).rejects.toThrow();
    await expect(
      f.user.action(api.securitySessions.revokeAuthkitSession, {
        sessionId: claims.sid,
      })
    ).rejects.toThrow();
    unavailable = false;
    failRevoke = true;
    await expect(
      f.user.action(api.securitySessions.revokeAuthkitSession, {
        sessionId: claims.sid,
      })
    ).rejects.toThrow();
    expect(revoked).toEqual([]);
  });
  test.each(["owner with space", "owner\u0000", "owner\n"])(
    "bootstrap and strict sessions reject malformed external ID without linking",
    async (external_id) => {
      const f = await setup({ external_id });
      expect(
        await f.user.run((ctx) => getWorkosBootstrapIdentity(ctx))
      ).toBeNull();
      await expect(
        f.user.action(api.securitySessions.revokeAuthkitSession, {
          sessionId: claims.sid,
        })
      ).rejects.toThrow("sign in");
      expect(calls).toEqual([]);
    }
  );
  test.each([false, undefined])(
    "bootstrap preserves unverified %s evidence without granting access",
    async (emailVerified) => {
      const f = await setup({ emailVerified });
      const bootstrap = await f.user.run((ctx) =>
        getWorkosBootstrapIdentity(ctx)
      );
      expect(bootstrap).toMatchObject({
        workosUserId: claims.subject,
        sessionId: claims.sid,
        email: claims.email,
        emailVerified: false,
      });
      expect(
        readWorkosSessionIdentity(
          { ...claims, emailVerified, tokenIdentifier: "test" },
          "client_DEVICES"
        )
      ).toBeNull();
      const wrong = f.t.withIdentity({
        ...claims,
        issuer: "https://wrong.example",
      });
      expect(
        await wrong.run((ctx) => getWorkosBootstrapIdentity(ctx))
      ).toBeNull();
    }
  );
});
