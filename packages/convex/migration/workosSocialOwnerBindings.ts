import { type Infer, v } from "convex/values";
import { components, internal } from "../_generated/api";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { readAccountChangesPaused } from "../env";
import {
  assertImportBinding,
  assertImportLease,
  importLeaseOwner,
  importLeasePins,
} from "./workosImportLease";

export const socialOwnerBindingPins = {
  environmentId: "environment_01KBYSVN9RVQ1JXACG3MDMQZGA",
  clientId: "client_01KBYSVNVDV2G39REZFGF0K7GD",
  cloudUrl: "https://reminiscent-kangaroo-59.convex.cloud",
  siteUrl: "https://reminiscent-kangaroo-59.convex.site",
} as const;
export const socialOwnerPairs = {
  google: {
    providerId: "user_01KBYSY1G25F953P7KCEJ2PNFB",
    ownerId: "k9720d6bcw54v5392g06e9m46x7w8cc2",
    provider: "google",
    emailHash:
      "9287803e036e5bf3244639800d3721a6707c58397325d4d9d64dc94fc450acc7",
    subjectHash:
      "8cd6229a7e9665eb9bf43df734f5208946ae99fdb9f947cb13f95443edb160cb",
  },
  apple: {
    providerId: "user_01M40KZ1P180RKWWXK60B1HCE6",
    ownerId: "k97cq574t8rvwxj130b1tx6qps871bxn",
    provider: "apple",
    emailHash:
      "b6822cd74d056655a9fb5d2ebf81376e05bcacc38f2693ae99fd2b5171d68394",
    subjectHash:
      "2f88a3f3f7b686f9b80bad00e49331eee957493f6925c6ee3cc3a75c9c5404a0",
  },
} as const;
const pairValidator = v.union(v.literal("google"), v.literal("apple"));
const observation = v.object({
  id: v.string(),
  externalId: v.union(v.string(), v.null()),
  emailHash: v.string(),
  emailVerified: v.boolean(),
  subjectHash: v.string(),
});
export interface SocialOwnerPair {
  emailHash: string;
  ownerId: string;
  provider: string;
  providerId: string;
  subjectHash: string;
}
type Observation = Infer<typeof observation>;
const args = { ...importLeasePins, pair: pairValidator, observed: observation };
async function hash(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function binding(
  pins: { environmentId: string; clientId: string; apiKeyFingerprint: string },
  requirePause = true
) {
  await assertImportBinding(pins);
  if (
    pins.environmentId !== socialOwnerBindingPins.environmentId ||
    pins.clientId !== socialOwnerBindingPins.clientId ||
    process.env.CONVEX_CLOUD_URL !== socialOwnerBindingPins.cloudUrl ||
    process.env.CONVEX_SITE_URL !== socialOwnerBindingPins.siteUrl ||
    (requirePause && !readAccountChangesPaused())
  ) {
    throw new Error("Social owner repair requires pinned paused development");
  }
}
export const admission = internalQuery({
  args: importLeasePins,
  returns: v.null(),
  handler: async (ctx, input) => {
    await binding(input, false);
    const state: { ready: boolean } = await ctx.runQuery(
      internal.migration.workosImportLease.quiescence,
      input
    );
    if (!state.ready) {
      throw new Error("Social owner repair requires quiescent importer");
    }
    return null;
  },
});
export const recoveryAdmission = internalQuery({
  args: importLeasePins,
  returns: v.null(),
  handler: async (_ctx, input) => {
    // Recovery must inspect the existing lease, including an active one.
    await binding(input);
    return null;
  },
});

// This core is exercised against real component rows. Only the registered
// boundaries select authority, from the fixed two-pair approval manifest.
export async function checkSocialOwnerSource(
  ctx: QueryCtx | MutationCtx,
  pair: SocialOwnerPair,
  observed: Observation
) {
  if (
    observed.id !== pair.providerId ||
    observed.emailHash !== pair.emailHash ||
    observed.subjectHash !== pair.subjectHash ||
    !observed.emailVerified ||
    (observed.externalId !== null && observed.externalId !== pair.ownerId)
  ) {
    throw new Error("Approved social provider proof changed");
  }
  const owners = await ctx.db
    .query("users")
    .withIndex("by_teakUserId", (q) => q.eq("teakUserId", pair.ownerId))
    .take(2);
  const owner = owners[0];
  if (
    owners.length !== 1 ||
    !owner ||
    owner.deletedAt !== undefined ||
    owner.workosDeletedAt !== undefined ||
    !owner.emailVerified ||
    owner.email !== owner.email.trim().toLowerCase() ||
    (await hash(owner.email)) !== pair.emailHash ||
    (owner.workosUserId !== undefined && owner.workosUserId !== pair.providerId)
  ) {
    throw new Error("Approved social owner changed");
  }
  const addresses = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", owner.email))
    .take(2);
  const mappings = await ctx.db
    .query("users")
    .withIndex("by_workosUserId", (q) => q.eq("workosUserId", pair.providerId))
    .take(2);
  if (
    addresses.length !== 1 ||
    mappings.some((row) => row._id !== owner._id) ||
    mappings.length > 1
  ) {
    throw new Error("Ambiguous social owner mapping");
  }
  const users: {
    page: { _id: string; email: string; emailVerified: boolean }[];
    isDone: boolean;
  } = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "user",
    paginationOpts: { cursor: null, numItems: 1000 },
  });
  const accounts: {
    page: { userId: string; providerId: string; accountId: string }[];
    isDone: boolean;
  } = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "account",
    paginationOpts: { cursor: null, numItems: 1000 },
  });
  if (!(users.isDone && accounts.isDone)) {
    throw new Error("Social source scan incomplete");
  }
  const legacy = users.page.filter((row) => row._id === pair.ownerId);
  const emails = users.page.filter(
    (row) => row.email.trim().toLowerCase() === owner.email
  );
  const ownAccounts = accounts.page.filter(
    (row) => row.userId === pair.ownerId && row.providerId === pair.provider
  );
  if (
    legacy.length !== 1 ||
    emails.length !== 1 ||
    emails[0]._id !== pair.ownerId ||
    !legacy[0].emailVerified ||
    legacy[0].email.trim().toLowerCase() !== owner.email ||
    ownAccounts.length !== 1 ||
    (await hash(ownAccounts[0].accountId)) !== pair.subjectHash
  ) {
    throw new Error("Approved legacy social proof changed");
  }
  if (
    accounts.page.filter(
      (row) =>
        row.providerId === pair.provider &&
        row.accountId === ownAccounts[0].accountId
    ).length !== 1
  ) {
    throw new Error("Duplicate legacy social subject");
  }
  const profiles = await ctx.db
    .query("workosProfiles")
    .withIndex("by_workosUserId", (q) => q.eq("workosUserId", pair.providerId))
    .take(2);
  const deletion = await ctx.db
    .query("accountDeletionStates")
    .withIndex("by_userId", (q) => q.eq("userId", pair.ownerId))
    .first();
  const deletedEvent = await ctx.db
    .query("workosEvents")
    .withIndex("by_workosUserId_and_type", (q) =>
      q.eq("workosUserId", pair.providerId).eq("type", "user.deleted")
    )
    .first();
  const quarantines = await ctx.db
    .query("migrationQuarantine")
    .withIndex("by_unresolved", (q) => q.eq("resolvedAt", undefined))
    .take(101);
  const runs = await ctx.db.query("workosReconciliationRuns").take(101);
  if (
    profiles.length > 1 ||
    profiles.some(
      (row) =>
        row.deletedAt !== undefined ||
        (row.teakUserId !== undefined && row.teakUserId !== pair.ownerId)
    ) ||
    deletion ||
    deletedEvent ||
    quarantines.length === 101 ||
    quarantines.some(
      (row) =>
        row.workosUserId === pair.providerId ||
        row.teakUserId === pair.ownerId ||
        row.email.trim().toLowerCase() === owner.email
    ) ||
    runs.length === 101 ||
    runs.some((run) => run.phase !== "complete" && run.phase !== "failed")
  ) {
    throw new Error("Social owner repair has unresolved lifecycle evidence");
  }
  return owner;
}
export const inspect = internalQuery({
  args,
  returns: v.object({ sourceVersion: v.string(), mapped: v.boolean() }),
  handler: async (ctx, input) => {
    await binding(input, false);
    const pair = socialOwnerPairs[input.pair];
    const owner = await checkSocialOwnerSource(ctx, pair, input.observed);
    const sourceVersion: string = await ctx.runQuery(
      internal.migration.workosImportSource.version,
      {
        environmentId: input.environmentId,
        clientId: input.clientId,
        apiKeyFingerprint: input.apiKeyFingerprint,
        teakUserId: pair.ownerId,
      }
    );
    return { sourceVersion, mapped: owner.workosUserId === pair.providerId };
  },
});
interface WriterInput {
  apiKeyFingerprint: string;
  clientId: string;
  environmentId: string;
  generation: number;
  holder: string;
  observed: Observation;
  sourceVersion: string;
}
export async function prepareSocialOwnerBinding(
  ctx: MutationCtx,
  pair: SocialOwnerPair,
  input: WriterInput
) {
  const lease = await assertImportLease(ctx, input);
  if (lease.runId !== (await hash(JSON.stringify(socialOwnerPairs)))) {
    throw new Error("Unrelated importer lease cannot bind social owners");
  }
  const owner = await checkSocialOwnerSource(ctx, pair, input.observed);
  const pins = {
    environmentId: input.environmentId,
    clientId: input.clientId,
    apiKeyFingerprint: input.apiKeyFingerprint,
  };
  const before: string = await ctx.runQuery(
    internal.migration.workosImportSource.version,
    { ...pins, teakUserId: pair.ownerId }
  );
  if (before !== input.sourceVersion) {
    throw new Error("Social source changed before mapping");
  }
  const linked = await ctx.runMutation(internal.workosUsers.linkWorkosUser, {
    workosUserId: pair.providerId,
    externalId: input.observed.externalId,
    email: owner.email,
    emailVerified: true,
    source: "import",
  });
  if (linked.status !== "linked" || linked.teakUserId !== pair.ownerId) {
    throw new Error("Exact social owner link refused");
  }
  const sourceVersion: string = await ctx.runQuery(
    internal.migration.workosImportSource.version,
    { ...pins, teakUserId: pair.ownerId }
  );
  await ctx.runMutation(internal.migration.workosImportLease.beginRemote, {
    ...pins,
    holder: input.holder,
    generation: input.generation,
    teakUserId: pair.ownerId,
    sourceVersion,
    kind: "update",
  });
  return { sourceVersion };
}
export const prepare = internalMutation({
  args: { ...args, ...importLeaseOwner, sourceVersion: v.string() },
  returns: v.object({ sourceVersion: v.string() }),
  handler: async (ctx, input) => {
    await binding(input);
    return prepareSocialOwnerBinding(ctx, socialOwnerPairs[input.pair], input);
  },
});
export async function acknowledgeSocialOwnerBinding(
  ctx: MutationCtx,
  pair: SocialOwnerPair,
  input: WriterInput
) {
  const lease = await assertImportLease(ctx, input, true);
  if (lease.runId !== (await hash(JSON.stringify(socialOwnerPairs)))) {
    throw new Error(
      "Unrelated importer lease cannot acknowledge social owners"
    );
  }
  const owner = await checkSocialOwnerSource(ctx, pair, input.observed);
  if (
    owner.workosUserId !== pair.providerId ||
    input.observed.externalId !== pair.ownerId ||
    lease.remoteIntent?.kind !== "update"
  ) {
    throw new Error("Social remote postcondition changed");
  }
  const pins = {
    environmentId: input.environmentId,
    clientId: input.clientId,
    apiKeyFingerprint: input.apiKeyFingerprint,
  };
  const current: string = await ctx.runQuery(
    internal.migration.workosImportSource.version,
    { ...pins, teakUserId: pair.ownerId }
  );
  if (current !== input.sourceVersion) {
    throw new Error("Social source changed during provider update");
  }
  await ctx.runMutation(
    internal.migration.workosImportLease.acknowledgeRemote,
    {
      ...pins,
      holder: input.holder,
      generation: input.generation,
      teakUserId: pair.ownerId,
      sourceVersion: current,
    }
  );
  return null;
}
export const acknowledge = internalMutation({
  args: { ...args, ...importLeaseOwner, sourceVersion: v.string() },
  returns: v.null(),
  handler: async (ctx, input) => {
    await binding(input);
    return acknowledgeSocialOwnerBinding(
      ctx,
      socialOwnerPairs[input.pair],
      input
    );
  },
});
