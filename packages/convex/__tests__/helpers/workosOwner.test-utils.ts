import { components } from "../../_generated/api";
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

export const updateComponentUser = (
  t: Backend,
  id: string,
  changes: {
    email?: string;
    emailVerified?: boolean;
    externalId?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    name?: string | null;
    profilePictureUrl?: string | null;
  }
) =>
  t.run(async (ctx) => {
    const current = await ctx.runQuery(
      components.workOSAuthKit.lib.getAuthUser,
      { id }
    );
    if (!current) {
      throw new Error(`Missing component user ${id}`);
    }
    const updatedAt = new Date(Date.parse(current.updatedAt) + 1000);
    await ctx.runMutation(components.workOSAuthKit.lib.onWebhookEvent, {
      event: {
        id: `event_update_${id}_${crypto.randomUUID()}`,
        event: "user.updated",
        createdAt: updatedAt.toISOString(),
        data: {
          object: "user",
          ...current,
          ...changes,
          updatedAt: updatedAt.toISOString(),
        },
      },
    });
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
