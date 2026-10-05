import { v } from "convex/values";
import { components } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import {
  currentWorkosDeletionTarget,
  sameWorkosDeletionTarget,
} from "../workosDeletionCompletion";
import { assertImportBinding, importLeasePins } from "./workosImportLease";

// One retained unknown-owner fixture, independently matched to the original
// Phase 3 authenticated webhook proof. This is not a general conflict resolver.
export const readinessFixture = {
  environmentId: "environment_01KBYSVN9RVQ1JXACG3MDMQZGA",
  clientId: "client_01KBYSVNVDV2G39REZFGF0K7GD",
  cloudUrl: "https://reminiscent-kangaroo-59.convex.cloud",
  siteUrl: "https://reminiscent-kangaroo-59.convex.site",
  workosUserId: "user_01M43GS9SZBA0JZP0MC6SK7EX2",
  marker: "phase3-http-1791119631739570000",
  createdEventId: "event_01M43GS9THTK7FTPPGWJNDRRTJ",
  createdEventAt: 1_791_119_632_209,
  quarantineAt: 1_791_119_632_744,
  emailSha256:
    "32ed00820ca957fbf8de01df03ca0818fc47ea10417a7588d149472a2ea907a4",
} as const;

async function emailHash(email: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email))
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
const refused = () =>
  new Error(
    "Controlled readiness fixture retirement proof is incomplete or changed"
  );

// An internal operator mutation, intentionally never scheduled or called by
// HTTP ingress. Activation requires separate reviewed fixture-cleanup approval.
export const resolveRetiredFixture = internalMutation({
  args: {
    ...importLeasePins,
    quarantineId: v.id("migrationQuarantine"),
    deletedQuarantineId: v.id("migrationQuarantine"),
    deletedQuarantineCreatedAt: v.number(),
    deletedEventId: v.string(),
    deletedEventAt: v.number(),
  },
  returns: v.object({ resolvedAt: v.number(), alreadyResolved: v.boolean() }),
  handler: async (ctx, args) => {
    const fixture = readinessFixture;
    if (
      process.env.CONVEX_CLOUD_URL !== fixture.cloudUrl ||
      process.env.CONVEX_SITE_URL !== fixture.siteUrl ||
      args.environmentId !== fixture.environmentId ||
      args.clientId !== fixture.clientId
    ) {
      throw refused();
    }
    await assertImportBinding(args);
    if (
      !(
        /^event_[A-Z0-9]{26}$/.test(args.deletedEventId) &&
        Number.isSafeInteger(args.deletedEventAt)
      ) ||
      args.deletedEventAt <= fixture.quarantineAt ||
      args.deletedEventAt > Date.now()
    ) {
      throw refused();
    }
    const candidates = await ctx.db
      .query("migrationQuarantine")
      .withIndex("by_workosUserId_and_reason_and_resolvedAt", (q) =>
        q
          .eq("workosUserId", fixture.workosUserId)
          .eq("reason", "external_id_mismatch")
      )
      .take(2);
    const row = candidates[0];
    if (
      candidates.length !== 1 ||
      !row ||
      row._id !== args.quarantineId ||
      row.teakUserId !== fixture.marker ||
      row.source !== "webhook" ||
      row.createdAt !== fixture.quarantineAt ||
      (await emailHash(row.email)) !== fixture.emailSha256
    ) {
      throw refused();
    }
    const deletionReceipts = await ctx.db
      .query("migrationQuarantine")
      .withIndex("by_workosUserId_and_reason_and_resolvedAt", (q) =>
        q
          .eq("workosUserId", fixture.workosUserId)
          .eq("reason", "workos_user_deleted")
      )
      .take(2);
    const deletionReceipt = deletionReceipts[0];
    const currentTarget = await currentWorkosDeletionTarget();
    if (
      deletionReceipts.length !== 1 ||
      !deletionReceipt ||
      deletionReceipt._id !== args.deletedQuarantineId ||
      deletionReceipt.teakUserId !== undefined ||
      deletionReceipt.source !== "webhook" ||
      deletionReceipt.workosDeletionEventAt !== args.deletedEventAt ||
      !Number.isSafeInteger(args.deletedQuarantineCreatedAt) ||
      deletionReceipt.createdAt !== args.deletedQuarantineCreatedAt ||
      deletionReceipt.createdAt < args.deletedEventAt ||
      deletionReceipt.createdAt > Date.now() ||
      (await emailHash(deletionReceipt.email)) !== fixture.emailSha256 ||
      !currentTarget ||
      !deletionReceipt.workosDeletionTarget ||
      !sameWorkosDeletionTarget(
        currentTarget,
        deletionReceipt.workosDeletionTarget
      )
    ) {
      throw refused();
    }
    const created = await ctx.db
      .query("workosEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", fixture.createdEventId))
      .take(2);
    const deleted = await ctx.db
      .query("workosEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.deletedEventId))
      .take(2);
    if (
      created.length !== 1 ||
      created[0]?.workosUserId !== fixture.workosUserId ||
      created[0]?.type !== "user.created" ||
      created[0]?.createdAt !== fixture.createdEventAt ||
      deleted.length !== 1 ||
      deleted[0]?.workosUserId !== fixture.workosUserId ||
      deleted[0]?.type !== "user.deleted" ||
      deleted[0]?.createdAt !== args.deletedEventAt ||
      deleted[0]?.externalId !== fixture.marker ||
      typeof deleted[0]?.email !== "string" ||
      (await emailHash(deleted[0].email)) !== fixture.emailSha256
    ) {
      throw refused();
    }
    const profiles = await ctx.db
      .query("workosProfiles")
      .withIndex("by_workosUserId", (q) =>
        q.eq("workosUserId", fixture.workosUserId)
      )
      .take(2);
    const profile = profiles[0];
    if (
      profiles.length !== 1 ||
      !profile ||
      profile.teakUserId !== undefined ||
      profile.source !== "event" ||
      profile.deletionSource !== "event" ||
      profile.deletedAt !== args.deletedEventAt ||
      profile.lastEventAt !== args.deletedEventAt ||
      (profile.profile !== undefined &&
        (profile.profile.externalId !== fixture.marker ||
          (await emailHash(profile.profile.email)) !== fixture.emailSha256))
    ) {
      throw refused();
    }
    const owners = await Promise.all([
      ctx.db
        .query("users")
        .withIndex("by_teakUserId", (q) => q.eq("teakUserId", fixture.marker))
        .take(1),
      ctx.db
        .query("users")
        .withIndex("by_workosUserId", (q) =>
          q.eq("workosUserId", fixture.workosUserId)
        )
        .take(1),
      ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", row.email))
        .take(1),
      ctx.db
        .query("cards")
        .withIndex("by_created", (q) => q.eq("userId", fixture.marker))
        .take(1),
    ]);
    if (owners.some((matches) => matches.length > 0)) {
      throw refused();
    }
    // No normalized-email index exists. A capped complete scan is required;
    // reaching the cap is uncertainty, never proof of absence.
    const allOwners = await ctx.db.query("users").take(1000);
    const allProfiles = await ctx.db.query("workosProfiles").take(1000);
    const legacyUsers = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: "user",
        paginationOpts: { cursor: null, numItems: 1000 },
      }
    );
    const normalizedEmail = row.email.trim().toLowerCase();
    if (
      allOwners.length === 1000 ||
      allProfiles.length === 1000 ||
      allProfiles.some(
        (other) =>
          other._id !== profile._id &&
          (other.teakUserId === fixture.marker ||
            other.profile?.externalId === fixture.marker ||
            other.profile?.email.trim().toLowerCase() === normalizedEmail)
      ) ||
      !legacyUsers.isDone ||
      allOwners.some(
        (owner) => owner.email.trim().toLowerCase() === normalizedEmail
      ) ||
      legacyUsers.page.some(
        (owner: { email: string }) =>
          owner.email.trim().toLowerCase() === normalizedEmail
      )
    ) {
      throw refused();
    }
    for (const lookup of [
      { model: "user" as const, field: "_id", value: fixture.marker },
      { model: "user" as const, field: "email", value: row.email },
      { model: "account" as const, field: "userId", value: fixture.marker },
    ]) {
      const found = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: lookup.model,
        where: [{ field: lookup.field, value: lookup.value }],
        paginationOpts: { cursor: null, numItems: 1 },
      });
      if (!found.isDone || found.page.length > 0) {
        throw refused();
      }
    }
    if (
      row.resolvedAt !== undefined ||
      deletionReceipt.resolvedAt !== undefined
    ) {
      if (
        row.resolvedAt === undefined ||
        deletionReceipt.resolvedAt !== row.resolvedAt ||
        !Number.isSafeInteger(row.resolvedAt) ||
        row.resolvedAt < args.deletedEventAt ||
        row.resolvedAt > Date.now()
      ) {
        throw refused();
      }
      return { resolvedAt: row.resolvedAt, alreadyResolved: true };
    }
    const resolvedAt = Date.now();
    await ctx.db.patch(row._id, { resolvedAt });
    await ctx.db.patch(deletionReceipt._id, { resolvedAt });
    return { resolvedAt, alreadyResolved: false };
  },
});

// Retained Phase R provenance came from the spike endpoint, not this ledger.
// Only a future authenticated deletion receipt can authorize its retirement.
export const phaseRReadinessFixture = {
  environmentId: readinessFixture.environmentId,
  clientId: readinessFixture.clientId,
  cloudUrl: readinessFixture.cloudUrl,
  siteUrl: readinessFixture.siteUrl,
  workosUserId: "user_01M40QWRH0HE1NQPSV4R6XEQR3",
  marker: "phase-r-webhook-1791026422012",
  lastObservedAt: 1_791_218_518_224,
  emailSha256:
    "dc99956b113ac7da1ad5e162e28b06da1071934b5663e8b4fdc8e4f4aea5ac59",
} as const;

// Inactive internal operator entry point. No provider deletion or data import.
// Separate approval is required before settling this exact fixture's audit.
export const resolveRetiredPhaseRFixture = internalMutation({
  args: {
    ...importLeasePins,
    deletedQuarantineId: v.id("migrationQuarantine"),
    deletedQuarantineCreatedAt: v.number(),
    deletedEventId: v.string(),
    deletedEventAt: v.number(),
  },
  returns: v.object({ resolvedAt: v.number(), alreadyResolved: v.boolean() }),
  handler: async (ctx, args) => {
    const fixture = phaseRReadinessFixture;
    await assertImportBinding(args);
    if (
      process.env.CONVEX_CLOUD_URL !== fixture.cloudUrl ||
      process.env.CONVEX_SITE_URL !== fixture.siteUrl ||
      args.environmentId !== fixture.environmentId ||
      args.clientId !== fixture.clientId ||
      !/^event_[A-Z0-9]{26}$/.test(args.deletedEventId) ||
      !Number.isSafeInteger(args.deletedEventAt) ||
      args.deletedEventAt <= fixture.lastObservedAt ||
      args.deletedEventAt > Date.now() ||
      !Number.isSafeInteger(args.deletedQuarantineCreatedAt) ||
      args.deletedQuarantineCreatedAt < args.deletedEventAt ||
      args.deletedQuarantineCreatedAt > Date.now()
    ) {
      throw refused();
    }
    // Complete bounded scans also reject unexpected historical conflicts,
    // duplicate receipts, and another provider claiming this marker/email.
    const [owners, profiles, audits, events, legacyUsers, legacyAccounts] =
      await Promise.all([
        ctx.db.query("users").take(1000),
        ctx.db.query("workosProfiles").take(1000),
        ctx.db.query("migrationQuarantine").take(1000),
        ctx.db.query("workosEvents").take(1000),
        ctx.runQuery(components.betterAuth.adapter.findMany, {
          model: "user",
          paginationOpts: { cursor: null, numItems: 1000 },
        }),
        ctx.runQuery(components.betterAuth.adapter.findMany, {
          model: "account",
          paginationOpts: { cursor: null, numItems: 1000 },
        }),
      ]);
    if (
      [owners, profiles, audits, events].some((rows) => rows.length === 1000) ||
      !legacyUsers.isDone ||
      !legacyAccounts.isDone
    ) {
      throw refused();
    }
    const exactAudits = audits.filter(
      (row) => row.workosUserId === fixture.workosUserId
    );
    const audit = exactAudits[0];
    const target = await currentWorkosDeletionTarget();
    if (
      exactAudits.length !== 1 ||
      !audit ||
      audit._id !== args.deletedQuarantineId ||
      audit.reason !== "workos_user_deleted" ||
      audit.source !== "webhook" ||
      audit.teakUserId !== undefined ||
      audit.createdAt !== args.deletedQuarantineCreatedAt ||
      audit.workosDeletionEventAt !== args.deletedEventAt ||
      (await emailHash(audit.email)) !== fixture.emailSha256 ||
      !target ||
      !audit.workosDeletionTarget ||
      !sameWorkosDeletionTarget(target, audit.workosDeletionTarget)
    ) {
      throw refused();
    }
    const exactEvents = events.filter(
      (row) => row.workosUserId === fixture.workosUserId
    );
    const event = exactEvents[0];
    if (
      exactEvents.length !== 1 ||
      !event ||
      event.eventId !== args.deletedEventId ||
      events.some(
        (other) => other._id !== event._id && other.eventId === event.eventId
      ) ||
      event.type !== "user.deleted" ||
      event.createdAt !== args.deletedEventAt ||
      event.externalId !== fixture.marker ||
      typeof event.email !== "string" ||
      (await emailHash(event.email)) !== fixture.emailSha256
    ) {
      throw refused();
    }
    const exactProfiles = profiles.filter(
      (row) => row.workosUserId === fixture.workosUserId
    );
    const profile = exactProfiles[0];
    if (
      exactProfiles.length !== 1 ||
      !profile ||
      profile.teakUserId !== undefined ||
      profile.source !== "event" ||
      profile.deletionSource !== "event" ||
      profile.deletedAt !== args.deletedEventAt ||
      profile.lastEventAt !== args.deletedEventAt ||
      (profile.profile !== undefined &&
        (profile.profile.externalId !== fixture.marker ||
          (await emailHash(profile.profile.email)) !== fixture.emailSha256))
    ) {
      throw refused();
    }
    const normalizedEmail = audit.email.trim().toLowerCase();
    const hasOwner = owners.some(
      (owner) =>
        owner.teakUserId === fixture.marker ||
        owner.teakUserId === fixture.workosUserId ||
        owner.workosUserId === fixture.workosUserId ||
        owner.email.trim().toLowerCase() === normalizedEmail
    );
    if (
      hasOwner ||
      audits.some(
        (other) =>
          other._id !== audit._id &&
          (other.teakUserId === fixture.marker ||
            other.teakUserId === fixture.workosUserId ||
            other.email.trim().toLowerCase() === normalizedEmail)
      ) ||
      profiles.some(
        (other) =>
          other._id !== profile._id &&
          (other.teakUserId === fixture.marker ||
            other.teakUserId === fixture.workosUserId ||
            other.profile?.externalId === fixture.marker ||
            other.profile?.email.trim().toLowerCase() === normalizedEmail)
      ) ||
      legacyUsers.page.some(
        (owner: { _id: string; email: string }) =>
          owner._id === fixture.marker ||
          owner._id === fixture.workosUserId ||
          owner.email.trim().toLowerCase() === normalizedEmail
      ) ||
      legacyAccounts.page.some(
        (account: { userId: string }) =>
          account.userId === fixture.marker ||
          account.userId === fixture.workosUserId
      )
    ) {
      throw refused();
    }
    for (const ownerId of [fixture.marker, fixture.workosUserId]) {
      const cards = await ctx.db
        .query("cards")
        .withIndex("by_created", (q) => q.eq("userId", ownerId))
        .take(1);
      if (cards.length > 0) {
        throw refused();
      }
    }
    if (audit.resolvedAt !== undefined) {
      if (
        !Number.isSafeInteger(audit.resolvedAt) ||
        audit.resolvedAt < args.deletedEventAt ||
        audit.resolvedAt < audit.createdAt ||
        audit.resolvedAt > Date.now()
      ) {
        throw refused();
      }
      return { resolvedAt: audit.resolvedAt, alreadyResolved: true };
    }
    const resolvedAt = Date.now();
    await ctx.db.patch(audit._id, { resolvedAt });
    return { resolvedAt, alreadyResolved: false };
  },
});
