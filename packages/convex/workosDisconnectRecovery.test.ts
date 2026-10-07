/// <reference types="vite/client" />

import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { sha256 } from "./publicApiHttpShared";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const pins = {
  cloudUrl: "https://recovery-tests.convex.cloud",
  siteUrl: "https://recovery-tests.convex.site",
  environmentId: "environment_TEST",
  authKitClientId: "client_ENV",
  authKitDomain: "https://recovery-tests.authkit.app",
};
const key = "non-secret-recovery-test-fixture";
beforeEach(() => {
  vi.stubEnv("CONVEX_CLOUD_URL", pins.cloudUrl);
  vi.stubEnv("CONVEX_SITE_URL", pins.siteUrl);
  vi.stubEnv("WORKOS_API_KEY", key);
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", pins.environmentId);
  vi.stubEnv("WORKOS_CLIENT_ID", pins.authKitClientId);
  vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", pins.authKitDomain);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_800_000_000_000);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function setup(state: "unknown" | "dispatched" = "unknown") {
  const t = convexTest(schema, modules);
  const credentialFingerprint = await sha256(key);
  const fenceId = await t.run(async (ctx) => {
    await ctx.db.insert("workosConsents", {
      workosUserId: "user_ONE",
      userId: "owner",
      clientId: "client_ONE",
      consentId: "app_consent_ONE",
      firstSeenAt: 1,
      lastSeenAt: 1,
      revokedAt: 2,
    });
    return ctx.db.insert("workosApplicationDisconnects", {
      operationId: "original-operation",
      userId: "owner",
      workosUserId: "user_ONE",
      clientId: "client_ONE",
      triggerConsentId: "app_consent_ONE",
      applicationId: "connect_app_ONE",
      environmentId: pins.environmentId,
      authKitClientId: pins.authKitClientId,
      authKitDomain: pins.authKitDomain,
      credentialFingerprint,
      state,
      startedAt: 2,
      dispatchedAt: 3,
    });
  });
  const plan = await t.query(internal.workosDisconnectRecovery.inspect, {
    ...pins,
    credentialFingerprint,
    fenceId,
  });
  if (!plan) {
    throw new Error("Expected recoverable fence");
  }
  const { state: _state, ...operation } = plan;
  const args = {
    ...operation,
    approvalReference: "user-approved-exact-recovery-proposal",
    evidence: {
      kind: "preserved-204" as const,
      reference: "encrypted-operator-journal/original-204-response",
      originalRequestId: "original-provider-request",
      originalDeletionCompleted: true as const,
      noPendingOriginalRequest: true as const,
    },
  };
  return { t, args };
}

test.each(["unknown", "dispatched"] as const)(
  "recovers confirmed %s without provider requests and retains cooldown",
  async (state) => {
    const { t, args } = await setup(state);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(
      await t.action(internal.workosDisconnectRecovery.recover, args)
    ).toBe(204);
    expect(fetcher).not.toHaveBeenCalled();
    const row = await t.run((ctx) =>
      ctx.db.get("workosApplicationDisconnects", args.fenceId)
    );
    expect(row?.state).toBe("completed");
    expect(row?.providerAcknowledgedAt).toBe(Date.now());
    expect(row?.releaseAfter).toBe(Date.now() + 305_000);
    const consents = await t.run((ctx) =>
      ctx.db.query("workosConsents").take(2)
    );
    expect(consents[0].disconnectCompletedAt).toBe(Date.now());
    expect(consents[0].recoveryReceipt).toMatchObject({
      operationId: args.operationId,
      snapshotDigest: args.snapshotDigest,
      approvalReference: args.approvalReference,
      evidenceReference: args.evidence.reference,
      originalRequestId: args.evidence.originalRequestId,
      environmentId: args.environmentId,
      cloudUrl: args.cloudUrl,
      applicationId: args.applicationId,
    });
    // A later fence generation must not erase this consent's approval/evidence.
    await t.run((ctx) =>
      ctx.db.patch(args.fenceId, { operationId: "later-operation" })
    );
    const retained = await t.run((ctx) =>
      ctx.db.query("workosConsents").take(1)
    );
    expect(retained[0].recoveryReceipt?.operationId).toBe(args.operationId);
  }
);

test("provider written confirmation follows the same exact guarded recovery", async () => {
  const { t, args } = await setup();
  expect(
    await t.action(internal.workosDisconnectRecovery.recover, {
      ...args,
      evidence: { ...args.evidence, kind: "provider-written-confirmation" },
    })
  ).toBe(204);
});

test.each([
  ["operationId", "other-operation"],
  ["userId", "other-owner"],
  ["workosUserId", "user_OTHER"],
  ["clientId", "client_OTHER"],
  ["applicationId", "connect_app_OTHER"],
  ["triggerConsentId", "app_consent_OTHER"],
  ["snapshotDigest", "0".repeat(64)],
  ["cloudUrl", "https://other.convex.cloud"],
  ["siteUrl", "https://other.convex.site"],
  ["environmentId", "environment_OTHER"],
  ["authKitClientId", "client_OTHER"],
  ["authKitDomain", "https://other.authkit.app"],
  ["credentialFingerprint", "0".repeat(64)],
])(
  "denies a changed %s before acknowledging or releasing the fence",
  async (field, value) => {
    const { t, args } = await setup();
    await expect(
      t.mutation(internal.workosDisconnectRecovery.acknowledgeConfirmed, {
        ...args,
        [field]: value,
      })
    ).rejects.toThrow();
    const row = await t.run((ctx) =>
      ctx.db.get("workosApplicationDisconnects", args.fenceId)
    );
    expect(row?.state).toBe("unknown");
    expect(row?.recoveryReceipt).toBeUndefined();
  }
);

test.each([
  "CONVEX_CLOUD_URL",
  "CONVEX_SITE_URL",
  "WORKOS_API_KEY",
  "WORKOS_ENVIRONMENT_ID",
  "WORKOS_CLIENT_ID",
  "WORKOS_AUTHKIT_DOMAIN",
])("denies changed runtime %s with the old prepared proposal", async (name) => {
  const { t, args } = await setup();
  vi.stubEnv(name, "different-target");
  await expect(
    t.mutation(internal.workosDisconnectRecovery.acknowledgeConfirmed, args)
  ).rejects.toThrow("target mismatch");
});

test.each(["operationId", "dispatchedAt"])(
  "row digest CAS rejects a changed %s or generation",
  async (field) => {
    const { t, args } = await setup();
    await t.run((ctx) =>
      ctx.db.patch(
        args.fenceId,
        field === "operationId"
          ? { operationId: "new-generation" }
          : { dispatchedAt: 4 }
      )
    );
    await expect(
      t.mutation(internal.workosDisconnectRecovery.acknowledgeConfirmed, args)
    ).rejects.toThrow("snapshot changed");
  }
);

test.each(["approval", "evidence", "request"])(
  "missing %s reference cannot acknowledge unknown provider outcome",
  async (part) => {
    const { t, args } = await setup();
    const input = {
      ...args,
      approvalReference: part === "approval" ? "" : args.approvalReference,
      evidence: {
        ...args.evidence,
        reference: part === "evidence" ? "" : args.evidence.reference,
        originalRequestId:
          part === "request" ? "" : args.evidence.originalRequestId,
      },
    };
    await expect(
      t.mutation(internal.workosDisconnectRecovery.acknowledgeConfirmed, input)
    ).rejects.toThrow("approval and positive provider evidence required");
  }
);

const untrustedRecovery = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  null
>("workosDisconnectRecovery:acknowledgeConfirmed");
test.each([
  { kind: "provider-absence" },
  { originalDeletionCompleted: false },
  { noPendingOriginalRequest: false },
])("weak evidence %j is rejected by the internal writer", async (change) => {
  const { t, args } = await setup();
  await expect(
    t.mutation(untrustedRecovery, {
      ...args,
      evidence: { ...args.evidence, ...change },
    })
  ).rejects.toThrow();
  const row = await t.run((ctx) =>
    ctx.db.get("workosApplicationDisconnects", args.fenceId)
  );
  expect(row?.state).toBe("unknown");
});

test("approved recovery resumes acknowledged cleanup and completed retries without resetting cooldown", async () => {
  const { t, args } = await setup();
  await t.mutation(
    internal.workosDisconnectRecovery.acknowledgeConfirmed,
    args
  );
  const acknowledgedAt = Date.now();
  vi.setSystemTime(acknowledgedAt + 10_000);
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  expect(await t.action(internal.workosDisconnectRecovery.recover, args)).toBe(
    204
  );
  vi.setSystemTime(acknowledgedAt + 20_000);
  expect(await t.action(internal.workosDisconnectRecovery.recover, args)).toBe(
    204
  );
  const row = await t.run((ctx) =>
    ctx.db.get("workosApplicationDisconnects", args.fenceId)
  );
  expect(row?.providerAcknowledgedAt).toBe(acknowledgedAt);
  expect(row?.releaseAfter).toBe(acknowledgedAt + 305_000);
  expect(fetcher).not.toHaveBeenCalled();
});

test.each(["approval", "evidence"])(
  "resuming recovery cannot substitute the recorded %s reference",
  async (part) => {
    const { t, args } = await setup();
    await t.mutation(
      internal.workosDisconnectRecovery.acknowledgeConfirmed,
      args
    );
    await expect(
      t.action(internal.workosDisconnectRecovery.recover, {
        ...args,
        approvalReference:
          part === "approval" ? "other-approval" : args.approvalReference,
        evidence: {
          ...args.evidence,
          reference:
            part === "evidence" ? "other-evidence" : args.evidence.reference,
        },
      })
    ).rejects.toThrow("approval or evidence changed");
  }
);
