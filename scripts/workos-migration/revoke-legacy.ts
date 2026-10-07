import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs, promisify } from "node:util";
import { z } from "zod";
import { parseConvexCliResponse } from "./convex-cli-response";
import { readPrivate } from "./quiesce-importer";

const grantPage = z
  .strictObject({
    deleted: z.number().int().min(0).max(20),
    scanned: z.number().int().min(0).max(20),
    done: z.boolean(),
    cursor: z.string().min(1).max(8192).nullable(),
    blockedIds: z.array(z.string().min(1).max(128)).max(20),
  })
  .refine(
    (page) =>
      page.deleted <= page.scanned &&
      page.blockedIds.length <= page.scanned &&
      page.done === (page.cursor === null)
  );

// This command performs Phase 5 step 5 only. It never flips primary, clears the
// barrier, unpauses writes, imports users or claims the full cutover is complete.
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
      "approval-reference": { type: "string" },
      apply: { type: "boolean", default: false },
    },
  });
  if (!(values.receipt && /^[A-Za-z0-9-]+$/.test(values.deployment ?? ""))) {
    throw new Error("Exact deployment and confirmed barrier receipt required");
  }
  if (values.apply && !values["approval-reference"]?.trim()) {
    throw new Error(
      "Legacy credential revocation requires separate activation approval"
    );
  }
  const path = resolve(values.receipt),
    receipt = await readPrivate(path);
  const key = process.env.WORKOS_API_KEY;
  if (
    !key ||
    receipt.deployment !== values.deployment ||
    receipt.version !== 1 ||
    receipt.apiKeyFingerprint !==
      createHash("sha256").update(key).digest("hex") ||
    !/^environment_[A-Za-z0-9]+$/.test(receipt.environmentId) ||
    !/^client_[A-Za-z0-9]+$/.test(receipt.clientId) ||
    !/^[0-9a-f-]{36}$/.test(receipt.holder) ||
    !Number.isSafeInteger(receipt.generation) ||
    (receipt.generation ?? 0) < 1
  ) {
    throw new Error("Confirmed barrier credential/deployment pins changed");
  }
  const pins = {
    environmentId: receipt.environmentId,
    clientId: receipt.clientId,
    apiKeyFingerprint: receipt.apiKeyFingerprint,
    holder: receipt.holder,
    generation: receipt.generation,
  };
  const execute = promisify(execFile);
  const run = async (name: string, input: unknown) => {
    if (transport) {
      return await transport(name, input);
    }
    const { stdout } = await execute(
      process.execPath,
      [
        "x",
        "convex",
        "run",
        "--deployment-name",
        receipt.deployment,
        name,
        JSON.stringify(input),
      ],
      {
        cwd: resolve(import.meta.dir, "../../packages/convex"),
        maxBuffer: 64 * 1024,
      }
    );
    return parseConvexCliResponse(stdout);
  };
  await run("migration/workosImportLease:verifyQuiescence", pins);
  if (!values.apply) {
    console.log(
      JSON.stringify({
        deployment: receipt.deployment,
        mutationExecuted: false,
        barrierHeld: true,
      })
    );
    return;
  }
  const counts = {
    session: 0,
    oauthAccessToken: 0,
    nativeAuthCodes: 0,
    pendingGrants: 0,
  };
  for (const model of ["session", "oauthAccessToken"] as const) {
    let done = false;
    for (let page = 0; page < 10_000; page++) {
      const result = await run("migration/workosCutover:revokeLegacyPage", {
        ...pins,
        model,
      });
      if (
        typeof result !== "object" ||
        result === null ||
        !("deleted" in result) ||
        !("done" in result) ||
        !Number.isSafeInteger(result.deleted) ||
        Number(result.deleted) < 0 ||
        Number(result.deleted) > 20 ||
        typeof result.done !== "boolean" ||
        result.done !== (result.deleted === 0)
      ) {
        throw new Error(
          "Malformed legacy revocation acknowledgment; keep account writes paused"
        );
      }
      counts[model] += Number(result.deleted);
      if (result.done) {
        done = true;
        break;
      }
    }
    if (!done) {
      throw new Error(
        "Legacy revocation bounded stop; retain pause and barrier, retry separately"
      );
    }
  }
  let nativeDone = false;
  for (let page = 0; page < 10_000; page++) {
    const result = await run(
      "migration/workosCutover:revokeNativeCodesPage",
      pins
    );
    if (
      typeof result !== "object" ||
      result === null ||
      !("deleted" in result) ||
      !("done" in result) ||
      !Number.isSafeInteger(result.deleted) ||
      Number(result.deleted) < 0 ||
      Number(result.deleted) > 20 ||
      result.done !== (result.deleted === 0)
    ) {
      throw new Error("Malformed native grant revocation acknowledgment");
    }
    counts.nativeAuthCodes += Number(result.deleted);
    if (result.done) {
      nativeDone = true;
      break;
    }
  }
  if (!nativeDone) {
    throw new Error(
      "Native grant revocation bounded stop; retain pause and barrier"
    );
  }
  let cursor: string | null = null,
    grantsDone = false;
  const seen = new Set<string>();
  for (let page = 0; page < 10_000; page++) {
    const result = grantPage.parse(
      await run("migration/workosCutover:revokePendingGrantsPage", {
        ...pins,
        cursor,
      })
    );
    counts.pendingGrants += result.deleted;
    if (result.blockedIds.length > 0) {
      const blockedArtifact = `${path}.legacy-grants-blocked.${crypto.randomUUID()}.json`;
      await writeFile(
        blockedArtifact,
        JSON.stringify(
          {
            deployment: receipt.deployment,
            holder: receipt.holder,
            generation: receipt.generation,
            blockedIds: result.blockedIds,
            barrierHeld: true,
            completed: false,
          },
          null,
          2
        ),
        { flag: "wx", mode: 0o600 }
      );
      throw new Error(
        "Ambiguous pending grants require separate operator review; retain pause and barrier"
      );
    }
    if (result.done) {
      grantsDone = true;
      break;
    }
    if (
      result.scanned === 0 ||
      result.cursor === cursor ||
      !result.cursor ||
      seen.has(result.cursor)
    ) {
      throw new Error(
        "Pending grant scan did not advance; retain pause and barrier"
      );
    }
    cursor = result.cursor;
    seen.add(cursor);
  }
  if (!grantsDone) {
    throw new Error(
      "Pending grant scan bounded stop; retain pause and barrier"
    );
  }
  await run("migration/workosImportLease:verifyQuiescence", pins);
  const artifact = `${path}.legacy-revoked.${crypto.randomUUID()}.json`;
  await writeFile(
    artifact,
    JSON.stringify(
      {
        ...receipt,
        approvalReference: values["approval-reference"],
        counts,
        finishedAt: new Date().toISOString(),
        step: "legacy-session-token-and-pending-grant-revocation",
        barrierHeld: true,
        accountWritesRemainPaused: true,
      },
      null,
      2
    ),
    { flag: "wx", mode: 0o600 }
  );
  console.log(
    JSON.stringify({
      deployment: receipt.deployment,
      mutationExecuted: true,
      artifact,
      counts,
      barrierHeld: true,
    })
  );
}
if (import.meta.main) {
  main(process.argv.slice(2)).catch(() => {
    console.error(
      "Legacy revocation stopped; keep account writes paused and retain the held barrier. Inspect backend state before retrying."
    );
    process.exitCode = 1;
  });
}
