import { v } from "convex/values";
import { components } from "../_generated/api";
import { internalQuery } from "../_generated/server";
import {
  readAccountChangesPaused,
  readAuthPrimary,
  readSignupsDisabled,
} from "../env";
import { readCanonicalWorkosProfile } from "../workosProfileRead";

// Read-only proposal. Credential invalidation requires a separately approved
// writer and activation; no auth flag or account row changes here.
export const page = internalQuery({
  args: {
    environmentId: v.string(),
    clientId: v.string(),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({
    owners: v.array(
      v.object({
        teakUserId: v.string(),
        workosUserId: v.union(v.string(), v.null()),
        deniedDeleted: v.boolean(),
        invalidateLegacyPassword: v.boolean(),
        markSameEmailVerified: v.boolean(),
        emailConflict: v.boolean(),
        canonicalProfileUnavailable: v.boolean(),
        verificationDowngradeRequired: v.boolean(),
        workosOriginWithoutLegacyUser: v.boolean(),
      })
    ),
    done: v.boolean(),
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    if (
      args.environmentId !== process.env.WORKOS_ENVIRONMENT_ID ||
      args.clientId !== process.env.WORKOS_CLIENT_ID ||
      readAuthPrimary() !== "workos" ||
      !readAccountChangesPaused() ||
      !readSignupsDisabled()
    ) {
      throw new Error(
        "Rollback planning requires pinned paused WorkOS deployment with frozen signups"
      );
    }
    const result = await ctx.db
      .query("users")
      .paginate({ cursor: args.cursor, numItems: 20 });
    const owners: {
      teakUserId: string;
      workosUserId: string | null;
      deniedDeleted: boolean;
      invalidateLegacyPassword: boolean;
      markSameEmailVerified: boolean;
      emailConflict: boolean;
      canonicalProfileUnavailable: boolean;
      verificationDowngradeRequired: boolean;
      workosOriginWithoutLegacyUser: boolean;
    }[] = [];
    for (const row of result.page) {
      const legacy = (await ctx.runQuery(
        components.betterAuth.adapter.findOne,
        { model: "user", where: [{ field: "_id", value: row.teakUserId }] }
      )) as { email: string; emailVerified: boolean } | null;
      const accounts = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: "account",
          where: [
            { field: "userId", value: row.teakUserId },
            { field: "providerId", value: "credential", connector: "AND" },
          ],
          paginationOpts: { cursor: null, numItems: 2 },
        }
      );
      if (!accounts.isDone || accounts.page.length > 1) {
        throw new Error(
          "Ambiguous legacy credential requires manual rollback review"
        );
      }
      const deleting = await ctx.db
        .query("accountDeletionStates")
        .withIndex("by_userId", (q) => q.eq("userId", row.teakUserId))
        .first();
      const profile = row.workosUserId
        ? await readCanonicalWorkosProfile(ctx, row.workosUserId)
        : null;
      const normalized = (email: string) => email.trim().toLowerCase();
      const sameEmail =
        legacy &&
        profile?.profile &&
        normalized(legacy.email) === normalized(profile.profile.email);
      const verified =
        profile?.deletedAt === undefined &&
        profile?.teakUserId === row.teakUserId &&
        (profile.profile?.externalId === null ||
          profile.profile?.externalId === row.teakUserId) &&
        profile?.providerUpdatedAt !== undefined &&
        profile?.profile?.emailVerified === true;
      const credential = accounts.page[0] as
        | { password?: string | null }
        | undefined;
      owners.push({
        teakUserId: row.teakUserId,
        workosUserId: row.workosUserId ?? null,
        deniedDeleted: row.deletedAt !== undefined || Boolean(deleting),
        invalidateLegacyPassword: Boolean(
          row.workosUserId && credential?.password
        ),
        markSameEmailVerified: Boolean(
          row.deletedAt === undefined &&
            !deleting &&
            verified &&
            sameEmail &&
            !legacy?.emailVerified
        ),
        emailConflict: Boolean(legacy && profile?.profile && !sameEmail),
        canonicalProfileUnavailable: Boolean(
          row.deletedAt === undefined &&
            !deleting &&
            row.workosUserId &&
            !profile
        ),
        verificationDowngradeRequired: Boolean(
          row.deletedAt === undefined &&
            !deleting &&
            legacy?.emailVerified &&
            profile?.profile &&
            !profile.profile.emailVerified
        ),
        workosOriginWithoutLegacyUser:
          row.identityOrigin === "workos" && !legacy,
      });
    }
    return {
      owners,
      done: result.isDone,
      cursor: result.isDone ? null : result.continueCursor,
    };
  },
});
