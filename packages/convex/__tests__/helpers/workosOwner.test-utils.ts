import { components, internal } from "../../_generated/api";
import type { MutationCtx } from "../../_generated/server";

interface Backend {
  run: <T>(fn: (ctx: MutationCtx) => Promise<T>) => Promise<T>;
}

export const seedComponentUser = (
  t: Backend,
  user: {
    id: string;
    email: string;
    emailVerified?: boolean;
    externalId?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    name?: string | null;
    profilePictureUrl?: string | null;
  }
) =>
  t.run((ctx) =>
    ctx.runMutation(components.workOSAuthKit.lib.onWebhookEvent, {
      event: {
        id: `event_seed_${user.id}_${crypto.randomUUID()}`,
        event: "user.created",
        createdAt: "2026-10-08T00:00:00.000Z",
        data: {
          object: "user",
          metadata: {},
          createdAt: "2026-10-08T00:00:00.000Z",
          updatedAt: "2026-10-08T00:00:00.000Z",
          emailVerified: true,
          ...user,
        },
      },
    })
  );

interface ComponentUserChanges {
  email?: string;
  emailVerified?: boolean;
  externalId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  profilePictureUrl?: string | null;
}

// Builds the next `user.updated` event for a stored component profile.
const nextUserUpdate = async (
  ctx: MutationCtx,
  id: string,
  changes: ComponentUserChanges
) => {
  const current = await ctx.runQuery(components.workOSAuthKit.lib.getAuthUser, {
    id,
  });
  if (!current) {
    throw new Error(`Missing component user ${id}`);
  }
  const updatedAt = new Date(Date.parse(current.updatedAt) + 1000);
  return {
    id: `event_update_${id}_${crypto.randomUUID()}`,
    event: "user.updated" as const,
    createdAt: updatedAt.toISOString(),
    data: {
      object: "user",
      ...current,
      ...changes,
      updatedAt: updatedAt.toISOString(),
    },
  };
};

// Changes only the AuthKit component's copy of the profile.
export const updateComponentUser = (
  t: Backend,
  id: string,
  changes: ComponentUserChanges
) =>
  t.run(async (ctx) => {
    await ctx.runMutation(components.workOSAuthKit.lib.onWebhookEvent, {
      event: await nextUserUpdate(ctx, id, changes),
    });
  });

// Delivers the update through Teak's webhook, so the owner's mapping row
// follows it the way it does in production.
export const deliverWorkosUserUpdate = (
  t: Backend,
  id: string,
  changes: ComponentUserChanges
) =>
  t.run(async (ctx) => {
    await ctx.runMutation(
      internal.workosWebhook.syncVerifiedEvent,
      await nextUserUpdate(ctx, id, changes)
    );
  });

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
  await seedComponentUser(t, {
    id: workosUserId,
    email,
    externalId: teakUserId,
  });
  return workosUserId;
};
