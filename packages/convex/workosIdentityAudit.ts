import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { readComponentUser } from "./securitySessions";
import { normalizeIdentityEmail } from "./userIdentityTable";

// Read-only parity check before the WorkOS AuthKit component becomes the
// profile source. It compares each linked owner with the component's user row
// and Teak's own profile copy, and reports only IDs and mismatch kinds: never
// an email, name or token. Run it page by page with `bunx convex run`.

const issueKind = v.union(
  v.literal("missing_component_user"),
  v.literal("deleted_but_component_user_present"),
  v.literal("email_mismatch"),
  v.literal("email_verified_mismatch"),
  v.literal("profile_mismatch")
);

const sameName = (
  left: string | null | undefined,
  right: string | null | undefined
) => (left ?? null) === (right ?? null);

export const page = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    checked: v.number(),
    unlinked: v.number(),
    issues: v.array(
      v.object({
        teakUserId: v.string(),
        workosUserId: v.string(),
        kinds: v.array(issueKind),
      })
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query("users").paginate(args.paginationOpts);
    let unlinked = 0;
    const issues: {
      teakUserId: string;
      workosUserId: string;
      kinds: (typeof issueKind.type)[];
    }[] = [];
    for (const owner of result.page) {
      if (!owner.workosUserId) {
        unlinked += 1;
        continue;
      }
      const kinds: (typeof issueKind.type)[] = [];
      const component = await readComponentUser(ctx, owner.workosUserId);
      const deleted =
        owner.deletedAt !== undefined || owner.workosDeletedAt !== undefined;
      if (deleted) {
        if (component) {
          kinds.push("deleted_but_component_user_present");
        }
      } else if (component) {
        if (
          normalizeIdentityEmail(component.email) !==
          normalizeIdentityEmail(owner.workosEmail ?? owner.email)
        ) {
          kinds.push("email_mismatch");
        }
        if (
          component.emailVerified !==
          (owner.workosEmailVerified ?? owner.emailVerified)
        ) {
          kinds.push("email_verified_mismatch");
        }
        const copy = (
          await ctx.db
            .query("workosProfiles")
            .withIndex("by_workosUserId", (q) =>
              q.eq("workosUserId", owner.workosUserId as string)
            )
            .take(1)
        )[0]?.profile;
        if (
          copy &&
          !(
            normalizeIdentityEmail(copy.email) ===
              normalizeIdentityEmail(component.email) &&
            copy.emailVerified === component.emailVerified &&
            sameName(copy.firstName, component.firstName) &&
            sameName(copy.lastName, component.lastName) &&
            sameName(copy.profilePictureUrl, component.profilePictureUrl)
          )
        ) {
          kinds.push("profile_mismatch");
        }
      } else {
        kinds.push("missing_component_user");
      }
      if (kinds.length > 0) {
        issues.push({
          teakUserId: owner.teakUserId,
          workosUserId: owner.workosUserId,
          kinds,
        });
      }
    }
    return {
      checked: result.page.length,
      unlinked,
      issues,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

// Open quarantine receipts by reason. Each one must be understood before the
// component becomes the profile source, because several of them deny sign-in.
export const openQuarantine = internalQuery({
  args: {},
  returns: v.object({
    total: v.number(),
    byReason: v.record(v.string(), v.number()),
    truncated: v.boolean(),
  }),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("migrationQuarantine")
      .withIndex("by_unresolved", (q) => q.eq("resolvedAt", undefined))
      .take(1001);
    const byReason: Record<string, number> = {};
    for (const row of rows.slice(0, 1000)) {
      byReason[row.reason] = (byReason[row.reason] ?? 0) + 1;
    }
    return {
      total: Math.min(rows.length, 1000),
      byReason,
      truncated: rows.length > 1000,
    };
  },
});
