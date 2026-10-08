/// <reference types="vite/client" />
import workosTest from "@convex-dev/workos-authkit/test";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { seedComponentUser } from "./__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "./_generated/api";
import schema from "./schema";

// Failure modes: absent or unverified component profile; provider deletion
// despite a surviving component row; cross-vault reads; display fields coming
// from a different profile source.
const modules = import.meta.glob("./**/*.ts");
const getProfile = makeFunctionReference<"query", { workosUserId: string }>(
  "workosProfileRead:getProfile"
);
beforeEach(() => {
  vi.stubEnv("WORKOS_CLIENT_ID", "client_READ");
});
afterEach(() => vi.unstubAllEnvs());
const currentProfile = {
  id: "user_READ",
  email: "current@example.com",
  externalId: "owner-a",
  firstName: "Current",
  lastName: "Person",
  profilePictureUrl: "https://example.com/current.png",
};
async function fixture(
  profile: Partial<Parameters<typeof seedComponentUser>[1]> | null = {}
) {
  const t = convexTest(schema, modules);
  workosTest.register(t);
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      teakUserId: "owner-a",
      workosUserId: "user_READ",
      email: "old@example.com",
      emailVerified: true,
    });
    const own = await ctx.db.insert("cards", {
      userId: "owner-a",
      content: "own",
      type: "text",
      createdAt: 1,
      updatedAt: 1,
    });
    const other = await ctx.db.insert("cards", {
      userId: "owner-b",
      content: "other",
      type: "text",
      createdAt: 1,
      updatedAt: 1,
    });
    return { own, other };
  });
  if (profile !== null) {
    await seedComponentUser(t, { ...currentProfile, ...profile });
  }
  const signed = t.withIdentity({
    subject: "user_READ",
    issuer: "https://api.workos.com/user_management/client_READ",
    sid: "session_READ",
    email_verified: true,
    external_id: "owner-a",
  });
  return { t, signed, ...ids };
}
test("current canonical display and verified ownership return only this vault", async () => {
  const { t, signed, own, other } = await fixture();
  expect(
    await t.query(getProfile, { workosUserId: "user_READ" })
  ).toMatchObject({
    email: "current@example.com",
    emailVerified: true,
    name: "Current Person",
    profilePictureUrl: "https://example.com/current.png",
  });
  expect(await signed.query(api.cards.getCard, { id: own })).toMatchObject({
    content: "own",
    userId: "owner-a",
  });
  expect(await signed.query(api.cards.getCard, { id: other })).toBeNull();
});
test.each(["absent", "unverified", "deleted"])(
  "%s canonical state denies vault access",
  async (variant) => {
    const { t, signed, own } = await fixture(
      variant === "absent" ? null : { emailVerified: variant === "deleted" }
    );
    if (variant === "deleted") {
      // Teak's tombstone wins over a component row that is still present.
      await t.run((ctx) =>
        ctx.db.insert("workosEvents", {
          eventId: "evt_READ_deleted",
          workosUserId: "user_READ",
          type: "user.deleted",
          createdAt: 1,
        })
      );
      expect(
        await t.query(getProfile, { workosUserId: "user_READ" })
      ).toBeNull();
    }
    expect(await signed.query(api.cards.getCard, { id: own })).toBeNull();
    expect(
      await t.query(internal.workosIdentity.resolveWorkosOwner, {
        workosUserId: "user_READ",
        externalId: "owner-a",
        verification: { kind: "connect" },
      })
    ).toMatchObject({ status: "denied" });
  }
);

test("a newer provider update that unverifies the email denies an existing verified session", async () => {
  const { t, signed, own } = await fixture();
  await t.mutation(internal.workosWebhook.syncVerifiedEvent, {
    id: "evt_READ_unverified",
    event: "user.updated",
    createdAt: "2026-10-08T00:00:01.000Z",
    data: {
      object: "user",
      metadata: {},
      ...currentProfile,
      emailVerified: false,
      createdAt: "2026-10-08T00:00:00.000Z",
      updatedAt: "2026-10-08T00:00:01.000Z",
    },
  });
  expect(
    await t.query(getProfile, { workosUserId: "user_READ" })
  ).toMatchObject({ emailVerified: false });
  expect(await signed.query(api.cards.getCard, { id: own })).toBeNull();
});

test.each([
  {
    name: "Imported Full Name",
    firstName: null,
    lastName: null,
    expected: "Imported Full Name",
  },
  {
    name: "Preferred Name",
    firstName: "Split",
    lastName: "Name",
    expected: "Preferred Name",
  },
  { name: null, firstName: "Split", lastName: "Name", expected: "Split Name" },
])(
  "canonical full name takes precedence, retaining split-name fallback ($expected)",
  async ({ name, firstName, lastName, expected }) => {
    const { t } = await fixture({ name, firstName, lastName });
    expect(
      await t.query(getProfile, { workosUserId: "user_READ" })
    ).toMatchObject({ name: expected, externalId: "owner-a" });
  }
);
