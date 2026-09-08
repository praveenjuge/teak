/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, components } from "./_generated/api";
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
    authenticated: t.withIdentity({ subject: "owner", sessionId: current._id }),
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
