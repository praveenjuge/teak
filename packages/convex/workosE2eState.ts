import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { initiateAccountDeletion } from "./accountDeletion";
import { isE2EEmail, normalizeE2EEmailDomain } from "./e2eAccounts";
import { readAuthPrimary } from "./env";
import { readCanonicalWorkosProfile } from "./workosProfileRead";

const binding = { email: v.string(), workosUserId: v.string() };

export const orphanOwners = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const domain = normalizeE2EEmailDomain(process.env.E2E_EMAIL_DOMAIN ?? "");
    if (readAuthPrimary() !== "workos") {
      throw new Error("Inactive E2E provider");
    }
    const page = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.gte("email", "e2e-").lt("email", "e2e."))
      .paginate({ cursor, numItems: 20 });
    const owners: { email: string; workosUserId: string }[] = [];
    for (const owner of page.page) {
      const age = Date.now() - owner._creationTime;
      if (
        owner.deletedAt !== undefined ||
        owner.identityOrigin !== "workos" ||
        !owner.workosUserId ||
        !isE2EEmail(owner.email, domain) ||
        age < 30 * 60 * 1000 ||
        age > (90 * 24 * 60 * 60 + 5 * 60) * 1000
      ) {
        continue;
      }
      owners.push({ email: owner.email, workosUserId: owner.workosUserId });
    }
    return { owners, cursor: page.continueCursor, done: page.isDone };
  },
});

export const admission = internalQuery({
  args: {
    credentialFingerprint: v.string(),
    clientId: v.string(),
    environmentId: v.string(),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env.WORKOS_API_KEY;
    const witness = process.env.WORKOS_RECONCILIATION_WITNESS_ID;
    const domain = normalizeE2EEmailDomain(process.env.E2E_EMAIL_DOMAIN ?? "");
    if (
      !(apiKey && witness) ||
      readAuthPrimary() !== "workos" ||
      args.clientId !== process.env.WORKOS_CLIENT_ID ||
      args.environmentId !== process.env.WORKOS_ENVIRONMENT_ID
    ) {
      throw new Error("WorkOS E2E target unavailable");
    }
    const fingerprint = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(apiKey))
      ),
      (byte) => byte.toString(16).padStart(2, "0")
    ).join("");
    if (fingerprint !== args.credentialFingerprint) {
      throw new Error("WorkOS E2E credential changed");
    }
    return { witness, domain };
  },
});

export const ownerByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    assertNamespace(email);
    const owners = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(2);
    if (owners.length > 1) {
      throw new Error("E2E owner conflict");
    }
    const owner = owners[0];
    if (!owner) {
      return null;
    }
    if (
      owner.identityOrigin !== "workos" ||
      !owner.workosUserId ||
      owner.workosEmail !== email
    ) {
      throw new Error("E2E owner binding unavailable");
    }
    const states = await ctx.db
      .query("accountDeletionStates")
      .withIndex("by_userId", (q) => q.eq("userId", owner.teakUserId))
      .take(2);
    if (
      states.length > 1 ||
      (states[0] && states[0].workosUserId !== owner.workosUserId)
    ) {
      throw new Error("E2E deletion binding conflict");
    }
    return {
      userId: owner.teakUserId,
      workosUserId: owner.workosUserId,
      pending: states.length === 1,
      completed: owner.deletedAt !== undefined && states.length === 0,
    };
  },
});
export function assertNamespace(email: string) {
  const domain = normalizeE2EEmailDomain(process.env.E2E_EMAIL_DOMAIN ?? "");
  if (
    readAuthPrimary() !== "workos" ||
    email !== email.trim().toLowerCase() ||
    !isE2EEmail(email, domain)
  ) {
    throw new Error("Invalid WorkOS E2E namespace or inactive provider");
  }
}

// Read real webhook-derived authority; provisioning must not synthesize events.
export const readiness = internalQuery({
  args: binding,
  handler: async (ctx, { email, workosUserId }) => {
    assertNamespace(email);
    const profile = await readCanonicalWorkosProfile(ctx, workosUserId);
    const owners = await ctx.db
      .query("users")
      .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
      .take(2);
    const owner = owners.length === 1 ? owners[0] : null;
    if (
      owner?.identityOrigin !== "workos" ||
      owner.deletedAt !== undefined ||
      owner.email !== email ||
      profile?.teakUserId !== owner.teakUserId ||
      profile.profile?.email !== email ||
      profile.profile.emailVerified !== true ||
      (profile.profile.externalId !== null &&
        profile.profile.externalId !== owner.teakUserId)
    ) {
      return null;
    }
    const deleting = await ctx.db
      .query("accountDeletionStates")
      .withIndex("by_userId", (q) => q.eq("userId", owner.teakUserId))
      .first();
    return deleting ? null : { teakUserId: owner.teakUserId };
  },
});

// Only the protected Management API adapter supplies provider creation evidence.
// The mutation independently rechecks namespace, immutable binding and authority.
export const beginCleanup = internalMutation({
  args: {
    ...binding,
    providerCreatedAt: v.number(),
    orphan: v.boolean(),
    clientId: v.string(),
    environmentId: v.string(),
    credentialFingerprint: v.string(),
  },
  returns: v.null(),
  handler: async (
    ctx,
    { email, workosUserId, providerCreatedAt, orphan, ...pins }
  ) => {
    // Nested query shares this mutation transaction: rotated credentials cannot admit deletion.
    await ctx.runQuery(internal.workosE2eState.admission, pins);
    assertNamespace(email);
    const age = Date.now() - providerCreatedAt;
    const maximum = orphan ? 90 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const minimum = orphan ? 30 * 60 * 1000 : -5 * 60 * 1000;
    if (
      !Number.isFinite(age) ||
      age < minimum ||
      age > maximum + 5 * 60 * 1000
    ) {
      throw new Error("E2E account is outside cleanup age bounds");
    }
    const owners = await ctx.db
      .query("users")
      .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
      .take(2);
    const owner = owners.length === 1 ? owners[0] : null;
    if (
      owner?.identityOrigin !== "workos" ||
      owner.email !== email ||
      owner.workosEmail !== email
    ) {
      throw new Error("E2E owner binding unavailable");
    }
    const existing = await ctx.db
      .query("accountDeletionStates")
      .withIndex("by_userId", (q) => q.eq("userId", owner.teakUserId))
      .take(2);
    if (
      existing.length > 1 ||
      (existing[0] && existing[0].workosUserId !== workosUserId)
    ) {
      throw new Error("E2E deletion binding conflict");
    }
    if (existing.length === 1 || owner.deletedAt !== undefined) {
      return null;
    }
    const profile = await readCanonicalWorkosProfile(ctx, workosUserId);
    if (
      profile?.teakUserId !== owner.teakUserId ||
      profile.profile?.email !== email ||
      profile.profile.emailVerified !== true ||
      (profile.profile.externalId !== null &&
        profile.profile.externalId !== owner.teakUserId)
    ) {
      throw new Error("E2E canonical authority unavailable");
    }
    return initiateAccountDeletion(ctx, owner, "workos");
  },
});
