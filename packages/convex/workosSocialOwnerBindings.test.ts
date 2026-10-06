/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  runSocialBindings,
  type SocialBindingPorts,
} from "../../scripts/workos-migration/bind-dev-social-owners";
import { components, internal } from "./_generated/api";
import {
  acknowledgeSocialOwnerBinding,
  checkSocialOwnerSource,
  prepareSocialOwnerBinding,
  socialOwnerBindingPins,
  socialOwnerPairs,
} from "./migration/workosSocialOwnerBindings";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const key = "test-workos-reconciliation-key";
const pins = {
  environmentId: socialOwnerBindingPins.environmentId,
  clientId: socialOwnerBindingPins.clientId,
  apiKeyFingerprint:
    "0cd3cf5f74c92c94559c4397065417ee80f45c5115d28889b9872049ea5533aa",
};
async function hash(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
beforeEach(() => {
  vi.stubEnv("AUTH_PRIMARY", "betterauth");
  vi.stubEnv("SIGNUPS_DISABLED", "true");
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "true");
  vi.stubEnv("CONVEX_CLOUD_URL", socialOwnerBindingPins.cloudUrl);
  vi.stubEnv("CONVEX_SITE_URL", socialOwnerBindingPins.siteUrl);
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", pins.environmentId);
  vi.stubEnv("WORKOS_CLIENT_ID", pins.clientId);
  vi.stubEnv("WORKOS_API_KEY", key);
});
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  const email = "social-proof@example.test",
    subject = "exact-provider-subject";
  const user = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name: "Social proof",
          email,
          emailVerified: true,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    })
  );
  if (!("_id" in user)) {
    throw new Error("Missing source ID");
  }
  const pair = {
    ownerId: String(user._id),
    providerId: "user_exact",
    provider: "google",
    emailHash: await hash(email),
    subjectHash: await hash(subject),
  };
  const account = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "account",
        data: {
          userId: pair.ownerId,
          providerId: pair.provider,
          accountId: subject,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    })
  );
  const owner = await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: pair.ownerId,
      email,
      emailVerified: true,
      role: "admin",
    })
  );
  const observed = {
    id: pair.providerId,
    externalId: null,
    emailHash: pair.emailHash,
    emailVerified: true,
    subjectHash: pair.subjectHash,
  };
  return { t, pair, observed, owner, account, email, subject };
}
// Real component/database failures: wrong social subject despite matching email;
// duplicate subject/owner/address; stale source; mapping/deletion/profile conflict;
// unverified identity; unrelated lease; intent loss. No source-text assertions.
test("a social proof reads its exact legacy owner without writing any identity", async () => {
  const { t, pair, observed, owner } = await setup();
  expect(
    (await t.run((ctx) => checkSocialOwnerSource(ctx, pair, observed)))._id
  ).toBe(owner);
  expect(
    (await t.run((ctx) => ctx.db.get(owner)))?.workosUserId
  ).toBeUndefined();
});
test.each(["email", "subject", "provider", "external-id", "verification"])(
  "rejects changed remote %s proof without a mapping",
  async (failure) => {
    const { t, pair, observed, owner } = await setup();
    const changed = {
      ...observed,
      ...(failure === "email" ? { emailHash: "wrong" } : {}),
      ...(failure === "subject" ? { subjectHash: "wrong" } : {}),
      ...(failure === "provider" ? { id: "user_other" } : {}),
      ...(failure === "external-id" ? { externalId: "other-owner" } : {}),
      ...(failure === "verification" ? { emailVerified: false } : {}),
    };
    await expect(
      t.run((ctx) => checkSocialOwnerSource(ctx, pair, changed))
    ).rejects.toThrow();
    expect(
      (await t.run((ctx) => ctx.db.get(owner)))?.workosUserId
    ).toBeUndefined();
  }
);
test.each([
  "duplicate-owner",
  "duplicate-email",
  "different-mapping",
  "provider-other-owner",
  "owner-deleted",
  "provider-deleted",
  "unverified-owner",
  "quarantine",
  "deleted-profile",
  "owned-profile",
  "deleted-event",
  "duplicate-subject",
  "queued-deletion",
])("refuses %s even with matching email and subject", async (failure) => {
  const { t, pair, observed, owner, email, subject } = await setup();
  await t.run(async (ctx) => {
    if (failure === "duplicate-owner") {
      await ctx.db.insert("users", {
        teakUserId: pair.ownerId,
        email: "other@example.test",
        emailVerified: true,
      });
    }
    if (failure === "duplicate-email") {
      await ctx.db.insert("users", {
        teakUserId: "another",
        email,
        emailVerified: true,
      });
    }
    if (failure === "different-mapping") {
      await ctx.db.patch(owner, { workosUserId: "user_different" });
    }
    if (failure === "provider-other-owner") {
      await ctx.db.insert("users", {
        teakUserId: "another",
        email: "other@example.test",
        emailVerified: true,
        workosUserId: pair.providerId,
      });
    }
    if (failure === "owner-deleted") {
      await ctx.db.patch(owner, { deletedAt: 2 });
    }
    if (failure === "provider-deleted") {
      await ctx.db.patch(owner, { workosDeletedAt: 2 });
    }
    if (failure === "unverified-owner") {
      await ctx.db.patch(owner, { emailVerified: false });
    }
    if (failure === "quarantine") {
      await ctx.db.insert("migrationQuarantine", {
        workosUserId: pair.providerId,
        email,
        reason: "external_id_mismatch",
        source: "webhook",
        createdAt: 2,
      });
    }
    if (failure === "deleted-profile" || failure === "owned-profile") {
      await ctx.db.insert("workosProfiles", {
        workosUserId: pair.providerId,
        revision: 1,
        source: "event",
        ...(failure === "deleted-profile"
          ? { deletedAt: 2 }
          : { teakUserId: "other" }),
      });
    }
    if (failure === "deleted-event") {
      await ctx.db.insert("workosEvents", {
        workosUserId: pair.providerId,
        eventId: "event_deleted",
        type: "user.deleted",
        createdAt: 2,
      });
    }
    if (failure === "duplicate-subject") {
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "account",
          data: {
            userId: "another",
            providerId: pair.provider,
            accountId: subject,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      });
    }
    if (failure === "queued-deletion") {
      await ctx.db.insert("accountDeletionStates", {
        userId: pair.ownerId,
        startedAt: 2,
      });
    }
  });
  await expect(
    t.run((ctx) => checkSocialOwnerSource(ctx, pair, observed))
  ).rejects.toThrow();
});
test("mapping and durable intent commit together and retain permanent ownership and role", async () => {
  const { t, pair, observed, owner } = await setup();
  const holder = crypto.randomUUID();
  const lease = await t.mutation(internal.migration.workosImportLease.acquire, {
    ...pins,
    holder,
    runId: await hash(JSON.stringify(socialOwnerPairs)),
  });
  const sourceVersion = await t.query(
    internal.migration.workosImportSource.version,
    { ...pins, teakUserId: pair.ownerId }
  );
  const result = await t.run((ctx) =>
    prepareSocialOwnerBinding(ctx, pair, {
      ...pins,
      ...lease,
      observed,
      sourceVersion,
    })
  );
  const row = await t.run((ctx) => ctx.db.get(owner));
  expect(row).toMatchObject({
    teakUserId: pair.ownerId,
    role: "admin",
    workosUserId: pair.providerId,
  });
  expect(result.sourceVersion).not.toBe(sourceVersion);
  expect(
    await t.run((ctx) => ctx.db.query("workosImportLeases").first())
  ).toMatchObject({
    status: "active",
    remoteIntent: {
      kind: "update",
      teakUserId: pair.ownerId,
      sourceVersion: result.sourceVersion,
    },
  });
  await expect(
    t.run((ctx) =>
      prepareSocialOwnerBinding(ctx, pair, {
        ...pins,
        ...lease,
        observed,
        sourceVersion,
      })
    )
  ).rejects.toThrow("uncertain");
});
test("a parent mutation failure rolls back the nested mapping and durable intent", async () => {
  const { t, pair, observed, owner } = await setup();
  const lease = await t.mutation(internal.migration.workosImportLease.acquire, {
    ...pins,
    holder: crypto.randomUUID(),
    runId: await hash(JSON.stringify(socialOwnerPairs)),
  });
  const sourceVersion = await t.query(
    internal.migration.workosImportSource.version,
    { ...pins, teakUserId: pair.ownerId }
  );
  await expect(
    t.run(async (ctx) => {
      await prepareSocialOwnerBinding(ctx, pair, {
        ...pins,
        ...lease,
        observed,
        sourceVersion,
      });
      // Both nested mutations succeeded, but neither may outlive its parent.
      throw new Error("Parent mutation aborted");
    })
  ).rejects.toThrow("Parent mutation aborted");
  expect(
    (await t.run((ctx) => ctx.db.get(owner)))?.workosUserId
  ).toBeUndefined();
  expect(
    (await t.run((ctx) => ctx.db.query("workosImportLeases").first()))
      ?.remoteIntent
  ).toBeUndefined();
});
test.each(["source-version", "unrelated-lease"])(
  "refused %s rolls back mapping and intent",
  async (failure) => {
    const { t, pair, observed, owner } = await setup();
    const lease = await t.mutation(
      internal.migration.workosImportLease.acquire,
      {
        ...pins,
        holder: crypto.randomUUID(),
        runId:
          failure === "unrelated-lease"
            ? "a".repeat(64)
            : await hash(JSON.stringify(socialOwnerPairs)),
      }
    );
    await expect(
      t.run((ctx) =>
        prepareSocialOwnerBinding(ctx, pair, {
          ...pins,
          ...lease,
          observed,
          sourceVersion: "stale",
        })
      )
    ).rejects.toThrow();
    expect(
      (await t.run((ctx) => ctx.db.get(owner)))?.workosUserId
    ).toBeUndefined();
    expect(
      (await t.run((ctx) => ctx.db.query("workosImportLeases").first()))
        ?.remoteIntent
    ).toBeUndefined();
  }
);
const inspect = makeFunctionReference<
  "query",
  {
    environmentId: string;
    clientId: string;
    apiKeyFingerprint: string;
    pair: string;
    observed: {
      id: string;
      externalId: null;
      emailHash: string;
      emailVerified: boolean;
      subjectHash: string;
    };
  },
  unknown
>("migration/workosSocialOwnerBindings:inspect");
test.each([
  "accepted",
  "stale-source",
  "concurrent-source-change",
  "null-remote",
  "late-deletion",
  "webhook-conflict",
])(
  "durable intent acknowledgment handles %s without weakening ownership",
  async (failure) => {
    const { t, pair, observed, owner, email } = await setup();
    const lease = await t.mutation(
      internal.migration.workosImportLease.acquire,
      {
        ...pins,
        holder: crypto.randomUUID(),
        runId: await hash(JSON.stringify(socialOwnerPairs)),
      }
    );
    const sourceVersion = await t.query(
      internal.migration.workosImportSource.version,
      { ...pins, teakUserId: pair.ownerId }
    );
    const prepared = await t.run((ctx) =>
      prepareSocialOwnerBinding(ctx, pair, {
        ...pins,
        ...lease,
        observed,
        sourceVersion,
      })
    );
    if (failure === "concurrent-source-change") {
      await t.run((ctx) =>
        ctx.runMutation(components.betterAuth.adapter.updateOne, {
          input: {
            model: "user",
            where: [{ field: "_id", value: pair.ownerId }],
            update: { name: "Changed during remote write", updatedAt: 2 },
          },
        })
      );
    }
    if (failure === "late-deletion") {
      await t.run((ctx) => ctx.db.patch(owner, { deletedAt: 2 }));
    }
    if (failure === "webhook-conflict") {
      await t.run((ctx) =>
        ctx.db.insert("migrationQuarantine", {
          workosUserId: pair.providerId,
          email,
          reason: "equal_timestamp_conflict",
          source: "webhook",
          createdAt: 2,
        })
      );
    }
    const input = {
      ...pins,
      ...lease,
      sourceVersion:
        failure === "stale-source" ? "stale" : prepared.sourceVersion,
      observed: {
        ...observed,
        externalId: failure === "null-remote" ? null : pair.ownerId,
      },
    };
    if (failure === "accepted") {
      await t.run((ctx) => acknowledgeSocialOwnerBinding(ctx, pair, input));
      expect(
        (await t.run((ctx) => ctx.db.query("workosImportLeases").first()))
          ?.remoteIntent
      ).toBeUndefined();
    } else {
      await expect(
        t.run((ctx) => acknowledgeSocialOwnerBinding(ctx, pair, input))
      ).rejects.toThrow();
      expect(
        (await t.run((ctx) => ctx.db.query("workosImportLeases").first()))
          ?.remoteIntent
      ).toMatchObject({ teakUserId: pair.ownerId });
    }
    expect((await t.run((ctx) => ctx.db.get(owner)))?.workosUserId).toBe(
      pair.providerId
    );
  }
);
test.each([
  "production",
  "key",
  "workos-primary",
  "unfrozen",
  "arbitrary-pair",
])("registered boundary denies %s", async (failure) => {
  const { t, observed } = await setup();
  if (failure === "production") {
    vi.stubEnv("CONVEX_CLOUD_URL", "https://production.convex.cloud");
  }
  if (failure === "key") {
    vi.stubEnv("WORKOS_API_KEY", "changed-key");
  }
  if (failure === "workos-primary") {
    vi.stubEnv("AUTH_PRIMARY", "workos");
  }
  if (failure === "unfrozen") {
    vi.stubEnv("SIGNUPS_DISABLED", "false");
  }
  const input = { ...pins, pair: "google" as const, observed };
  await expect(
    t.query(
      inspect,
      failure === "arbitrary-pair" ? { ...input, pair: "arbitrary" } : input
    )
  ).rejects.toThrow();
});
test("operator refuses production selector and missing repair approval before any network or database call", async () => {
  const calls: string[] = [];
  const ports: SocialBindingPorts = {
    run: () => {
      calls.push("database");
      throw new Error("unexpected");
    },
    getUser: () => {
      calls.push("provider");
      throw new Error("unexpected");
    },
    getIdentities: () => Promise.resolve([]),
    listUsers: () => {
      calls.push("list");
      return Promise.resolve({ data: [], after: null });
    },
    updateUser: () => {
      calls.push("write");
      throw new Error("unexpected");
    },
  };
  await expect(runSocialBindings(["--prod"], key, ports)).rejects.toThrow(
    "fixed development"
  );
  await expect(runSocialBindings(["--apply"], key, ports)).rejects.toThrow(
    "separate approval"
  );
  expect(calls).toEqual([]);
});
test("backend credential refusal happens before WorkOS enumeration in default dry-run", async () => {
  const calls: string[] = [];
  const ports: SocialBindingPorts = {
    run: () => {
      calls.push("admission");
      return Promise.reject(new Error("wrong dev credential"));
    },
    getUser: () => Promise.reject(new Error("unexpected")),
    getIdentities: () => Promise.resolve([]),
    listUsers: () => {
      calls.push("provider-list");
      return Promise.resolve({ data: [], after: null });
    },
    updateUser: () => {
      calls.push("provider-write");
      return Promise.reject(new Error("unexpected"));
    },
  };
  await expect(runSocialBindings([], "wrong-key", ports)).rejects.toThrow(
    "wrong dev credential"
  );
  expect(calls).toEqual(["admission"]);
});
test("registered writer requires the account-change pause before mapping or intent", async () => {
  const { t, observed, owner } = await setup();
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "false");
  const prepare = makeFunctionReference<
    "mutation",
    Record<string, unknown>,
    unknown
  >("migration/workosSocialOwnerBindings:prepare");
  await expect(
    t.mutation(prepare, {
      ...pins,
      pair: "google",
      observed,
      sourceVersion: "stale",
      holder: crypto.randomUUID(),
      generation: 1,
    })
  ).rejects.toThrow("pinned paused development");
  expect(
    (await t.run((ctx) => ctx.db.get(owner)))?.workosUserId
  ).toBeUndefined();
  expect(
    await t.run((ctx) => ctx.db.query("workosImportLeases").first())
  ).toBeNull();
});
test("default dry-run refuses a cyclic provider census without writes", async () => {
  let writes = 0;
  const ports: SocialBindingPorts = {
    run: <T>() => Promise.resolve(null as T),
    getUser: () => Promise.reject(new Error("unexpected")),
    getIdentities: () => Promise.resolve([]),
    listUsers: () =>
      Promise.resolve({
        data: [
          {
            id: "user_page",
            email: "page@example.test",
            emailVerified: true,
            externalId: null,
          },
        ],
        after: "same-cursor",
      }),
    updateUser: () => {
      writes++;
      return Promise.reject(new Error("unexpected"));
    },
  };
  await expect(runSocialBindings([], key, ports)).rejects.toThrow(
    "census incomplete"
  );
  expect(writes).toBe(0);
});
test("a partial component source census cannot prove social subject uniqueness", async () => {
  const { t, pair, observed, owner } = await setup();
  await t.run(async (ctx) => {
    for (let i = 0; i < 1000; i++) {
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "account",
          data: {
            userId: `other-${i}`,
            providerId: "google",
            accountId: `subject-${i}`,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      });
    }
  });
  await expect(
    t.run((ctx) => checkSocialOwnerSource(ctx, pair, observed))
  ).rejects.toThrow("scan incomplete");
  expect(
    (await t.run((ctx) => ctx.db.get(owner)))?.workosUserId
  ).toBeUndefined();
});

test.each([
  { shape: "empty continuation", empty: true, expectedCalls: 1 },
  { shape: "distinct nonempty pages", empty: false, expectedCalls: 10 },
])(
  "provider census bounds $shape before inspecting or writing identities",
  async ({ empty, expectedCalls }) => {
    const calls: string[] = [];
    let pageCalls = 0;
    const ports: SocialBindingPorts = {
      run: <T>() => {
        calls.push("admission");
        return Promise.resolve(null as T);
      },
      getUser: () => {
        calls.push("inspect-provider");
        return Promise.reject(new Error("unexpected inspection"));
      },
      getIdentities: () => Promise.resolve([]),
      listUsers: () => {
        pageCalls++;
        // Bound even a broken implementation so this regression never hangs.
        if (pageCalls > 10) {
          return Promise.reject(new Error("test network budget exceeded"));
        }
        return Promise.resolve({
          data: empty
            ? []
            : [
                {
                  id: `user_${pageCalls}`,
                  email: `${pageCalls}@example.test`,
                  emailVerified: true,
                  externalId: null,
                },
              ],
          after: `distinct-cursor-${pageCalls}`,
        });
      },
      updateUser: () => {
        calls.push("write");
        return Promise.reject(new Error("unexpected write"));
      },
    };
    await expect(runSocialBindings([], key, ports)).rejects.toThrow(
      "census incomplete"
    );
    expect(pageCalls).toBe(expectedCalls);
    expect(calls).toEqual(["admission"]);
  }
);
