import type { UserIdentity } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setOwnerVerified } from "../__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import schema from "../schema";
import {
  getSessionProfile,
  getSessionUser,
  requireTeakUserId,
} from "../securitySessions";

const modules = import.meta.glob("../**/*.ts");
const clientId = "client_SESSION";
// The identity Convex exposes for a hosted AuthKit access token through the
// customJwt provider: claims stay raw (`email_verified`, not `emailVerified`).
const claims = {
  issuer: `https://api.workos.com/user_management/${clientId}`,
  subject: "user_PROVIDER",
  sid: "session_DEVICE",
  email_verified: true,
  email: "jwt@example.com",
  external_id: "permanent-owner",
  client_id: clientId,
  jti: "01JWTID",
  auth_time: 1,
};
const setup = () => {
  const t = convexTest(schema, modules);
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
    deletions: await ctx.db.query("accountDeletionStates").take(10),
  }));
beforeEach(() => {
  vi.stubEnv("WORKOS_CLIENT_ID", clientId);
  vi.stubEnv("CONVEX_SITE_URL", "https://session-tests.convex.site");
});
afterEach(() => vi.unstubAllEnvs());
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
      teakUserId: "permanent-owner",
      sessionId: "session_DEVICE",
    });
    expect(session).not.toHaveProperty("session");
    expect(await snapshot(t)).toEqual(before);
  });
  test("hosted AuthKit sign-in loads the permanent owner's current user", async () => {
    const t = setup();
    await seed(t);
    await card(t);
    expect(await client(t).query(api.auth.getCurrentUser, {})).toMatchObject({
      _id: "permanent-owner",
      email: "jwt@example.com",
      emailVerified: true,
      cardCount: 1,
    });
    expect(
      await client(t, { email_verified: false }).query(
        api.auth.getCurrentUser,
        {}
      )
    ).toBeNull();
    await t.mutation(internal.accountDeletion.beginAccountDataDeletion, {
      userId: "permanent-owner",
    });
    expect(await client(t).query(api.auth.getCurrentUser, {})).toBeNull();
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
    { email_verified: false },
    { email_verified: undefined },
    { email_verified: "true" },
    { email_verified: undefined, emailVerified: true },
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
  test.each([
    "missing",
    "duplicate_provider",
    "deleted",
    "provider_deleted",
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
    if (failure === "deleting") {
      await t.mutation(internal.accountDeletion.beginAccountDataDeletion, {
        userId: "permanent-owner",
      });
    }
    const before = await snapshot(t);
    expect(
      await client(t).query(api.cards.getCard, { id: await card(t) })
    ).toBeNull();
    // Background work checks the row its stored owner ID names; only a
    // session starts from the WorkOS user, where a second mapping shows.
    if (failure !== "duplicate_provider") {
      await expect(
        t.run((ctx) => requireTeakUserId(ctx, "permanent-owner"))
      ).rejects.toThrow();
    }
    expect(await snapshot(t)).toEqual(before);
  });
  test("background owners and sessions follow the mapping row's verification, which a verified sign-in restores", async () => {
    const t = setup();
    await seed(t);
    const id = await card(t);
    expect(
      await t.run((ctx) => requireTeakUserId(ctx, "permanent-owner"))
    ).toBe("permanent-owner");
    await setOwnerVerified(t, "user_PROVIDER", false);
    await expect(
      t.run((ctx) => requireTeakUserId(ctx, "permanent-owner"))
    ).rejects.toThrow();
    expect(await client(t).query(api.cards.getCard, { id })).toBeNull();
    expect(
      await client(t).mutation(api.workosBootstrap.ensureUser, {})
    ).toEqual({ status: "ok", teakUserId: "permanent-owner" });
    expect(
      await t.run((ctx) => requireTeakUserId(ctx, "permanent-owner"))
    ).toBe("permanent-owner");
    expect(await client(t).query(api.cards.getCard, { id })).toMatchObject({
      userId: "permanent-owner",
    });
  });
  test("a verified sign-in with an address another account holds restores the session and keeps the old address", async () => {
    const t = setup();
    await seed(t, { email: "workos@example.com", emailVerified: false });
    await t.run((ctx) =>
      ctx.db.insert("users", {
        teakUserId: "other-owner",
        workosUserId: "user_OTHER",
        email: "taken@example.com",
        emailVerified: true,
      })
    );
    const id = await card(t);
    const taken = client(t, { email: "taken@example.com" });
    expect(await taken.query(api.cards.getCard, { id })).toBeNull();
    await taken.mutation(api.workosBootstrap.ensureUser, {});
    const rows = (await snapshot(t)).users;
    expect(
      rows.find((row) => row.teakUserId === "permanent-owner")
    ).toMatchObject({ email: "workos@example.com", emailVerified: true });
    expect(await taken.query(api.cards.getCard, { id })).toMatchObject({
      userId: "permanent-owner",
    });
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
  test.each([undefined, null, "other-owner", ""])(
    "external ID %s is ignored: the provider ID resolves without linking",
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
  test("the profile's address comes from the signed claims, falling back to the owner row", async () => {
    const t = setup();
    await seed(t);
    expect(await client(t).run((ctx) => getSessionProfile(ctx))).toEqual({
      teakUserId: "permanent-owner",
      user: {
        _id: "permanent-owner",
        email: "jwt@example.com",
        emailVerified: true,
        name: null,
        image: null,
      },
    });
    expect(await client(t).query(api.billing.getUserInfo, {})).toEqual({
      teakUserId: "permanent-owner",
      email: "jwt@example.com",
    });
    expect(
      await client(t, { email: undefined }).run((ctx) => getSessionProfile(ctx))
    ).toMatchObject({ user: { email: "legacy@example.com" } });
    expect(
      await client(t, { email: undefined }).query(api.billing.getUserInfo, {})
    ).toEqual({ teakUserId: "permanent-owner", email: "legacy@example.com" });
  });
  test.each([
    {
      names: { name: " Full Name ", first_name: "First", last_name: "Last" },
      row: {},
      expected: "Full Name",
    },
    {
      names: { first_name: " First ", last_name: "Last" },
      row: { name: "Stored Name" },
      expected: "First Last",
    },
    {
      names: { first_name: "Only", last_name: null },
      row: {},
      expected: "Only",
    },
    {
      names: { first_name: " ", last_name: "" },
      row: { name: "Stored Name" },
      expected: null,
    },
    { names: {}, row: { name: "Stored Name" }, expected: null },
    { names: {}, row: {}, expected: null },
  ])(
    "the profile's name comes only from the claims of a token that carries the address: $expected",
    async ({ names, row, expected }) => {
      const t = setup();
      await seed(t, row);
      const user = {
        _id: "permanent-owner",
        email: "jwt@example.com",
        emailVerified: true,
        name: expected,
        image: null,
      };
      expect(
        await client(t, names).run((ctx) => getSessionProfile(ctx))
      ).toEqual({ teakUserId: "permanent-owner", user });
      expect(
        await client(t, names).query(api.auth.getCurrentUser, {})
      ).toMatchObject(user);
    }
  );
  test("a token without the address claim takes the name from the owner row", async () => {
    const t = setup();
    await seed(t, { name: "Stored Name" });
    expect(
      await client(t, { email: undefined }).run((ctx) => getSessionProfile(ctx))
    ).toMatchObject({
      user: { email: "legacy@example.com", name: "Stored Name" },
    });
  });
});
