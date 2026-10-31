import type { MutationCtx } from "../../_generated/server";

interface Backend {
  run: <T>(fn: (ctx: MutationCtx) => Promise<T>) => Promise<T>;
}

// A verified WorkOS-created owner, the way sign-in leaves one.
export const seedWorkosOwner = async (t: Backend, teakUserId: string) => {
  const workosUserId = `user_${Buffer.from(teakUserId).toString("hex")}`;
  const email = `${teakUserId}@example.test`;
  await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId,
      identityOrigin: "workos",
      email,
      emailVerified: true,
      workosUserId,
    })
  );
  return workosUserId;
};

// Sign-in only ever marks an owner verified; an unverified row is one created
// before that, so tests set it directly.
export const setOwnerVerified = (
  t: Backend,
  workosUserId: string,
  emailVerified: boolean
) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("users")
      .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
      .unique();
    if (!row) {
      throw new Error(`Missing owner for ${workosUserId}`);
    }
    await ctx.db.patch("users", row._id, { emailVerified });
  });
