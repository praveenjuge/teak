import { v } from "convex/values";
import { components } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalQuery, type QueryCtx } from "../_generated/server";
import {
  readAccountChangesPaused,
  readAuthPrimary,
  readSignupsDisabled,
} from "../env";
import { readCanonicalWorkosProfile } from "../workosProfileRead";

export const rollbackSummary = v.object({
  teakUserId: v.string(),
  workosUserId: v.union(v.string(), v.null()),
  deniedDeleted: v.boolean(),
  invalidateLegacyPassword: v.boolean(),
  markSameEmailVerified: v.boolean(),
  emailConflict: v.boolean(),
  canonicalProfileUnavailable: v.boolean(),
  verificationDowngradeRequired: v.boolean(),
  workosOriginWithoutLegacyUser: v.boolean(),
  promoteDeletion: v.boolean(),
  blockers: v.array(v.string()),
});
export function assertRollbackMode(args: {
  environmentId: string;
  clientId: string;
}) {
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
}
// One classification shared by the read-only plan and transactional writer.
export async function inspectRollbackOwner(
  ctx: Pick<QueryCtx, "db" | "runQuery">,
  row: Doc<"users">
) {
  const legacy = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [{ field: "_id", value: row.teakUserId }],
  })) as { _id: string; email: string; emailVerified: boolean } | null;
  const accounts = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "account",
    where: [
      { field: "userId", value: row.teakUserId },
      { field: "providerId", value: "credential", connector: "AND" },
    ],
    paginationOpts: { cursor: null, numItems: 2 },
  });
  if (!accounts.isDone || accounts.page.length > 1) {
    throw new Error(
      "Ambiguous legacy credential requires manual rollback review"
    );
  }
  const credential = accounts.page[0] as
    | { _id: string; password?: string | null }
    | undefined;
  const deleting = await ctx.db
    .query("accountDeletionStates")
    .withIndex("by_userId", (q) => q.eq("userId", row.teakUserId))
    .first();
  const owners = await ctx.db
    .query("users")
    .withIndex("by_teakUserId", (q) => q.eq("teakUserId", row.teakUserId))
    .take(2);
  const mappings = row.workosUserId
    ? await ctx.db
        .query("users")
        .withIndex("by_workosUserId", (q) =>
          q.eq("workosUserId", row.workosUserId)
        )
        .take(2)
    : [];
  const providerId = row.workosUserId;
  const rawProfiles = providerId
    ? await ctx.db
        .query("workosProfiles")
        .withIndex("by_workosUserId", (q) => q.eq("workosUserId", providerId))
        .take(2)
    : [];
  const receipt = row.workosUserId
    ? await ctx.db
        .query("workosEvents")
        .withIndex("by_workosUserId_and_type", (q) =>
          q.eq("workosUserId", row.workosUserId).eq("type", "user.deleted")
        )
        .first()
    : null;
  const raw = rawProfiles.length === 1 ? rawProfiles[0] : null;
  let unresolvedIdentity = false;
  if (row.workosUserId) {
    for (const reason of [
      "external_id_mismatch",
      "link_conflict",
      "duplicate_mapping",
      "equal_timestamp_conflict",
    ] as const) {
      const conflict = await ctx.db
        .query("migrationQuarantine")
        .withIndex("by_workosUserId_and_reason_and_resolvedAt", (q) =>
          q
            .eq("workosUserId", row.workosUserId)
            .eq("reason", reason)
            .eq("resolvedAt", undefined)
        )
        .first();
      if (conflict) {
        unresolvedIdentity = true;
      }
    }
  }
  const providerDeletionAt =
    row.workosDeletedAt ?? raw?.deletedAt ?? receipt?.createdAt;
  const deniedDeleted =
    row.deletedAt !== undefined ||
    Boolean(deleting) ||
    providerDeletionAt !== undefined;
  const promoteDeletion =
    row.deletedAt === undefined && providerDeletionAt !== undefined;
  const profile = row.workosUserId
    ? await readCanonicalWorkosProfile(ctx, row.workosUserId)
    : null;
  const normalize = (email: string) => email.trim().toLowerCase();
  const sameEmail = Boolean(
    legacy &&
      profile?.profile &&
      normalize(legacy.email) === normalize(profile.profile.email)
  );
  const validIdentity =
    profile?.teakUserId === row.teakUserId &&
    (profile.profile?.externalId === null ||
      profile.profile?.externalId === row.teakUserId);
  const emailConflict =
    !deniedDeleted && Boolean(legacy && profile?.profile && !sameEmail);
  const canonicalProfileUnavailable =
    !deniedDeleted && Boolean(row.workosUserId && !profile);
  const verificationDowngradeRequired =
    !deniedDeleted &&
    Boolean(
      legacy?.emailVerified &&
        profile?.profile &&
        !profile.profile.emailVerified
    );
  const workosOriginWithoutLegacyUser =
    row.identityOrigin === "workos" && !legacy;
  const blockers: string[] = [];
  if (owners.length !== 1 || (row.workosUserId && mappings.length !== 1)) {
    blockers.push("ambiguous_owner_mapping");
  }
  if (
    rawProfiles.length > 1 ||
    (raw?.teakUserId !== undefined && raw.teakUserId !== row.teakUserId)
  ) {
    blockers.push("canonical_identity_conflict");
  }
  if (
    unresolvedIdentity ||
    (raw?.profile?.externalId !== undefined &&
      raw.profile.externalId !== null &&
      raw.profile.externalId !== row.teakUserId) ||
    (receipt?.externalId !== undefined &&
      receipt.externalId !== null &&
      receipt.externalId !== row.teakUserId)
  ) {
    blockers.push("canonical_identity_conflict");
  }
  if (
    providerDeletionAt !== undefined &&
    !Number.isFinite(providerDeletionAt)
  ) {
    blockers.push("invalid_deletion_evidence");
  }
  if (!deniedDeleted) {
    if (!legacy) {
      blockers.push("missing_legacy_user");
    }
    if (!row.workosUserId) {
      blockers.push("missing_workos_mapping");
    }
    if (canonicalProfileUnavailable) {
      blockers.push("canonical_profile_unavailable");
    }
    if (profile && !validIdentity) {
      blockers.push("canonical_identity_conflict");
    }
    if (emailConflict) {
      blockers.push("email_conflict");
    }
    if (verificationDowngradeRequired) {
      blockers.push("verification_downgrade");
    }
  }
  return {
    row,
    legacy,
    credential,
    providerDeletionAt,
    summary: {
      teakUserId: row.teakUserId,
      workosUserId: row.workosUserId ?? null,
      deniedDeleted,
      promoteDeletion,
      blockers,
      invalidateLegacyPassword: Boolean(
        row.workosUserId && credential?.password
      ),
      markSameEmailVerified:
        !deniedDeleted &&
        Boolean(
          validIdentity &&
            profile?.providerUpdatedAt &&
            profile.profile?.emailVerified &&
            sameEmail &&
            !legacy?.emailVerified
        ),
      emailConflict,
      canonicalProfileUnavailable,
      verificationDowngradeRequired,
      workosOriginWithoutLegacyUser,
    },
  };
}
export const page = internalQuery({
  args: {
    environmentId: v.string(),
    clientId: v.string(),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({
    owners: v.array(rollbackSummary),
    done: v.boolean(),
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    assertRollbackMode(args);
    const result = await ctx.db
      .query("users")
      .paginate({ cursor: args.cursor, numItems: 20 });
    const owners: Awaited<
      ReturnType<typeof inspectRollbackOwner>
    >["summary"][] = [];
    for (const row of result.page) {
      owners.push((await inspectRollbackOwner(ctx, row)).summary);
    }
    return {
      owners,
      done: result.isDone,
      cursor: result.isDone ? null : result.continueCursor,
    };
  },
});
