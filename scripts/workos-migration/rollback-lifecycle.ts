import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, open, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";
import { z } from "zod";
import { parseConvexCliResponse } from "./convex-cli-response";
import { readPrivate } from "./quiesce-importer";

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
      !values["activation-approval-reference"]?.trim())
  ) {
    throw new Error(
      "Separate named password policy and rollback activation approvals required"
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
    const execute = promisify(execFile);
    const run = async (name: string, args: unknown) => {
      if (transport) {
        return await transport(name, args);
      }
      const { stdout } = await execute(
        process.execPath,
        [
          "--no-env-file",
          "x",
          "convex",
          "run",
          "--deployment-name",
          receipt.deployment,
          name,
          JSON.stringify(args),
        ],
        {
          cwd: resolve(import.meta.dir, "../../packages/convex"),
          maxBuffer: 128 * 1024,
        }
      );
      return parseConvexCliResponse(stdout);
    };
    const verify = () =>
      run("migration/workosImportLease:verifyQuiescence", pins);
    const inspect = async (requireApplied: boolean) => {
      let cursor: string | null = null,
        scanned = 0;
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
        scanned += result.owners.length;
        if (result.done !== (result.cursor === null)) {
          throw new Error("Malformed rollback audit completion");
        }
        if (result.done) {
          return scanned;
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
    await verify();
    const beforeScanned = await inspect(false);
    const counts = {
      scanned: 0,
      invalidated: 0,
      verified: 0,
      deletionFences: 0,
    };
    if (values.apply) {
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
    const afterScanned = values.apply ? await inspect(true) : beforeScanned;
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
