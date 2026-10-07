import { createHash } from "node:crypto";
import { lstat, open, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { runConvexFunction } from "./convex-cli-response";
import { type BarrierReceipt, readPrivate } from "./quiesce-importer";

const owner = z.object({
  teakUserId: z.string(),
  workosUserId: z.string().nullable(),
  deniedDeleted: z.boolean(),
  invalidateLegacyPassword: z.boolean(),
  markSameEmailVerified: z.boolean(),
  promoteDeletion: z.boolean(),
  blockers: z.array(z.string()).max(20),
});
const planPage = z.object({
  owners: z.array(owner).max(20),
  done: z.boolean(),
  cursor: z.string().min(1).max(8192).nullable(),
});
const applyPage = z.strictObject({
  scanned: z.number().int().min(0).max(20),
  invalidated: z.number().int().min(0).max(20),
  verified: z.number().int().min(0).max(20),
  deletionFences: z.number().int().min(0).max(20),
  done: z.boolean(),
  cursor: z.string().min(1).max(8192).nullable(),
});
type OwnerRow = z.infer<typeof owner>;
const planClasses = ["invalidate", "verify", "fences"] as const;
type PlanClass = (typeof planClasses)[number];
// Owners the writer would change, by class, exactly as the plan query reports.
const selected = (rows: OwnerRow[]): Record<PlanClass, string[]> => ({
  invalidate: rows
    .filter((row) => row.invalidateLegacyPassword)
    .map((row) => row.teakUserId),
  verify: rows
    .filter((row) => row.markSameEmailVerified)
    .map((row) => row.teakUserId),
  fences: rows
    .filter((row) => row.promoteDeletion)
    .map((row) => row.teakUserId),
});
const ownerSet = z.strictObject({
  count: z.number().int().min(0),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  teakUserIds: z.array(z.string()),
});
const reviewedReport = z.object({
  operation: z.literal("rollback-lifecycle"),
  mutationExecuted: z.literal(false),
  deployment: z.string(),
  environmentId: z.string(),
  clientId: z.string(),
  apiKeyFingerprint: z.string(),
  holder: z.string(),
  generation: z.number(),
  plan: z.object({
    mapping: z.strictObject({
      count: z.number().int().min(0),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      pairs: z.array(z.string().regex(/^[^\t]+\t[^\t]+$/)),
    }),
    deniedDeleted: ownerSet,
    invalidate: ownerSet,
    verify: ownerSet,
    fences: ownerSet,
  }),
});
// Sorted, newline-joined permanent owner IDs: the fingerprint an approval quotes.
const ownerDigest = (ids: string[]) =>
  createHash("sha256")
    .update([...ids].sort().join("\n"))
    .digest("hex");
const describe = (ids: string[]) => ({
  count: ids.length,
  sha256: ownerDigest(ids),
  teakUserIds: [...ids].sort(),
});
// Owner-to-provider links and tombstones must not move under a held barrier.
const describeMapping = (rows: OwnerRow[]) => {
  const pairs = rows
    .filter((row) => row.workosUserId)
    .map((row) => `${row.teakUserId}\t${row.workosUserId}`)
    .sort();
  return { count: pairs.length, sha256: ownerDigest(pairs), pairs };
};
const deniedOwners = (rows: OwnerRow[]) =>
  rows.filter((row) => row.deniedDeleted).map((row) => row.teakUserId);
// Apply admits only the owners a reviewed dry run under this same held barrier
// listed. Provider events still arrive while paused, so a fresh plan may shrink
// (resume) but never grow beyond what was reviewed and approved.
async function readReviewedPlan(path: string, receipt: BarrierReceipt) {
  const info = await lstat(path);
  if (!info.isFile() || info.mode % 0o100 !== 0) {
    throw new Error("Reviewed dry-run report must be an owner-only file");
  }
  const reviewed = reviewedReport.parse(
    JSON.parse(await readFile(path, "utf8"))
  );
  if (
    reviewed.deployment !== receipt.deployment ||
    reviewed.environmentId !== receipt.environmentId ||
    reviewed.clientId !== receipt.clientId ||
    reviewed.apiKeyFingerprint !== receipt.apiKeyFingerprint ||
    reviewed.holder !== receipt.holder ||
    reviewed.generation !== receipt.generation ||
    reviewed.plan.mapping.count !== reviewed.plan.mapping.pairs.length ||
    reviewed.plan.mapping.sha256 !== ownerDigest(reviewed.plan.mapping.pairs) ||
    ([...planClasses, "deniedDeleted"] as const).some(
      (name) =>
        reviewed.plan[name].count !== reviewed.plan[name].teakUserIds.length ||
        reviewed.plan[name].sha256 !==
          ownerDigest(reviewed.plan[name].teakUserIds)
    )
  ) {
    throw new Error("Reviewed dry-run report is not for this held barrier");
  }
  return reviewed.plan;
}
// Deliberately never flips primary or releases the barrier. A lost acknowledgment
// resumes from the first page; guarded idempotent mutations avoid stale cursors.
export async function main(
  argv: string[],
  transport?: (name: string, args: unknown) => Promise<unknown>
) {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      receipt: { type: "string" },
      deployment: { type: "string" },
      report: { type: "string" },
      apply: { type: "boolean", default: false },
      "password-policy": { type: "string" },
      "policy-approval-reference": { type: "string" },
      "activation-approval-reference": { type: "string" },
      "reviewed-dry-run": { type: "string" },
    },
  });
  if (
    !(
      values.receipt &&
      values.report &&
      /^[A-Za-z0-9-]+$/.test(values.deployment ?? "")
    )
  ) {
    throw new Error(
      "Exact deployment, private barrier receipt and new report path required"
    );
  }
  if (
    values.apply &&
    (values["password-policy"] !== "invalidate-all-mapped-legacy-passwords" ||
      !values["policy-approval-reference"]?.trim() ||
      !values["activation-approval-reference"]?.trim() ||
      !values["reviewed-dry-run"])
  ) {
    throw new Error(
      "Separate named password policy and rollback activation approvals required, with the reviewed dry-run report"
    );
  }
  const reportPath = resolve(values.report);
  const parent = await lstat(dirname(reportPath));
  if (!parent.isDirectory() || parent.mode % 0o100 !== 0) {
    throw new Error("Rollback report requires an owner-only directory");
  }
  try {
    await lstat(reportPath);
    throw new Error(
      "Rollback report path already exists; choose a new artifact"
    );
  } catch (error) {
    if (
      !(
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
    ) {
      throw error;
    }
  }
  const receipt = await readPrivate(resolve(values.receipt)),
    key = process.env.WORKOS_API_KEY;
  if (
    !key ||
    receipt.version !== 1 ||
    receipt.deployment !== values.deployment ||
    receipt.apiKeyFingerprint !==
      createHash("sha256").update(key).digest("hex") ||
    !/^environment_[A-Za-z0-9]+$/.test(receipt.environmentId) ||
    !/^client_[A-Za-z0-9]+$/.test(receipt.clientId) ||
    !/^[0-9a-f-]{36}$/.test(receipt.holder) ||
    !Number.isSafeInteger(receipt.generation) ||
    (receipt.generation ?? 0) < 1
  ) {
    throw new Error("Rollback barrier pins or credentials changed");
  }
  const reviewed = values["reviewed-dry-run"]
    ? await readReviewedPlan(resolve(values["reviewed-dry-run"]), receipt)
    : null;
  const pins = {
    environmentId: receipt.environmentId,
    clientId: receipt.clientId,
    apiKeyFingerprint: receipt.apiKeyFingerprint,
    holder: receipt.holder,
    generation: receipt.generation,
  };
  // Durable exclusive invocation evidence is reserved before any backend call.
  // On uncertain acknowledgment, retain this journal and explicitly rerun with
  // a fresh report path plus the same approved policy/pins; replay starts at null.
  const invocation = await open(`${reportPath}.invocation.jsonl`, "wx", 0o600);
  const invocationBase = {
    version: 1,
    ...receipt,
    operation: "rollback-lifecycle",
    apply: values.apply,
    passwordPolicy: values["password-policy"] ?? null,
    policyApprovalReference: values["policy-approval-reference"] ?? null,
    activationApprovalReference:
      values["activation-approval-reference"] ?? null,
    reportPath,
    processId: process.pid,
    startedAt: new Date().toISOString(),
  };
  let lastAcknowledgment: unknown = null;
  const record = async (stage: string, cursor: string | null = null) => {
    await invocation.writeFile(
      `${JSON.stringify({
        ...invocationBase,
        stage,
        cursor,
        lastAcknowledgment,
        recordedAt: new Date().toISOString(),
      })}\n`
    );
    await invocation.sync();
  };
  try {
    await record("admitted");
    const run = async (name: string, args: unknown) =>
      transport
        ? await transport(name, args)
        : await runConvexFunction(receipt.deployment, name, args, 128 * 1024);
    const verify = () =>
      run("migration/workosImportLease:verifyQuiescence", pins);
    const inspect = async (requireApplied: boolean) => {
      let cursor: string | null = null;
      const rows: OwnerRow[] = [];
      const seen = new Set<string>();
      for (let index = 0; index < 10_000; index++) {
        await verify();
        const result = planPage.parse(
          await run("migration/workosRollbackPlan:page", {
            environmentId: pins.environmentId,
            clientId: pins.clientId,
            cursor,
          })
        );
        if (
          result.owners.some(
            (row) =>
              row.blockers.length ||
              (requireApplied &&
                (row.invalidateLegacyPassword ||
                  row.markSameEmailVerified ||
                  row.promoteDeletion))
          )
        ) {
          throw new Error(
            "Rollback lifecycle is not ready; keep account changes paused and barrier held"
          );
        }
        rows.push(...result.owners);
        if (result.done !== (result.cursor === null)) {
          throw new Error("Malformed rollback audit completion");
        }
        if (result.done) {
          return rows;
        }
        if (
          !result.owners.length ||
          result.cursor === cursor ||
          !result.cursor ||
          seen.has(result.cursor)
        ) {
          throw new Error("Rollback audit did not progress");
        }
        cursor = result.cursor;
        seen.add(cursor);
      }
      throw new Error(
        "Rollback audit budget exceeded; no partial clear result"
      );
    };
    const outsideReviewed = (plan: Record<PlanClass, string[]>) =>
      reviewed !== null &&
      planClasses.some((name) =>
        plan[name].some((id) => !reviewed[name].teakUserIds.includes(id))
      );
    // Fail before any dispatch when links or tombstones already drifted; the
    // writer re-checks every page in its own transaction.
    const stateOutsideReviewed = (rows: OwnerRow[]) => {
      if (reviewed === null) {
        return false;
      }
      // A reviewed fence was already denied at review time, so this includes it.
      const allowed = new Set(reviewed.deniedDeleted.teakUserIds);
      return (
        describeMapping(rows).sha256 !== reviewed.mapping.sha256 ||
        deniedOwners(rows).some((id) => !allowed.has(id))
      );
    };
    await verify();
    const before = await inspect(false);
    const plan = selected(before);
    if (outsideReviewed(plan) || stateOutsideReviewed(before)) {
      throw new Error(
        "Fresh rollback plan exceeds the reviewed dry run; nothing was written"
      );
    }
    const counts = {
      scanned: 0,
      invalidated: 0,
      verified: 0,
      deletionFences: 0,
    };
    if (values.apply) {
      // The writer refuses, in the same transaction as its writes, any page
      // that strays from this scope: provider events keep landing while paused.
      const scope = reviewed && {
        invalidate: reviewed.invalidate.teakUserIds,
        verify: reviewed.verify.teakUserIds,
        fences: reviewed.fences.teakUserIds,
        denied: reviewed.deniedDeleted.teakUserIds,
        mappings: reviewed.mapping.pairs.map((pair) => {
          const [teakUserId, workosUserId] = pair.split("\t");
          return { teakUserId, workosUserId };
        }),
      };
      let cursor: string | null = null,
        complete = false;
      const seen = new Set<string>();
      for (let index = 0; index < 10_000; index++) {
        await record("dispatching_page", cursor);
        const result = applyPage.parse(
          await run("migration/workosRollback:applyPage", {
            ...pins,
            cursor,
            passwordPolicy: values["password-policy"],
            policyApprovalReference: values["policy-approval-reference"],
            activationApprovalReference:
              values["activation-approval-reference"],
            reviewed: scope,
          })
        );
        if (
          result.done !== (result.cursor === null) ||
          result.invalidated > result.scanned ||
          result.verified > result.scanned ||
          result.deletionFences > result.scanned
        ) {
          throw new Error("Malformed rollback writer acknowledgment");
        }
        lastAcknowledgment = { cursor, result };
        await record("page_acknowledged", cursor);
        for (const field of [
          "scanned",
          "invalidated",
          "verified",
          "deletionFences",
        ] as const) {
          counts[field] += result[field];
        }
        if (result.done) {
          complete = true;
          break;
        }
        if (
          !(result.scanned && result.cursor) ||
          result.cursor === cursor ||
          seen.has(result.cursor)
        ) {
          throw new Error("Rollback writer did not progress");
        }
        cursor = result.cursor;
        seen.add(cursor);
      }
      if (!complete) {
        throw new Error(
          "Rollback writer budget exceeded; retain pause and barrier"
        );
      }
    }
    const after = values.apply ? await inspect(true) : before;
    if (stateOutsideReviewed(after)) {
      throw new Error(
        "Owner mapping or deletion state changed outside the reviewed dry run; retain pause and barrier"
      );
    }
    const beforeScanned = before.length;
    const afterScanned = after.length;
    await verify();
    // A paged audit is not an atomic flip authorization. Delayed lifecycle events
    // still require a fresh final operator audit immediately before the flag change.
    const report = {
      version: 1,
      ...receipt,
      operation: "rollback-lifecycle",
      passwordPolicy: values["password-policy"] ?? null,
      policyApprovalReference: values["policy-approval-reference"] ?? null,
      activationApprovalReference:
        values["activation-approval-reference"] ?? null,
      mutationExecuted: values.apply,
      beforeScanned,
      afterScanned,
      counts,
      // The plan observed before any write. A dry run's plan is what an
      // activation approval reviews and what --reviewed-dry-run admits.
      plan: {
        owners: before.length,
        mapped: before.filter((row) => row.workosUserId).length,
        mapping: describeMapping(before),
        deniedDeleted: describe(deniedOwners(before)),
        invalidate: describe(plan.invalidate),
        verify: describe(plan.verify),
        fences: describe(plan.fences),
      },
      barrierHeld: true,
      primaryChanged: false,
      accountsUnpaused: false,
      runtimeRollbackProven: false,
      finishedAt: new Date().toISOString(),
    };
    await writeFile(resolve(values.report), JSON.stringify(report, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
    await record("completed");
    console.log(
      JSON.stringify({
        mutationExecuted: values.apply,
        beforeScanned,
        afterScanned,
        counts,
        primaryChanged: false,
        barrierHeld: true,
      })
    );
  } finally {
    await invocation.close();
  }
}
if (import.meta.main) {
  await main(process.argv.slice(2));
}
