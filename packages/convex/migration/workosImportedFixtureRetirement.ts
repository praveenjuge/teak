import { v } from "convex/values";
import { components } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import {
  currentWorkosDeletionTarget,
  sameWorkosDeletionTarget,
} from "../workosDeletionCompletion";
import { assertImportBinding, importLeasePins } from "./workosImportLease";

// The ten Production E2E fixture accounts that leaked from a failed journey
// setup, were bulk-imported to WorkOS, swept by the legacy Better Auth E2E
// cleanup (no canonical deletion completion), and then retired from WorkOS by
// root under a separate exact-ten approval. Their signed deletion receipts can
// never resolve through `expectedWorkosDeletionResolution`, because no
// completion proof exists and none may be fabricated. This is not a general
// quarantine resolver: every value below is pinned from root's private
// classifier, prebulk Better Auth source, fresh WorkOS capture and deletion
// journal, and anything else is refused.
export const importedFixtureDeployment = {
  environmentId: "environment_01M46HC8CJ5D0THX3EP6WVDKMM",
  clientId: "client_01M46HC8K0DD50SC59QX9DV3MX",
  cloudUrl: "https://uncommon-ladybug-882.convex.cloud",
  siteUrl: "https://uncommon-ladybug-882.convex.site",
  // Bulk import journal: started 10:40:39.832Z, completed 11:07:15.631Z.
  importStartedAt: 1_791_369_639_832,
  importCompletedAt: 1_791_371_235_632,
  // The human's exact-ten provider deletion approval was recorded here.
  deletionApprovedAt: 1_791_375_436_535,
  // Clock tolerance between root's journal and WorkOS event timestamps.
  deletionSkewMs: 30_000,
  // A provider 404 older than this cannot authorize settlement.
  providerCheckMaxAgeMs: 5 * 60_000,
} as const;

export interface ImportedFixture {
  deletionIntentAt: number;
  deletionResultAt: number;
  emailSha256: string;
  ownerDeletedAt: number;
  teakUserId: string;
  workosUserId: string;
}

export const importedFixtures: readonly ImportedFixture[] = [
  [
    "user_01M4B0NWWY2760CGMHH84AXXVC",
    "k97bje3jkesd0xqdjac2xws9sd8frnjt",
    1_791_373_835_602,
    "d1cb15eaef4ce65489d7e4b64e2b42bbe4cb1c53b825c1e91f4fbad4cb2fd6cc",
    1_791_376_581_533,
    1_791_376_581_900,
  ],
  [
    "user_01M4B0P1P12X2J263EBNPMNRA7",
    "k97adb6xxzgj6kek07z6x9g0s98frmzf",
    1_791_373_831_955,
    "935cfbbbdd39c747639d4e62a0510482e04a7288ca0ed4e309cb89fd414910b8",
    1_791_376_590_718,
    1_791_376_591_113,
  ],
  [
    "user_01M4B0P6D7BMF2M11DVWHDXY6P",
    "k977rbxxzvv3jhra00c6z41kxd8frkrn",
    1_791_373_835_319,
    "1324d80504d4d87b21103b30efe70b23998b4beac7cd33378e5a932d741a0e3b",
    1_791_376_599_521,
    1_791_376_599_858,
  ],
  [
    "user_01M4B0PAXD1SJAAVMX77SEQ2TK",
    "k9704r04f8azmty29qt6fztz298frt5d",
    1_791_373_839_860,
    "677e3e124ca6e982b1642dc340d008e21fe52aa49a088132d9debdd04fed1e6c",
    1_791_376_608_593,
    1_791_376_608_951,
  ],
  [
    "user_01M4B0PFD80ZZW3H9X8TDX915Z",
    "k977xpww85xnqvan5twyt6w3258fr1f7",
    1_791_373_837_095,
    "b95b53dfd2a5562f3f41b8fa71ceeb2d05ec2192e989d01ed99faa8b9447b853",
    1_791_376_617_775,
    1_791_376_618_123,
  ],
  [
    "user_01M4B0PMHYH153MD74WB0TZS9N",
    "k972a2jatc02tc4ve4vkfqy2rn8fsfce",
    1_791_373_837_102,
    "66524ab0d4316d76a44edf3613183e1df6d7e83cd4e81a40daf004fef9630ebc",
    1_791_376_626_858,
    1_791_376_627_211,
  ],
  [
    "user_01M4B0PS3WB63423HZX13KCG96",
    "k976mejp0zecyckehvrgk0vnz18fsy22",
    1_791_373_841_251,
    "ac8ec2e95ef86652ee484fec43770b425f67c2563f426ffee529841357937ead",
    1_791_376_636_034,
    1_791_376_636_372,
  ],
  [
    "user_01M4B0PXPY6KXQDRPDWWX1GVAE",
    "k97ac03t8z0wva1yv05vtbcfas8fsgbr",
    1_791_373_844_057,
    "1adf59665f90d5e20e3997721d5bea69a733a7cc3309f2d1bcf03903ad20b9e6",
    1_791_376_645_047,
    1_791_376_645_517,
  ],
  [
    "user_01M4B0Q2AVZC2QRYYTC896MTTP",
    "k977krqnhdp9jmbxb10dhczx8x8frjfb",
    1_791_373_841_329,
    "c4a80f3e40348d88ccc4dc2285c33b3948b4d78011fc0b55681c20b8ae6a8052",
    1_791_376_653_933,
    1_791_376_654_282,
  ],
  [
    "user_01M4B0Q6SSGX4AVB9JVNAQKGVR",
    "k9703ysg7e69qkm7rw2jxmqe958fr6h2",
    1_791_373_845_441,
    "55c7b09143f46a866172415de57bda5304b1d250411fa88cef0b69e58066f8e1",
    1_791_376_663_235,
    1_791_376_663_598,
  ],
].map(
  ([
    workosUserId,
    teakUserId,
    ownerDeletedAt,
    emailSha256,
    deletionIntentAt,
    deletionResultAt,
  ]) =>
    ({
      workosUserId,
      teakUserId,
      ownerDeletedAt,
      emailSha256,
      deletionIntentAt,
      deletionResultAt,
    }) as ImportedFixture
);

async function emailHash(email: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(email.trim().toLowerCase())
      )
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
const refused = (reason: string) =>
  new Error(
    `Imported fixture retirement proof is incomplete or changed: ${reason}`
  );

/** Exact allowlisted pair and pinned production deployment, or a refusal. */
export async function assertImportedFixtureTarget(args: {
  environmentId: string;
  clientId: string;
  apiKeyFingerprint: string;
  workosUserId: string;
  teakUserId: string;
}) {
  const pins = importedFixtureDeployment;
  if (
    process.env.CONVEX_CLOUD_URL !== pins.cloudUrl ||
    process.env.CONVEX_SITE_URL !== pins.siteUrl ||
    args.environmentId !== pins.environmentId ||
    args.clientId !== pins.clientId
  ) {
    throw refused("deployment");
  }
  // Same binding as the importer: key fingerprint, environment, client, and a
  // Better Auth primary deployment with sign-ups frozen.
  await assertImportBinding(args);
  const fixture = importedFixtures.find(
    (row) => row.workosUserId === args.workosUserId
  );
  if (!fixture || fixture.teakUserId !== args.teakUserId) {
    throw refused("pair");
  }
  return fixture;
}

const isEventId = (value: string) => /^event_[A-Z0-9]{26}$/.test(value);

// Inactive internal operator mutation. It is never scheduled or reachable from
// HTTP, and only `settleRetiredImportedFixture` (after a fresh provider 404)
// may call it. Activation needs a separate reviewed production repair approval.
export const resolveRetiredImportedFixtureReceipt = internalMutation({
  args: {
    ...importLeasePins,
    workosUserId: v.string(),
    teakUserId: v.string(),
    createdEventId: v.string(),
    deletedEventId: v.string(),
    deletedEventAt: v.number(),
    deletedQuarantineId: v.id("migrationQuarantine"),
    deletedQuarantineCreatedAt: v.number(),
    providerAbsentCheckedAt: v.number(),
  },
  returns: v.object({ resolvedAt: v.number(), alreadyResolved: v.boolean() }),
  handler: async (ctx, args) => {
    const pins = importedFixtureDeployment;
    const fixture = await assertImportedFixtureTarget(args);
    const now = Date.now();
    const deletionFloor = Math.max(
      pins.deletionApprovedAt,
      fixture.deletionIntentAt - pins.deletionSkewMs
    );
    if (
      !(isEventId(args.createdEventId) && isEventId(args.deletedEventId)) ||
      args.createdEventId === args.deletedEventId ||
      !Number.isSafeInteger(args.deletedEventAt) ||
      args.deletedEventAt < deletionFloor ||
      args.deletedEventAt > fixture.deletionResultAt + pins.deletionSkewMs ||
      !Number.isSafeInteger(args.deletedQuarantineCreatedAt) ||
      args.deletedQuarantineCreatedAt < args.deletedEventAt ||
      args.deletedQuarantineCreatedAt > now ||
      !Number.isSafeInteger(args.providerAbsentCheckedAt) ||
      args.providerAbsentCheckedAt < args.deletedEventAt ||
      args.providerAbsentCheckedAt > now ||
      now - args.providerAbsentCheckedAt > pins.providerCheckMaxAgeMs
    ) {
      throw refused("arguments");
    }

    // The permanent owner: one tombstone, uniquely mapped, never changed here.
    const [owners, mapped] = await Promise.all([
      ctx.db
        .query("users")
        .withIndex("by_teakUserId", (q) =>
          q.eq("teakUserId", fixture.teakUserId)
        )
        .take(2),
      ctx.db
        .query("users")
        .withIndex("by_workosUserId", (q) =>
          q.eq("workosUserId", fixture.workosUserId)
        )
        .take(2),
    ]);
    const owner = owners[0];
    if (
      owners.length !== 1 ||
      mapped.length !== 1 ||
      !owner ||
      mapped[0]?._id !== owner._id ||
      owner.workosUserId !== fixture.workosUserId ||
      owner.deletedAt !== fixture.ownerDeletedAt ||
      owner.email !== "" ||
      owner.identityOrigin !== undefined ||
      owner.role !== undefined ||
      owner.workosDeletionCompletion !== undefined ||
      owner.workosDeletedAt !== args.deletedEventAt ||
      owner.workosEmailVerified !== false ||
      owner.lastWorkosEventAt !== args.deletedEventAt
    ) {
      throw refused("owner");
    }

    // The signed event ledger: one import-time creation and one deletion inside
    // root's journaled DELETE window, both for this exact fixture.
    const events = await ctx.db
      .query("workosEvents")
      .withIndex("by_workosUserId_and_createdAt", (q) =>
        q.eq("workosUserId", fixture.workosUserId)
      )
      .take(11);
    const created = events.filter((row) => row.type === "user.created");
    const deleted = events.filter((row) => row.type === "user.deleted");
    const others = events.filter(
      (row) => row.type !== "user.created" && row.type !== "user.deleted"
    );
    const sameFixture = async (row: Doc<"workosEvents">) =>
      row.externalId === fixture.teakUserId &&
      typeof row.email === "string" &&
      (await emailHash(row.email)) === fixture.emailSha256;
    const createdEvent = created[0];
    const deletedEvent = deleted[0];
    if (
      events.length > 10 ||
      created.length !== 1 ||
      deleted.length !== 1 ||
      !createdEvent ||
      !deletedEvent ||
      createdEvent.eventId !== args.createdEventId ||
      createdEvent.createdAt < pins.importStartedAt ||
      createdEvent.createdAt > pins.importCompletedAt ||
      !(await sameFixture(createdEvent)) ||
      deletedEvent.eventId !== args.deletedEventId ||
      deletedEvent.createdAt !== args.deletedEventAt ||
      !(await sameFixture(deletedEvent))
    ) {
      throw refused("events");
    }
    for (const row of others) {
      if (
        row.type !== "user.updated" ||
        row.createdAt < createdEvent.createdAt ||
        row.createdAt >= args.deletedEventAt ||
        !(await sameFixture(row))
      ) {
        throw refused("events");
      }
    }
    for (const eventId of [args.createdEventId, args.deletedEventId]) {
      const copies = await ctx.db
        .query("workosEvents")
        .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
        .take(2);
      if (copies.length !== 1) {
        throw refused("events");
      }
    }

    // Canonical profile tombstoned by that exact deletion event.
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
      profile.teakUserId !== fixture.teakUserId ||
      profile.source !== "event" ||
      profile.deletionSource !== "event" ||
      profile.deletedAt !== args.deletedEventAt ||
      profile.lastEventAt !== args.deletedEventAt ||
      (profile.profile !== undefined &&
        (profile.profile.externalId !== fixture.teakUserId ||
          (await emailHash(profile.profile.email)) !== fixture.emailSha256))
    ) {
      throw refused("profile");
    }

    // Exactly one receipt for this provider user: the signed deletion receipt,
    // bound to the current pinned target. Any other receipt stays unresolved.
    const receipts = await ctx.db
      .query("migrationQuarantine")
      .withIndex("by_workosUserId_and_reason_and_resolvedAt", (q) =>
        q.eq("workosUserId", fixture.workosUserId)
      )
      .take(2);
    const receipt = receipts[0];
    const target = await currentWorkosDeletionTarget();
    if (
      receipts.length !== 1 ||
      !receipt ||
      receipt._id !== args.deletedQuarantineId ||
      receipt.reason !== "workos_user_deleted" ||
      receipt.source !== "webhook" ||
      receipt.teakUserId !== fixture.teakUserId ||
      receipt.createdAt !== args.deletedQuarantineCreatedAt ||
      receipt.workosDeletionEventAt !== args.deletedEventAt ||
      (await emailHash(receipt.email)) !== fixture.emailSha256 ||
      !target ||
      target.environmentId !== pins.environmentId ||
      target.clientId !== pins.clientId ||
      target.credentialFingerprint !== args.apiKeyFingerprint ||
      !receipt.workosDeletionTarget ||
      !sameWorkosDeletionTarget(target, receipt.workosDeletionTarget)
    ) {
      throw refused("receipt");
    }

    // No live data or credential remains for the retired fixture anywhere.
    const [byEmail, deleting, cards, nativeCodes, consents] = await Promise.all(
      [
        ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", receipt.email))
          .take(1),
        ctx.db
          .query("accountDeletionStates")
          .withIndex("by_userId", (q) => q.eq("userId", fixture.teakUserId))
          .take(1),
        ctx.db
          .query("cards")
          .withIndex("by_created", (q) => q.eq("userId", fixture.teakUserId))
          .take(1),
        ctx.db
          .query("nativeAuthCodes")
          .withIndex("by_user", (q) => q.eq("userId", fixture.teakUserId))
          .take(1),
        ctx.db
          .query("workosConsents")
          .withIndex("by_workosUserId_and_clientId_and_revokedAt", (q) =>
            q.eq("workosUserId", fixture.workosUserId)
          )
          .take(1),
      ]
    );
    const customer = await ctx.runQuery(
      components.polar.lib.getCustomerByUserId,
      { userId: fixture.teakUserId }
    );
    const legacyUser = await ctx.runQuery(
      components.betterAuth.adapter.findOne,
      { model: "user", where: [{ field: "_id", value: fixture.teakUserId }] }
    );
    if (
      [byEmail, deleting, cards, nativeCodes, consents].some(
        (rows) => rows.length > 0
      ) ||
      customer !== null ||
      legacyUser !== null
    ) {
      throw refused("remnants");
    }
    for (const lookup of [
      { model: "user" as const, field: "email", value: receipt.email },
      { model: "account" as const, field: "userId", value: fixture.teakUserId },
      { model: "session" as const, field: "userId", value: fixture.teakUserId },
      {
        model: "oauthAccessToken" as const,
        field: "userId",
        value: fixture.teakUserId,
      },
      {
        model: "oauthConsent" as const,
        field: "userId",
        value: fixture.teakUserId,
      },
    ]) {
      const found = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: lookup.model,
        where: [{ field: lookup.field, value: lookup.value }],
        paginationOpts: { cursor: null, numItems: 1 },
      });
      if (!found.isDone || found.page.length > 0) {
        throw refused("remnants");
      }
    }

    if (receipt.resolvedAt !== undefined) {
      if (
        !Number.isSafeInteger(receipt.resolvedAt) ||
        receipt.resolvedAt < receipt.createdAt ||
        receipt.resolvedAt > now
      ) {
        throw refused("resolution");
      }
      return { resolvedAt: receipt.resolvedAt, alreadyResolved: true };
    }
    // The only write: settle this one receipt. Owner, profile, events, cards,
    // billing and every other receipt are untouched; no completion is minted.
    await ctx.db.patch("migrationQuarantine", receipt._id, { resolvedAt: now });
    return { resolvedAt: now, alreadyResolved: false };
  },
});
