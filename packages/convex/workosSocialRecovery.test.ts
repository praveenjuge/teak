/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  acquireSocialBindingLease,
  runSocialBindings,
  type SocialBindingPorts,
} from "../../scripts/workos-migration/bind-dev-social-owners";
import { socialOwnerBindingPins } from "./migration/workosSocialOwnerBindings";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const key = "test-social-recovery-key";
const approval = "test-explicit-repair-approval";
const pins = {
  environmentId: socialOwnerBindingPins.environmentId,
  clientId: socialOwnerBindingPins.clientId,
  apiKeyFingerprint: createHash("sha256").update(key).digest("hex"),
};
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
  const base = join(
    await mkdtemp(join(tmpdir(), "teak-social-recovery-")),
    "receipt"
  );
  const calls: string[] = [];
  let loseAcquireReply = true;
  const run: SocialBindingPorts["run"] = async <T>(
    name: string,
    args: unknown
  ) => {
    calls.push(name);
    const input = args as Record<string, unknown>;
    if (name.endsWith(":acquire")) {
      // The server commits before the transport loses its response.
      const result = await t.mutation(
        makeFunctionReference<"mutation", Record<string, unknown>, T>(name),
        input
      );
      if (loseAcquireReply) {
        throw new Error("Acquisition response lost");
      }
      return result;
    }
    if (name.endsWith(":release")) {
      return t.mutation(
        makeFunctionReference<"mutation", Record<string, unknown>, T>(name),
        input
      );
    }
    return t.query(
      makeFunctionReference<"query", Record<string, unknown>, T>(name),
      input
    );
  };
  const unexpectedProvider = () => {
    calls.push("provider-call");
    return Promise.reject(new Error("Recovery must not contact WorkOS"));
  };
  const ports: SocialBindingPorts = {
    run,
    getUser: unexpectedProvider,
    getIdentities: unexpectedProvider,
    listUsers: unexpectedProvider,
    updateUser: unexpectedProvider,
  };
  const recover = (receiptBase = base) =>
    runSocialBindings(
      ["--recover", "--receipt", receiptBase, "--approval-reference", approval],
      key,
      ports
    );
  const loseReply = async () => {
    await expect(
      acquireSocialBindingLease(base, "google", pins, approval, run)
    ).rejects.toThrow();
    loseAcquireReply = false;
    calls.length = 0;
  };
  return { t, base, calls, recover, loseReply };
}

test("a lost acquisition reply retains private authority and recovers only its exact lease without provider writes", async () => {
  const { t, base, calls, recover, loseReply } = await setup();
  await loseReply();
  const receiptPath = `${base}.google.json`;
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  expect((await stat(receiptPath)).mode % 0o1000).toBe(0o600);
  const before = await t.run((ctx) =>
    ctx.db.query("workosImportLeases").first()
  );
  expect(before).toMatchObject({
    status: "active",
    holder: receipt.holder,
    generation: 1,
  });
  expect(before?.remoteIntent).toBeUndefined();
  expect(await recover()).toMatchObject({
    mode: "lease-recovery",
    pairs: [{ pair: "google", status: "released" }],
  });
  const after = await t.run((ctx) =>
    ctx.db.query("workosImportLeases").first()
  );
  expect(after).toMatchObject({
    status: "released",
    holder: receipt.holder,
    generation: 1,
  });
  expect(calls.filter((name) => name.endsWith(":release"))).toHaveLength(1);
  expect(
    calls.some((name) => name.endsWith(":acquire") || name === "provider-call")
  ).toBe(false);
  calls.length = 0;
  expect(await recover()).toMatchObject({
    pairs: [{ pair: "google", status: "already-quiescent" }],
  });
  expect(
    calls.some((name) => name.endsWith(":release") || name === "provider-call")
  ).toBe(false);
});

test.each([
  "holder",
  "environmentId",
  "clientId",
  "apiKeyFingerprint",
  "approvalReference",
  "runId",
  "pair",
  "version",
])(
  "recovery refuses changed receipt %s and keeps the active lease fenced",
  async (field) => {
    const { t, base, calls, recover, loseReply } = await setup();
    await loseReply();
    const receiptPath = `${base}.google.json`;
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    receipt[field] = "changed";
    if (field === "version") {
      receipt[field] = 2;
    }
    if (field === "holder") {
      receipt[field] = crypto.randomUUID();
    }
    await writeFile(receiptPath, JSON.stringify(receipt), { mode: 0o600 });
    await expect(recover()).rejects.toThrow();
    expect(
      (await t.run((ctx) => ctx.db.query("workosImportLeases").first()))?.status
    ).toBe("active");
    expect(
      calls.some(
        (name) =>
          name.endsWith(":release") ||
          name.endsWith(":acquire") ||
          name === "provider-call"
      )
    ).toBe(false);
  }
);

test.each(["pending-intent", "uncertain", "quiesced", "changed-holder"])(
  "recovery refuses %s without forcing or replaying a lease",
  async (failure) => {
    const { t, calls, recover, loseReply } = await setup();
    await loseReply();
    await t.run(async (ctx) => {
      const row = await ctx.db.query("workosImportLeases").first();
      if (!row) {
        throw new Error("Missing committed lease");
      }
      await ctx.db.patch(row._id, {
        ...(failure === "uncertain" ? { status: "uncertain" as const } : {}),
        ...(failure === "quiesced" ? { status: "quiesced" as const } : {}),
        ...(failure === "changed-holder"
          ? { holder: crypto.randomUUID() }
          : {}),
        ...(failure === "pending-intent" || failure === "uncertain"
          ? {
              remoteIntent: {
                kind: "update" as const,
                teakUserId: "owner",
                sourceVersion: "version",
                startedAt: 1,
              },
            }
          : {}),
      });
    });
    const before = await t.run((ctx) =>
      ctx.db.query("workosImportLeases").first()
    );
    await expect(recover()).rejects.toThrow();
    expect(
      await t.run((ctx) => ctx.db.query("workosImportLeases").first())
    ).toEqual(before);
    expect(
      calls.some(
        (name) =>
          name.endsWith(":release") ||
          name.endsWith(":acquire") ||
          name === "provider-call"
      )
    ).toBe(false);
  }
);

test("an existing receipt prevents another acquisition without overwriting authority", async () => {
  const { base, calls, loseReply } = await setup();
  await loseReply();
  const before = await readFile(`${base}.google.json`, "utf8");
  await expect(
    acquireSocialBindingLease(base, "google", pins, approval, () => {
      calls.push("unexpected-acquire");
      return Promise.reject(new Error("Must not acquire"));
    })
  ).rejects.toThrow();
  expect(await readFile(`${base}.google.json`, "utf8")).toBe(before);
  expect(calls).toEqual([]);
});

test.each(["missing", "public-permissions", "symlink", "unpaused"])(
  "recovery refuses %s without releasing authority",
  async (failure) => {
    const { t, base, calls, recover, loseReply } = await setup();
    if (failure !== "missing") {
      await loseReply();
    }
    if (failure === "public-permissions") {
      await chmod(`${base}.google.json`, 0o644);
    }
    if (failure === "symlink") {
      await symlink(`${base}.google.json`, `${base}-linked.google.json`);
    }
    if (failure === "unpaused") {
      vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "false");
    }
    const before = await t.run((ctx) =>
      ctx.db.query("workosImportLeases").first()
    );
    await expect(
      recover(failure === "symlink" ? `${base}-linked` : base)
    ).rejects.toThrow();
    expect(
      await t.run((ctx) => ctx.db.query("workosImportLeases").first())
    ).toEqual(before);
    expect(
      calls.some(
        (name) =>
          name.endsWith(":release") ||
          name.endsWith(":acquire") ||
          name === "provider-call"
      )
    ).toBe(false);
  }
);
