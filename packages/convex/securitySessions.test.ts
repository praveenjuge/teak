/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const paginationOpts = { cursor: null, numItems: 25 };
async function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  const create = (
    userId: string,
    userAgent: string,
    expiresAt = Date.now() + 60_000
  ) =>
    t.mutation(components.betterAuth.adapter.create, {
      input: {
        model: "session",
        data: {
          userId,
          userAgent,
          expiresAt,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          token: crypto.randomUUID(),
          ipAddress: "private-ip",
        },
      },
    });
  const current = await create(
    "owner",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1 Safari/605.1"
  );
  const other = await create(
    "owner",
    "Mozilla/5.0 (Windows NT 10.0) Chrome/140.0"
  );
  const stranger = await create("stranger", "Private user agent");
  await create("owner", "Expired", Date.now() - 1000);
  return {
    t,
    current,
    other,
    stranger,
    authenticated: t.withIdentity({
      issuer: process.env.CONVEX_SITE_URL,
      subject: "owner",
      sessionId: current._id,
    }),
  };
}

describe("Security sessions", () => {
  test("revoking a device blocks cached-token card reads and writes", async () => {
    const { t, authenticated, current, other } = await setup();
    const id = await t.run((ctx) =>
      ctx.db.insert("cards", {
        userId: "owner",
        type: "text",
        content: "Private card",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );
    const otherDevice = t.withIdentity({
      issuer: process.env.CONVEX_SITE_URL,
      subject: "owner",
      sessionId: other._id,
    });
    expect(await authenticated.query(api.cards.getCard, { id })).toMatchObject({
      content: "Private card",
    });
    await otherDevice.mutation(api.securitySessions.revokeSession, {
      sessionId: current._id,
    });
    expect(await authenticated.query(api.cards.getCard, { id })).toBeNull();
    expect(await authenticated.query(api.cards.getCards, { limit: 2 })).toEqual(
      []
    );
    await expect(
      authenticated.mutation(api.cards.createCard, {
        type: "text",
        content: "Revocation bypass",
      })
    ).rejects.toThrow("authenticated");
    expect(await otherDevice.query(api.cards.getCard, { id })).toMatchObject({
      content: "Private card",
    });
  });
  test("a live legacy session cannot authorize a foreign provider issuer", async () => {
    const { t, current } = await setup();
    const id = await t.run((ctx) =>
      ctx.db.insert("cards", {
        userId: "owner",
        type: "text",
        content: "Private",
        createdAt: 1,
        updatedAt: 1,
      })
    );
    const forged = t.withIdentity({
      issuer: "https://api.workos.com/user_management/client_FOREIGN",
      subject: "owner",
      sessionId: current._id,
    });
    expect(await forged.query(api.cards.getCard, { id })).toBeNull();
    await expect(
      forged.mutation(api.securitySessions.revokeSession, {
        sessionId: current._id,
      })
    ).rejects.toThrow("sign in");
    expect(
      await t.query(components.betterAuth.adapter.findOne, {
        model: "session",
        where: [{ field: "_id", value: current._id }],
      })
    ).toMatchObject({ _id: current._id });
  });

  test("lists only owned live sessions with safe fields and this device first", async () => {
    const { authenticated, current, other } = await setup();
    const result = await authenticated.query(
      api.securitySessions.listSessions,
      { paginationOpts }
    );
    expect(result.page).toEqual([
      {
        id: current._id,
        current: true,
        name: "Safari on macOS",
        signedInAt: current.createdAt,
      },
      {
        id: other._id,
        current: false,
        name: "Chrome on Windows",
        signedInAt: other.createdAt,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("private-ip");
    expect(JSON.stringify(result)).not.toContain(current.token);
  });
  test("cannot revoke another account and revokes only the requested device", async () => {
    const { t, authenticated, other, stranger } = await setup();
    await authenticated.mutation(api.securitySessions.revokeSession, {
      sessionId: stranger._id,
    });
    const read = (id: string) =>
      t.query(components.betterAuth.adapter.findOne, {
        model: "session",
        where: [{ field: "_id", value: id }],
      });
    expect(await read(stranger._id)).not.toBeNull();
    await authenticated.mutation(api.securitySessions.revokeSession, {
      sessionId: other._id,
    });
    expect(await read(other._id)).toBeNull();
    expect(
      (
        await authenticated.query(api.securitySessions.listSessions, {
          paginationOpts,
        })
      ).page
    ).toHaveLength(1);
  });
  test("revoked session cannot use its still-signed cached JWT to manage sessions", async () => {
    const { authenticated, current, other } = await setup();
    await authenticated.mutation(api.securitySessions.revokeSession, {
      sessionId: current._id,
    });
    expect(
      (
        await authenticated.query(api.securitySessions.listSessions, {
          paginationOpts,
        })
      ).page
    ).toEqual([]);
    await expect(
      authenticated.mutation(api.apiKeys.createUserApiKey, {
        name: "Revocation bypass",
      })
    ).rejects.toThrow("User must be authenticated");
    await expect(
      authenticated.action(api.oauthTokens.revokeOAuthConnection, {
        clientId: "teak-chrome",
      })
    ).rejects.toThrow("User must be authenticated");
    await expect(
      authenticated.mutation(api.securitySessions.revokeSession, {
        sessionId: other._id,
      })
    ).rejects.toThrow("Please sign in again");
  });
  test("a forged user/session pairing reveals nothing", async () => {
    const { t, current } = await setup();
    const forged = t.withIdentity({
      issuer: process.env.CONVEX_SITE_URL,
      subject: "stranger",
      sessionId: current._id,
    });
    expect(
      (
        await forged.query(api.securitySessions.listSessions, {
          paginationOpts,
        })
      ).page
    ).toEqual([]);
  });
});

// Failure modes: shadow mode denies a missing/deleted mapping or changes owners;
// enforcement accepts an unmapped/tombstoned account; resolution writes data;
// issuer-derived upload keys strand an existing upload after token changes;
// another owner reads it; old provider-keyed sessions remain reusable.
describe("Permanent identity shadow boundary", () => {
  beforeEach(() => vi.stubEnv("IDENTITY_RESOLVER_ENFORCE", "false"));
  afterEach(() => vi.unstubAllEnvs());

  test("upload finalization denies revoked sessions and enforced missing mappings before storage work", async () => {
    const { t, authenticated, current } = await setup();
    const args = {
      fileKey: "uncommitted/file.png",
      fileName: "file.png",
      fileSize: 128,
      fileType: "image/png",
    };
    vi.stubEnv("IDENTITY_RESOLVER_ENFORCE", "true");
    expect(
      await authenticated.action(
        api["card/uploadCardAction"].finalizeUploadedCard,
        args
      )
    ).toEqual({ success: false, error: "User must be authenticated" });
    await t.run((ctx) =>
      ctx.db.insert("users", {
        teakUserId: "owner",
        email: "owner@example.com",
        emailVerified: true,
      })
    );
    await authenticated.mutation(api.securitySessions.revokeSession, {
      sessionId: current._id,
    });
    expect(
      await authenticated.action(
        api["card/uploadCardAction"].finalizeUploadedCard,
        args
      )
    ).toEqual({ success: false, error: "User must be authenticated" });
    expect(await t.run((ctx) => ctx.db.query("cards").collect())).toEqual([]);
  });

  const privateCard = (t: Awaited<ReturnType<typeof setup>>["t"]) =>
    t.run((ctx) =>
      ctx.db.insert("cards", {
        userId: "owner",
        type: "text",
        content: "Original owner vault",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );

  test("shadow reads preserve the legacy owner without creating a missing mapping", async () => {
    const { t, authenticated } = await setup();
    const id = await privateCard(t);
    expect(await authenticated.query(api.cards.getCard, { id })).toMatchObject({
      userId: "owner",
      content: "Original owner vault",
    });
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual([]);
  });

  test("shadow mode retains existing access while reporting a tombstoned mapping", async () => {
    const { t, authenticated } = await setup();
    const id = await privateCard(t);
    const row = await t.run((ctx) =>
      ctx.db.insert("users", {
        teakUserId: "owner",
        email: "",
        emailVerified: false,
        deletedAt: Date.now(),
      })
    );
    expect(await authenticated.query(api.cards.getCard, { id })).toMatchObject({
      userId: "owner",
    });
    expect(await t.run((ctx) => ctx.db.get(row))).toMatchObject({
      email: "",
      deletedAt: expect.any(Number),
    });
  });

  test("enforcement denies missing mappings and a tombstone, then accepts an active original mapping", async () => {
    vi.stubEnv("IDENTITY_RESOLVER_ENFORCE", "true");
    const { t, authenticated } = await setup();
    const id = await privateCard(t);
    expect(await authenticated.query(api.cards.getCard, { id })).toBeNull();
    const row = await t.run((ctx) =>
      ctx.db.insert("users", {
        teakUserId: "owner",
        email: "owner@example.com",
        emailVerified: false,
      })
    );
    expect(await authenticated.query(api.cards.getCard, { id })).toMatchObject({
      userId: "owner",
    });
    await t.run((ctx) =>
      ctx.db.patch("users", row, {
        deletedAt: Date.now(),
        email: "",
        emailVerified: false,
      })
    );
    expect(await authenticated.query(api.cards.getCard, { id })).toBeNull();
    await expect(
      authenticated.mutation(api.cards.createCard, {
        type: "text",
        content: "Denied tombstone write",
      })
    ).rejects.toThrow("authenticated");
  });

  test("an invalid enforcement flag fails rather than silently enabling shadow mode", async () => {
    vi.stubEnv("IDENTITY_RESOLVER_ENFORCE", "invalid");
    const { t, authenticated } = await setup();
    const id = await privateCard(t);
    await expect(
      authenticated.query(api.cards.getCard, { id })
    ).rejects.toThrow("must be true or false");
  });

  test("uploads keep their owner across token-identifier changes and reject other owners and legacy sessions", async () => {
    const { t, current, stranger } = await setup();
    const args = {
      fileName: "same-video.mp4",
      fileSize: 100_000_000,
      fileLastModified: 123,
    };
    const upload = {
      ...args,
      userId: "owner",
      teakUserId: "owner",
      sourceKey: "test-upload/video.mp4",
      uploadId: "multipart-1",
      fileType: "video/mp4",
      partSize: 8 * 1024 * 1024,
      parts: [],
      status: "uploading" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    const sessionId = await t.run((ctx) =>
      ctx.db.insert("fileUploadSessions", upload)
    );
    for (const tokenIdentifier of ["old-issuer|owner", "new-issuer|owner"]) {
      const client = t.withIdentity({
        issuer: process.env.CONVEX_SITE_URL,
        subject: "owner",
        sessionId: current._id,
        tokenIdentifier,
      });
      expect(
        await client.query(internal.fileUploads.getSessionForUser, {
          sessionId,
        })
      ).toMatchObject({ _id: sessionId, userId: "owner" });
      expect(
        await client.query(internal.fileUploads.findActiveSession, args)
      ).toMatchObject({ _id: sessionId });
    }
    expect(
      await t
        .withIdentity({
          issuer: process.env.CONVEX_SITE_URL,
          subject: "stranger",
          sessionId: stranger._id,
        })
        .query(internal.fileUploads.getSessionForUser, { sessionId })
    ).toBeNull();
    const legacyId = await t.run((ctx) => {
      const { teakUserId: _owner, ...legacy } = upload;
      return ctx.db.insert("fileUploadSessions", {
        ...legacy,
        identityKey: "old-issuer|owner",
      });
    });
    expect(
      await t
        .withIdentity({
          issuer: process.env.CONVEX_SITE_URL,
          subject: "owner",
          sessionId: current._id,
          tokenIdentifier: "old-issuer|owner",
        })
        .query(internal.fileUploads.getSessionForUser, { sessionId: legacyId })
    ).toBeNull();
  });
});
