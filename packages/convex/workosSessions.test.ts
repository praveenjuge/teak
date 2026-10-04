/// <reference types="vite/client" />
import workosTest from "@convex-dev/workos-authkit/test";
import type { UserIdentity } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";
import {
  currentSession,
  getSessionProfile,
  getSessionUser,
  requireTeakUserId,
} from "./securitySessions";

const modules = import.meta.glob("./**/*.ts");
const clientId = "client_SESSION";
const claims = {
  issuer: `https://api.workos.com/user_management/${clientId}`,
  subject: "user_PROVIDER",
  sid: "session_DEVICE",
  emailVerified: true,
  email: "jwt@example.com",
  external_id: "permanent-owner",
};
const setup = () => {
  const t = convexTest(schema, modules);
  // No Better Auth registration: any accidental read of legacy storage fails.
  workosTest.register(t);
  return t;
};
type Backend = ReturnType<typeof setup>;
const seed = (t: Backend, fields: Partial<Doc<"users">> = {}) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "permanent-owner",
      workosUserId: "user_PROVIDER",
      email: "legacy@example.com",
      emailVerified: true,
      workosEmail: "workos@example.com",
      workosEmailVerified: true,
      ...fields,
    })
  );
const card = (t: Backend, userId = "permanent-owner") =>
  t.run((ctx) =>
    ctx.db.insert("cards", {
      userId,
      type: "text",
      content: `${userId} private vault`,
      createdAt: 1,
      updatedAt: 1,
    })
  );
const client = (t: Backend, overrides: Partial<UserIdentity> = {}) =>
  t.withIdentity({ ...claims, ...overrides });
const snapshot = (t: Backend) =>
  t.run(async (ctx) => ({
    users: await ctx.db.query("users").take(10),
    events: await ctx.db.query("workosEvents").take(10),
    deletions: await ctx.db.query("accountDeletionStates").take(10),
  }));
beforeEach(() => {
  vi.stubEnv("AUTH_PRIMARY", "workos");
  vi.stubEnv("WORKOS_CLIENT_ID", clientId);
  vi.stubEnv("CONVEX_SITE_URL", "https://session-tests.convex.site");
});
afterEach(() => vi.unstubAllEnvs());
// Failures: provider/mode mixups, malformed session/verification, missing or
// duplicate ownership, external ID, deletion boundaries, profile and wrong vault.
describe("WorkOS Convex sessions", () => {
  test("reads only the permanent owner's vault without writes or legacy session data", async () => {
    const t = setup();
    await seed(t);
    const own = await card(t);
    const other = await card(t, "other-owner");
    const before = await snapshot(t);
    expect(await client(t).query(api.cards.getCard, { id: own })).toMatchObject(
      { userId: "permanent-owner" }
    );
    expect(await client(t).query(api.cards.getCard, { id: other })).toBeNull();
    const session = await client(t).run((ctx) => getSessionUser(ctx));
    expect(session).toMatchObject({
      provider: "workos",
      teakUserId: "permanent-owner",
      sessionId: "session_DEVICE",
    });
    expect(session).not.toHaveProperty("session");
    expect(await snapshot(t)).toEqual(before);
  });
  test.each([
    { issuer: "https://session-tests.convex.site", sessionId: "legacy" },
    { issuer: "https://api.workos.com/" },
    { issuer: "https://api.workos.com/user_management/client_OTHER" },
    { issuer: "https://connect.authkit.app" },
    { subject: "client_MACHINE" },
    { subject: "user_bad/id" },
    { sid: undefined },
    { sid: "app_consent_CONNECT" },
    { sid: "session_bad/id" },
    { emailVerified: false },
    { emailVerified: undefined, email_verified: true },
    { external_id: "other-owner" },
    { external_id: "" },
  ])("denies invalid session claims %j", async (override) => {
    const t = setup();
    await seed(t);
    const id = await card(t);
    const before = await snapshot(t);
    expect(
      await client(t, override).query(api.cards.getCard, { id })
    ).toBeNull();
    expect(await snapshot(t)).toEqual(before);
  });
  test.each([undefined, "betterauth"])(
    "mode %s rejects WorkOS without reading legacy storage",
    async (mode) => {
      vi.stubEnv("AUTH_PRIMARY", mode);
      const t = setup();
      await seed(t);
      expect(
        await client(t).query(api.cards.getCard, { id: await card(t) })
      ).toBeNull();
    }
  );
  test.each([
    "missing",
    "duplicate_provider",
    "duplicate_owner",
    "deleted",
    "provider_deleted",
    "ledger",
    "deleting",
  ])("denies %s owners in sessions and background work", async (failure) => {
    const t = setup();
    if (failure !== "missing") {
      const fields: Partial<Doc<"users">> = {};
      if (failure === "deleted") {
        fields.deletedAt = 1;
      }
      if (failure === "provider_deleted") {
        fields.workosDeletedAt = 1;
      }
      await seed(t, fields);
    }
    if (failure === "duplicate_provider") {
      await seed(t, { teakUserId: "other-owner" });
    }
    if (failure === "duplicate_owner") {
      await seed(t, { workosUserId: "user_OTHER" });
    }
    if (failure === "ledger") {
      await t.run((ctx) =>
        ctx.db.insert("workosEvents", {
          eventId: "evt_deleted",
          type: "user.deleted",
          workosUserId: "user_PROVIDER",
          createdAt: 1,
        })
      );
    }
    if (failure === "deleting") {
      await t.run((ctx) =>
        ctx.db.insert("accountDeletionStates", {
          userId: "permanent-owner",
          startedAt: 1,
        })
      );
    }
    const before = await snapshot(t);
    expect(
      await client(t).query(api.cards.getCard, { id: await card(t) })
    ).toBeNull();
    await expect(
      t.run((ctx) => requireTeakUserId(ctx, "permanent-owner"))
    ).rejects.toThrow();
    expect(await snapshot(t)).toEqual(before);
  });
  test("background owners use synced verification, without fabricated token evidence", async () => {
    const t = setup();
    const row = await seed(t);
    expect(
      await t.run((ctx) => requireTeakUserId(ctx, "permanent-owner"))
    ).toBe("permanent-owner");
    await t.run((ctx) =>
      ctx.db.patch("users", row, { workosEmailVerified: false })
    );
    await expect(
      t.run((ctx) => requireTeakUserId(ctx, "permanent-owner"))
    ).rejects.toThrow();
    expect(
      await client(t).query(api.cards.getCard, { id: await card(t) })
    ).toMatchObject({ userId: "permanent-owner" });
  });
  test.each([undefined, "", "client_bad/id"])(
    "missing or malformed application ID %s denies a session",
    async (value) => {
      vi.stubEnv("WORKOS_CLIENT_ID", value);
      const t = setup();
      await seed(t);
      expect(
        await client(t).query(api.cards.getCard, { id: await card(t) })
      ).toBeNull();
    }
  );
  test.each([undefined, null])(
    "optional external ID %s resolves by provider ID without linking",
    async (external_id) => {
      const t = setup();
      await seed(t);
      const before = await snapshot(t);
      expect(
        await client(t, { external_id }).query(api.cards.getCard, {
          id: await card(t),
        })
      ).toMatchObject({ userId: "permanent-owner" });
      expect(await snapshot(t)).toEqual(before);
    }
  );
  test("missing WorkOS profile returns null with no legacy fallback", async () => {
    const t = setup();
    await seed(t);
    expect(await client(t).run((ctx) => getSessionProfile(ctx))).toBeNull();
    await expect(client(t).query(api.billing.getUserInfo, {})).rejects.toThrow(
      "User not found"
    );
  });
  test("profile uses permanent ID, synced WorkOS email and provider name/image", async () => {
    const t = setup();
    await seed(t);
    await t.mutation(components.workOSAuthKit.lib.onWebhookEvent, {
      event: {
        id: "evt_profile",
        event: "user.updated",
        createdAt: "2026-10-04T00:00:00.000Z",
        data: {
          id: "user_PROVIDER",
          email: "component@example.com",
          emailVerified: true,
          firstName: "First",
          lastName: "Last",
          profilePictureUrl: "https://images.example.com/avatar.png",
          externalId: "permanent-owner",
          metadata: {},
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-04T00:00:00.000Z",
        },
      },
    });
    expect(await client(t).run((ctx) => getSessionProfile(ctx))).toMatchObject({
      teakUserId: "permanent-owner",
      user: {
        _id: "permanent-owner",
        email: "workos@example.com",
        name: "First Last",
        image: "https://images.example.com/avatar.png",
      },
    });
    expect(await client(t).query(api.billing.getUserInfo, {})).toEqual({
      teakUserId: "permanent-owner",
      email: "workos@example.com",
    });
  });
  test("WorkOS cannot enter legacy device, consent or native session paths", async () => {
    const t = setup();
    await seed(t);
    const c = client(t);
    expect(await c.run((ctx) => currentSession(ctx))).toBeNull();
    expect(
      await c.query(api.securitySessions.listSessions, {
        paginationOpts: { cursor: null, numItems: 25 },
      })
    ).toMatchObject({ page: [] });
    expect(await c.query(api.oauthTokens.listOAuthConnections, {})).toEqual([]);
    expect(
      await c.query(api.oauthTokens.getOAuthConsentRequest, {
        consentCode: "pending",
      })
    ).toBeNull();
    await expect(
      c.mutation(api.securitySessions.revokeSession, { sessionId: claims.sid })
    ).rejects.toThrow("sign in");
    await expect(
      c.mutation(api.authNative.createNativeAuthCode, {
        deviceId: "device-test",
        codeChallenge: "a".repeat(43),
        state: "a".repeat(43),
        surface: "desktop",
      })
    ).rejects.toThrow("authenticated");
  });
});
