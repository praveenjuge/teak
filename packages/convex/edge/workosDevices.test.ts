import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import {
  getWorkosBootstrapIdentity,
  readWorkosSessionIdentity,
} from "../securitySessions";
import { RATE_LIMIT_CONFIG } from "../shared/rateLimits";

const modules = import.meta.glob("../**/*.ts");
const claims = {
  subject: "user_OWNER",
  issuer: "https://api.workos.com/user_management/client_DEVICES",
  sid: "session_CURRENT",
  email_verified: true,
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
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function setup(overrides = {}, owner = {}) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  const row = await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "owner",
      email: "legacy@example.test",
      emailVerified: true,
      workosUserId: "user_OWNER",
      ...owner,
    })
  );
  return { t, row, user: t.withIdentity({ ...claims, ...overrides }) };
}
const paginationOpts = { cursor: null, numItems: 25 };
const { capacity: deviceRequests } = RATE_LIMIT_CONFIG.workosSessionRequests;
describe("device requests to WorkOS are limited per account", () => {
  test("a loop of device calls stops reaching WorkOS at the account's limit", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = await setup();
    for (let call = 0; call < deviceRequests; call++) {
      await f.user.action(api.securitySessions.listAuthkitSessions, {
        paginationOpts,
      });
    }
    expect(calls).toHaveLength(deviceRequests);
    await expect(
      f.user.action(api.securitySessions.listAuthkitSessions, {
        paginationOpts,
      })
    ).rejects.toThrow("RATE_LIMITED");
    await expect(
      f.user.action(api.securitySessions.revokeAuthkitSession, {
        sessionId: claims.sid,
      })
    ).rejects.toThrow("RATE_LIMITED");
    expect(calls).toHaveLength(deviceRequests);
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(60_000);
    await f.user.action(api.securitySessions.revokeAuthkitSession, {
      sessionId: claims.sid,
    });
    expect(revoked).toEqual([claims.sid]);
  });

  test("a revoke spends a token on every WorkOS page it reads", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = await setup();
    pages.session_NEXT = [session("session_OTHER")];
    // Two left: enough for both list pages, not for the revoke after them.
    for (let call = 0; call < deviceRequests - 2; call++) {
      await f.user.action(api.securitySessions.listAuthkitSessions, {
        paginationOpts,
      });
    }
    calls = [];
    await expect(
      f.user.action(api.securitySessions.revokeAuthkitSession, {
        sessionId: "session_OTHER",
      })
    ).rejects.toThrow("RATE_LIMITED");
    expect(calls.map((url) => url.searchParams.get("after"))).toEqual([
      null,
      "session_NEXT",
    ]);
    expect(revoked).toEqual([]);
  });
});
describe("owned WorkOS devices", () => {
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
          agent: { kind: "browser", browser: "chrome", os: "macos" },
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
      {
        id: "session_OTHER",
        name: "Browser",
        agent: { kind: "browser" },
        current: false,
      },
    ]);
    expect(next.isDone).toBe(true);
    expect(calls[1].searchParams.get("limit")).toBe("100");
  });
  test("names devices in parts and says when a session was last active", async () => {
    const f = await setup();
    pages[""] = [
      session("session_CURRENT", {
        user_agent: "Teak Browser Extension/1.0",
        updated_at: "2026-03-01T10:00:00.000Z",
      }),
      session("session_OTHER", {
        user_agent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1",
      }),
      session("session_THIRD", { user_agent: null }),
    ];
    const { page } = await f.user.action(
      api.securitySessions.listAuthkitSessions,
      { paginationOpts }
    );
    expect(page).toMatchObject([
      {
        agent: { kind: "extension" },
        lastActiveAt: Date.parse("2026-03-01T10:00:00.000Z"),
        name: "Teak browser extension",
      },
      {
        agent: { kind: "browser", browser: "safari", os: "ios" },
        name: "Safari on iOS",
      },
      { agent: { kind: "unknown" }, name: "Unknown device" },
    ]);
    // An unchanged session has no separate last-active time.
    expect(page[1]).not.toHaveProperty("lastActiveAt");
  });
  test("signs out every other live session and never this one", async () => {
    const f = await setup();
    pages[""] = [
      session("session_CURRENT"),
      session("session_OTHER"),
      session("session_REVOKED", { status: "revoked" }),
    ];
    pages.session_NEXT = [session("session_LATER")];
    expect(
      await f.user.action(api.securitySessions.revokeOtherAuthkitSessions, {})
    ).toEqual({ revokedCount: 2, hasMore: false });
    expect(revoked).toEqual(["session_OTHER", "session_LATER"]);
  });
  test("signs out other sessions in batches within the request limit", async () => {
    const f = await setup();
    pages[""] = [
      session("session_CURRENT"),
      ...Array.from({ length: 25 }, (_, index) =>
        session(`session_MANY${index}`)
      ),
    ];
    expect(
      await f.user.action(api.securitySessions.revokeOtherAuthkitSessions, {})
    ).toEqual({ revokedCount: 20, hasMore: true });
    expect(revoked).not.toContain(claims.sid);
    expect(calls.length).toBeLessThanOrEqual(deviceRequests);
  });
  test("denies signing out other devices without a valid session", async () => {
    const f = await setup({ email_verified: false });
    await expect(
      f.user.action(api.securitySessions.revokeOtherAuthkitSessions, {})
    ).rejects.toThrow("sign in");
    expect(calls).toEqual([]);
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
    { email_verified: false },
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
    await f.t.mutation(internal.accountDeletion.beginAccountDataDeletion, {
      userId: "owner",
    });
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
  test.each([false, undefined])(
    "bootstrap preserves unverified %s evidence without granting access",
    async (email_verified) => {
      const f = await setup({ email_verified });
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
          { ...claims, email_verified, tokenIdentifier: "test" },
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
