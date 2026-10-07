/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import polarTest from "@convex-dev/polar/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  importedFixtureDeployment as deployment,
  importedFixtures,
} from "./migration/workosImportedFixtureRetirement";
import schema from "./schema";
import { currentWorkosDeletionTarget } from "./workosDeletionCompletion";

const modules = import.meta.glob("./**/*.ts");
const KEY = "test-workos-production-key";
const fingerprint = async (value: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const fixture = importedFixtures[0]!;
const other = importedFixtures[1]!;
const pinnedSha = fixture.emailSha256;
const pinnedMarker = { ...fixture.legacyMarker };
const email = "e2e-service-api-1791288365274-ab12cd@fixtures.example.test";
const createdEventId = "event_01M4B0NX0000000000000000AA";
const deletedEventId = "event_01M4B0NX0000000000000000BB";
const deletedEventAt = fixture.deletionIntentAt + 200;
const createdEventAt = deployment.importStartedAt + 60_000;

beforeEach(async () => {
  // Test-only email: the committed hash is of the real fixture address.
  Object.assign(fixture, { emailSha256: await fingerprint(email) });
  vi.stubEnv("AUTH_PRIMARY", "betterauth");
  vi.stubEnv("SIGNUPS_DISABLED", "true");
  vi.stubEnv("CONVEX_CLOUD_URL", deployment.cloudUrl);
  vi.stubEnv("CONVEX_SITE_URL", deployment.siteUrl);
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", deployment.environmentId);
  vi.stubEnv("WORKOS_CLIENT_ID", deployment.clientId);
  vi.stubEnv("WORKOS_API_KEY", KEY);
});
afterEach(() => {
  Object.assign(fixture, {
    emailSha256: pinnedSha,
    legacyMarker: { ...pinnedMarker },
  });
  vi.unstubAllEnvs();
});

async function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  polarTest.register(t);
  const target = (await currentWorkosDeletionTarget())!;
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", {
      teakUserId: fixture.teakUserId,
      email: "",
      emailVerified: false,
      workosUserId: fixture.workosUserId,
      workosEmail: email,
      workosEmailVerified: false,
      workosDeletedAt: deletedEventAt,
      lastWorkosEventAt: deletedEventAt,
      deletedAt: fixture.ownerDeletedAt,
    });
    await ctx.db.insert("workosEvents", {
      eventId: createdEventId,
      workosUserId: fixture.workosUserId,
      type: "user.created",
      createdAt: createdEventAt,
      email,
      emailVerified: true,
      externalId: fixture.teakUserId,
    });
    await ctx.db.insert("workosEvents", {
      eventId: deletedEventId,
      workosUserId: fixture.workosUserId,
      type: "user.deleted",
      createdAt: deletedEventAt,
      email,
      emailVerified: true,
      externalId: fixture.teakUserId,
    });
    const profileId = await ctx.db.insert("workosProfiles", {
      workosUserId: fixture.workosUserId,
      teakUserId: fixture.teakUserId,
      revision: 3,
      source: "event",
      deletionSource: "event",
      deletedAt: deletedEventAt,
      lastEventAt: deletedEventAt,
      providerUpdatedAt: "2026-10-07T11:06:18.910Z",
      profile: {
        email,
        emailVerified: true,
        externalId: fixture.teakUserId,
        name: "Production E2E",
        firstName: null,
        lastName: null,
        profilePictureUrl: null,
      },
    });
    const receiptId = await ctx.db.insert("migrationQuarantine", {
      workosUserId: fixture.workosUserId,
      teakUserId: fixture.teakUserId,
      email,
      reason: "workos_user_deleted",
      source: "webhook",
      createdAt: deletedEventAt + 400,
      workosDeletionEventAt: deletedEventAt,
      workosDeletionTarget: target,
    });
    // A second retired fixture's receipt that this call must never touch.
    const otherReceiptId = await ctx.db.insert("migrationQuarantine", {
      workosUserId: other.workosUserId,
      teakUserId: other.teakUserId,
      email: "",
      reason: "workos_user_deleted",
      source: "webhook",
      createdAt: deletedEventAt + 9000,
      workosDeletionEventAt: deletedEventAt + 8000,
      workosDeletionTarget: target,
    });
    // The bare legacy marker `beginAccountDeletion` left behind. convex-test
    // mints its own ID and creation time, so the pin follows them here.
    const markerId = await ctx.db.insert("accountDeletionStates", {
      userId: fixture.teakUserId,
      startedAt: pinnedMarker.startedAt,
    });
    const markerRow = (await ctx.db.get("accountDeletionStates", markerId))!;
    Object.assign(fixture, {
      legacyMarker: {
        stateId: markerId,
        startedAt: pinnedMarker.startedAt,
        creationTime: markerRow._creationTime,
      },
    });
    return { ownerId, profileId, receiptId, otherReceiptId, markerId };
  });
  const args = {
    environmentId: deployment.environmentId as string,
    clientId: deployment.clientId as string,
    apiKeyFingerprint: await fingerprint(KEY),
    workosUserId: fixture.workosUserId,
    teakUserId: fixture.teakUserId,
    createdEventId,
    deletedEventId,
    deletedEventAt,
    deletedQuarantineId: ids.receiptId as Id<"migrationQuarantine">,
    deletedQuarantineCreatedAt: deletedEventAt + 400,
    providerAbsentCheckedAt: Date.now() - 1000,
  };
  const resolve = (overrides: Partial<typeof args> = {}) =>
    t.mutation(
      internal.migration.workosImportedFixtureRetirement
        .resolveRetiredImportedFixtureReceipt,
      { ...args, ...overrides }
    );
  return { t, ids, args, resolve };
}

const snapshot = (t: Awaited<ReturnType<typeof setup>>["t"]) =>
  t.run(async (ctx) => ({
    users: await ctx.db.query("users").collect(),
    profiles: await ctx.db.query("workosProfiles").collect(),
    events: await ctx.db.query("workosEvents").collect(),
    receipts: await ctx.db.query("migrationQuarantine").collect(),
    markers: await ctx.db.query("accountDeletionStates").collect(),
  }));

test("settles only the exact retired fixture receipt, idempotently, keeping terminal denial", async () => {
  const { t, ids, resolve } = await setup();
  const before = await snapshot(t);
  const first = await resolve();
  expect(first.alreadyResolved).toBe(false);
  const after = await snapshot(t);
  expect(after.users).toEqual(before.users);
  expect(after.profiles).toEqual(before.profiles);
  expect(after.events).toEqual(before.events);
  expect(after.markers).toEqual(before.markers);
  expect(after.markers.length).toBe(1);
  const receipt = after.receipts.find((row) => row._id === ids.receiptId)!;
  expect(receipt.resolvedAt).toBe(first.resolvedAt);
  expect(
    after.receipts.find((row) => row._id === ids.otherReceiptId)!.resolvedAt
  ).toBeUndefined();
  expect(after.users[0]!.workosDeletionCompletion).toBeUndefined();

  const again = await resolve();
  expect(again).toEqual({
    resolvedAt: first.resolvedAt,
    alreadyResolved: true,
  });
  for (const verification of [
    { kind: "session" as const, emailVerified: true },
    { kind: "connect" as const },
  ]) {
    const result = await t.query(internal.workosIdentity.resolveWorkosOwner, {
      workosUserId: fixture.workosUserId,
      externalId: fixture.teakUserId,
      verification,
    });
    expect(result.status).toBe("denied");
  }
  const unresolved = await t.run((ctx) =>
    ctx.db
      .query("migrationQuarantine")
      .withIndex("by_unresolved", (q) => q.eq("resolvedAt", undefined))
      .collect()
  );
  expect(unresolved.map((row) => row._id)).toEqual([ids.otherReceiptId]);
});

test("refuses any pair, deployment or binding outside the exact pins", async () => {
  const { resolve } = await setup();
  await expect(resolve({ teakUserId: other.teakUserId })).rejects.toThrow(
    /pair/
  );
  await expect(
    resolve({ workosUserId: "user_01M4B0NWWY2760CGMHH84AXXVD" })
  ).rejects.toThrow(/pair/);
  await expect(resolve({ environmentId: "environment_DEV" })).rejects.toThrow(
    /deployment/
  );
  await expect(resolve({ apiKeyFingerprint: "0".repeat(64) })).rejects.toThrow(
    /binding/
  );
  for (const [name, value] of [
    ["CONVEX_CLOUD_URL", "https://reminiscent-kangaroo-59.convex.cloud"],
    ["AUTH_PRIMARY", "workos"],
    ["SIGNUPS_DISABLED", "false"],
  ] as const) {
    vi.stubEnv(name, value);
    await expect(resolve()).rejects.toThrow();
    vi.stubEnv(
      name,
      {
        CONVEX_CLOUD_URL: deployment.cloudUrl,
        AUTH_PRIMARY: "betterauth",
        SIGNUPS_DISABLED: "true",
      }[name]
    );
  }
});

test("refuses deletions outside root's journaled window and stale or early provider checks", async () => {
  const { resolve } = await setup();
  const now = Date.now();
  for (const overrides of [
    { deletedEventAt: deployment.deletionApprovedAt - 1 },
    {
      deletedEventAt: fixture.deletionResultAt + deployment.deletionSkewMs + 1,
    },
    { providerAbsentCheckedAt: now - deployment.providerCheckMaxAgeMs - 5000 },
    { providerAbsentCheckedAt: deletedEventAt - 1 },
    { providerAbsentCheckedAt: now + 60_000 },
    { deletedQuarantineCreatedAt: deletedEventAt + 401 },
    { createdEventId: deletedEventId },
  ]) {
    await expect(resolve(overrides)).rejects.toThrow(
      /arguments|events|owner|receipt/
    );
  }
});

test("refuses a changed owner tombstone or a fabricated completion", async () => {
  const changes: Record<string, unknown>[] = [
    { deletedAt: fixture.ownerDeletedAt + 1 },
    { email: "someone@example.test" },
    { identityOrigin: "workos" },
    { workosDeletedAt: deletedEventAt + 1 },
    { workosEmailVerified: true },
    { role: "admin" },
  ];
  for (const change of changes) {
    const { t, ids, resolve } = await setup();
    await t.run((ctx) => ctx.db.patch("users", ids.ownerId, change));
    await expect(resolve()).rejects.toThrow(/owner/);
  }
  const { t, ids, resolve } = await setup();
  await t.run(async (ctx) => {
    const stateId = await ctx.db.insert("accountDeletionStates", {
      userId: "unrelated",
      startedAt: 1,
    });
    await ctx.db.patch("users", ids.ownerId, {
      workosDeletionCompletion: {
        version: 1,
        stateId,
        generation: 1,
        workosUserId: fixture.workosUserId,
        startedAt: deletedEventAt - 10,
        completedAt: deletedEventAt + 10,
        target: (await currentWorkosDeletionTarget())!,
      },
    });
  });
  await expect(resolve()).rejects.toThrow(/owner/);
});

test("refuses ledger, profile and receipt drift", async () => {
  const cases: ((ctx: any, ids: any) => Promise<unknown>)[] = [
    async (ctx) => {
      const row = (await ctx.db.query("workosEvents").collect()).find(
        (e: any) => e.type === "user.created"
      );
      await ctx.db.patch("workosEvents", row._id, {
        createdAt: deployment.importCompletedAt + 1,
      });
    },
    async (ctx) => {
      const row = (await ctx.db.query("workosEvents").collect()).find(
        (e: any) => e.type === "user.deleted"
      );
      await ctx.db.patch("workosEvents", row._id, {
        externalId: other.teakUserId,
      });
    },
    (ctx) =>
      ctx.db.insert("workosEvents", {
        eventId: "event_01M4B0NX0000000000000000CC",
        workosUserId: fixture.workosUserId,
        type: "user.deleted",
        createdAt: deletedEventAt + 5,
        email,
        externalId: fixture.teakUserId,
      }),
    (ctx) =>
      ctx.db.insert("workosEvents", {
        eventId: "event_01M4B0NX0000000000000000DD",
        workosUserId: fixture.workosUserId,
        type: "user.updated",
        createdAt: deletedEventAt + 5,
        email,
        externalId: fixture.teakUserId,
      }),
    (ctx, ids) =>
      ctx.db.patch("workosProfiles", ids.profileId, {
        lastEventAt: deletedEventAt + 1,
      }),
    (ctx, ids) =>
      ctx.db.patch("workosProfiles", ids.profileId, {
        teakUserId: other.teakUserId,
      }),
    (ctx, ids) =>
      ctx.db.patch("migrationQuarantine", ids.receiptId, {
        source: "reconcile",
      }),
    (ctx, ids) =>
      ctx.db.patch("migrationQuarantine", ids.receiptId, {
        workosDeletionTarget: {
          environmentId: deployment.environmentId,
          clientId: deployment.clientId,
          issuer: `https://api.workos.com/user_management/${deployment.clientId}`,
          credentialFingerprint: "f".repeat(64),
        },
      }),
    (ctx, ids) =>
      ctx.db.patch("migrationQuarantine", ids.receiptId, {
        resolvedAt: Date.now() + 60_000,
      }),
    (ctx) =>
      ctx.db.insert("migrationQuarantine", {
        workosUserId: fixture.workosUserId,
        teakUserId: fixture.teakUserId,
        email,
        reason: "profile_pending",
        source: "webhook",
        createdAt: deletedEventAt,
      }),
  ];
  for (const change of cases) {
    const { t, ids, resolve } = await setup();
    await t.run((ctx) => change(ctx, ids));
    await expect(resolve()).rejects.toThrow(
      /events|profile|receipt|resolution/
    );
  }
});

test("refuses while any data, billing or credential remnant of the fixture remains", async () => {
  const cases: ((ctx: any) => Promise<unknown>)[] = [
    (ctx) =>
      ctx.db.insert("cards", {
        userId: fixture.teakUserId,
        type: "text",
        content: "fixture",
        createdAt: 1,
        updatedAt: 1,
      }),
    (ctx) =>
      ctx.runMutation(components.polar.lib.insertCustomer, {
        id: "cus_fixture",
        userId: fixture.teakUserId,
      }),
    (ctx) =>
      ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "user",
          data: {
            name: "Production E2E",
            email,
            emailVerified: true,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      }),
    (ctx) =>
      ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "account",
          data: {
            accountId: "x",
            providerId: "credential",
            userId: fixture.teakUserId,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      }),
    (ctx) =>
      ctx.db.insert("nativeAuthCodes", {
        sessionId: "s",
        userId: fixture.teakUserId,
        deviceId: "d",
        codeChallenge: "c",
        state: "s",
        surface: "desktop",
        expiresAt: Date.now() + 60_000,
        createdAt: 1,
      }),
    (ctx) =>
      ctx.db.insert("workosConsents", {
        consentId: "consent_fixture",
        userId: fixture.teakUserId,
        workosUserId: fixture.workosUserId,
        clientId: "client_connected_app",
        firstSeenAt: 1,
        lastSeenAt: 1,
      }),
    (ctx) =>
      ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "session",
          data: {
            token: "fixture-session",
            userId: fixture.teakUserId,
            expiresAt: Date.now() + 60_000,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      }),
    (ctx) =>
      ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "oauthAccessToken",
          data: {
            accessToken: "fixture-access",
            refreshToken: "fixture-refresh",
            clientId: "client_raycast",
            userId: fixture.teakUserId,
            scopes: "openid",
            createdAt: 1,
            updatedAt: 1,
          },
        },
      }),
    (ctx) =>
      ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "oauthConsent",
          data: {
            clientId: "client_raycast",
            userId: fixture.teakUserId,
            scopes: "openid",
            consentGiven: true,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      }),
  ];
  for (const change of cases) {
    const { t, ids, resolve } = await setup();
    await t.run(change);
    await expect(resolve()).rejects.toThrow(/remnants/);
    const receipt = await t.run((ctx) =>
      ctx.db.get("migrationQuarantine", ids.receiptId)
    );
    expect(receipt?.resolvedAt).toBeUndefined();
  }
});

// The network is the only mocked boundary: the installed WorkOS SDK parses the
// real HTTP responses, including its NotFoundException semantics.
async function settleThroughAction(status: number | "network") {
  const harness = await setup();
  const { providerAbsentCheckedAt: _, ...actionArgs } = harness.args;
  const requests: string[] = [];
  vi.stubGlobal("fetch", (input: string | URL) => {
    requests.push(new URL(String(input)).pathname);
    if (status === "network") {
      return Promise.reject(new TypeError("fetch failed"));
    }
    const body =
      status === 200
        ? {
            object: "user",
            id: fixture.workosUserId,
            email,
            email_verified: true,
            external_id: fixture.teakUserId,
            first_name: null,
            last_name: null,
            profile_picture_url: null,
            created_at: "2026-10-07T11:06:18.910Z",
            updated_at: "2026-10-07T11:06:18.910Z",
            last_sign_in_at: null,
          }
        : { message: "Provider response" };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    );
  });
  const run = (overrides: Partial<typeof actionArgs> = {}) =>
    harness.t.action(
      internal.migration.workosImportedFixtureRetirementActions
        .settleRetiredImportedFixture,
      { ...actionArgs, ...overrides }
    );
  const receipt = () =>
    harness.t.run((ctx) =>
      ctx.db.get("migrationQuarantine", harness.ids.receiptId)
    );
  return { run, receipt, requests };
}

test("action settles only after one canonical SDK GET answers 404", async () => {
  const { run, receipt, requests } = await settleThroughAction(404);
  const result = await run();
  expect(result.alreadyResolved).toBe(false);
  expect((await receipt())?.resolvedAt).toBe(result.resolvedAt);
  expect(requests).toEqual([`/user_management/users/${fixture.workosUserId}`]);
  vi.unstubAllGlobals();
});

test("action refuses an existing user, provider errors and network failure without retrying", async () => {
  for (const [status, message] of [
    [200, /still exists/],
    [500, /could not be verified/],
    [401, /could not be verified/],
    [429, /could not be verified/],
    ["network", /could not be verified/],
  ] as const) {
    const { run, receipt, requests } = await settleThroughAction(status);
    await expect(run()).rejects.toThrow(message);
    expect((await receipt())?.resolvedAt).toBeUndefined();
    expect(requests.length).toBe(1);
    vi.unstubAllGlobals();
  }
});

test("action refuses a non-allowlisted pair before contacting WorkOS", async () => {
  const { run, receipt, requests } = await settleThroughAction(404);
  await expect(run({ teakUserId: other.teakUserId })).rejects.toThrow(/pair/);
  await expect(run({ apiKeyFingerprint: "0".repeat(64) })).rejects.toThrow(
    /binding/
  );
  expect(requests).toEqual([]);
  expect((await receipt())?.resolvedAt).toBeUndefined();
  vi.unstubAllGlobals();
});

test("requires exactly the one pinned, unchanged legacy deletion marker", async () => {
  const cases: ((ctx: any, ids: any) => Promise<unknown>)[] = [
    (ctx, ids) => ctx.db.delete("accountDeletionStates", ids.markerId),
    (ctx, ids) =>
      ctx.db.patch("accountDeletionStates", ids.markerId, {
        startedAt: pinnedMarker.startedAt + 1,
      }),
    (ctx, ids) =>
      ctx.db.patch("accountDeletionStates", ids.markerId, {
        userId: other.teakUserId,
      }),
    (ctx, ids) =>
      ctx.db.patch("accountDeletionStates", ids.markerId, { generation: 1 }),
    (ctx, ids) =>
      ctx.db.patch("accountDeletionStates", ids.markerId, {
        workflowId: "workflow_resumed",
      }),
    (ctx, ids) =>
      ctx.db.patch("accountDeletionStates", ids.markerId, {
        workosUserId: fixture.workosUserId,
      }),
    (ctx) =>
      ctx.db.insert("accountDeletionStates", {
        userId: fixture.teakUserId,
        startedAt: pinnedMarker.startedAt,
      }),
    // Same content under a new row: a different ID and creation time.
    async (ctx, ids) => {
      await ctx.db.delete("accountDeletionStates", ids.markerId);
      await ctx.db.insert("accountDeletionStates", {
        userId: fixture.teakUserId,
        startedAt: pinnedMarker.startedAt,
      });
    },
  ];
  for (const change of cases) {
    const { t, ids, resolve } = await setup();
    await t.run((ctx) => change(ctx, ids));
    await expect(resolve()).rejects.toThrow(/legacy deletion marker/);
    const receipt = await t.run((ctx) =>
      ctx.db.get("migrationQuarantine", ids.receiptId)
    );
    expect(receipt?.resolvedAt).toBeUndefined();
  }
  // A pinned row ID that names a different document refuses on its own.
  {
    const { ids, resolve } = await setup();
    Object.assign(fixture.legacyMarker, { stateId: ids.receiptId });
    await expect(resolve()).rejects.toThrow(/legacy deletion marker/);
  }
  // A row and pin that agree but fall outside the sweep correlation refuse:
  // before the import finished, after the owner tombstone, or too early.
  for (const startedAt of [
    deployment.importCompletedAt - 1,
    fixture.ownerDeletedAt + 1,
    fixture.ownerDeletedAt - 60_001,
  ]) {
    const { t, ids, resolve } = await setup();
    await t.run((ctx) =>
      ctx.db.patch("accountDeletionStates", ids.markerId, { startedAt })
    );
    Object.assign(fixture.legacyMarker, { startedAt });
    await expect(resolve()).rejects.toThrow(/legacy deletion marker/);
  }
  // A pinned creation time or start time that disagrees with the row refuses.
  for (const drift of [
    { creationTime: Number.NaN },
    { startedAt: pinnedMarker.startedAt - 1 },
    { startedAt: deployment.importCompletedAt - 1 },
  ]) {
    const { resolve } = await setup();
    Object.assign(fixture.legacyMarker, drift);
    await expect(resolve()).rejects.toThrow(/legacy deletion marker/);
  }
});

test("the committed markers match the post-delete snapshot shape and timing", () => {
  for (const row of importedFixtures) {
    const marker = row.legacyMarker;
    expect(marker.stateId).toMatch(/^[a-z0-9]{32}$/);
    expect(Number.isSafeInteger(marker.startedAt)).toBe(true);
    expect(Math.floor(marker.creationTime)).toBe(marker.startedAt);
    expect(marker.startedAt).toBeGreaterThanOrEqual(
      deployment.importCompletedAt
    );
    expect(row.ownerDeletedAt - marker.startedAt).toBeGreaterThan(0);
    expect(row.ownerDeletedAt - marker.startedAt).toBeLessThanOrEqual(60_000);
  }
  expect(
    new Set(importedFixtures.map((row) => row.legacyMarker.stateId)).size
  ).toBe(10);
});
