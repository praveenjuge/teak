import type { MutationCtx } from "../../_generated/server";

interface Backend {
  run: <T>(fn: (ctx: MutationCtx) => Promise<T>) => Promise<T>;
}

// A verified WorkOS owner for the permanent Teak user id: the identity row and
// the canonical provider profile the owner resolver requires.
export const seedWorkosOwner = (t: Backend, teakUserId: string) =>
  t.run(async (ctx) => {
    const workosUserId = `user_${Buffer.from(teakUserId).toString("hex")}`;
    const email = `${teakUserId}@example.test`;
    await ctx.db.insert("users", {
      teakUserId,
      identityOrigin: "workos",
      email,
      emailVerified: true,
      workosUserId,
      workosEmail: email,
      workosEmailVerified: true,
    });
    await ctx.db.insert("workosProfiles", {
      workosUserId,
      teakUserId,
      providerUpdatedAt: "2026-10-08T00:00:00Z",
      revision: 1,
      source: "event",
      profile: {
        email,
        emailVerified: true,
        externalId: teakUserId,
        firstName: null,
        lastName: null,
        profilePictureUrl: null,
      },
    });
    return workosUserId;
  });
