import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

export interface BarrierReceipt {
  apiKeyFingerprint: string;
  approvalReference: string;
  clientId: string;
  deployment: string;
  environmentId: string;
  generation?: number;
  holder: string;
  runId: string;
  version: 1;
}
const execute = promisify(execFile);
export async function readPrivate(path: string): Promise<BarrierReceipt> {
  const info = await lstat(path);
  if (!info.isFile() || info.mode % 0o100 !== 0) {
    throw new Error("Barrier receipt must be an owner-only regular file");
  }
  return JSON.parse(await readFile(path, "utf8"));
}
export async function main(
  argv: string[],
  transport?: (name: string, args: unknown) => Promise<unknown>
) {
  const args: Record<string, string> = {};
  let apply = false;
  const known = new Set([
    "--deployment",
    "--environment-id",
    "--client-id",
    "--receipt",
    "--approval-reference",
    "--operation",
  ]);
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--apply" && !apply) {
      apply = true;
      continue;
    }
    if (
      !known.has(argv[index]) ||
      args[argv[index]] ||
      !argv[index + 1] ||
      argv[index + 1].startsWith("--")
    ) {
      throw new Error("Invalid barrier arguments");
    }
    args[argv[index]] = argv[++index];
  }
  const deployment = args["--deployment"],
    environmentId = args["--environment-id"],
    clientId = args["--client-id"],
    operation = args["--operation"] ?? "status";
  if (
    !(
      /^[A-Za-z0-9-]+$/.test(deployment ?? "") &&
      /^environment_[A-Za-z0-9]+$/.test(environmentId ?? "") &&
      /^client_[A-Za-z0-9]+$/.test(clientId ?? "") &&
      ["status", "establish", "verify", "release"].includes(operation)
    )
  ) {
    throw new Error("Explicit barrier deployment pins required");
  }
  if (operation !== "status" && !args["--receipt"]) {
    throw new Error("Barrier receipt path required");
  }
  if (
    apply &&
    (operation === "status" ||
      operation === "verify" ||
      !args["--approval-reference"])
  ) {
    throw new Error(
      "Barrier mutations require their separate recorded approval"
    );
  }
  const key = process.env.WORKOS_API_KEY;
  if (!key) {
    throw new Error("Explicit WorkOS API key required; dotenv is not loaded");
  }
  const apiKeyFingerprint = createHash("sha256").update(key).digest("hex"),
    pins = { environmentId, clientId, apiKeyFingerprint };
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
        deployment,
        name,
        JSON.stringify(input),
      ],
      {
        cwd: resolve(import.meta.dir, "../../packages/convex"),
        maxBuffer: 64 * 1024,
      }
    );
    return JSON.parse(stdout);
  };
  if (operation === "status" || (!apply && operation !== "verify")) {
    console.log(
      JSON.stringify({
        deployment,
        mutationExecuted: false,
        ...((await run(
          "migration/workosImportLease:quiescence",
          pins
        )) as object),
      })
    );
    return;
  }
  const receiptPath = resolve(args["--receipt"]);
  let receipt: BarrierReceipt;
  try {
    receipt = await readPrivate(receiptPath);
  } catch (error) {
    if (
      !(
        operation === "establish" &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
    ) {
      throw error;
    }
    receipt = {
      version: 1,
      deployment,
      ...pins,
      holder: crypto.randomUUID(),
      runId: createHash("sha256").update(crypto.randomUUID()).digest("hex"),
      approvalReference: args["--approval-reference"],
    };
    // Persist holder before backend mutation: a lost response can retry the same
    // holder idempotently, without replacing another operator's barrier.
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
  }
  if (
    receipt.version !== 1 ||
    receipt.deployment !== deployment ||
    receipt.environmentId !== environmentId ||
    receipt.clientId !== clientId ||
    receipt.apiKeyFingerprint !== apiKeyFingerprint ||
    !/^[0-9a-f-]{36}$/.test(receipt.holder) ||
    !/^[0-9a-f]{64}$/.test(receipt.runId)
  ) {
    throw new Error("Barrier receipt pins changed");
  }
  if (operation === "establish") {
    const held = (await run("migration/workosImportLease:establishQuiescence", {
      ...pins,
      holder: receipt.holder,
      runId: receipt.runId,
    })) as { holder: string; generation: number };
    if (
      held.holder !== receipt.holder ||
      !Number.isSafeInteger(held.generation) ||
      held.generation < 1
    ) {
      throw new Error("Malformed barrier acknowledgment");
    }
    const confirmed = { ...receipt, generation: held.generation };
    try {
      await writeFile(
        `${receiptPath}.held`,
        JSON.stringify(confirmed, null, 2),
        { flag: "wx", mode: 0o600 }
      );
    } catch (error) {
      if (
        !(
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "EEXIST"
        )
      ) {
        throw error;
      }
      if (
        JSON.stringify(await readPrivate(`${receiptPath}.held`)) !==
        JSON.stringify(confirmed)
      ) {
        throw new Error(
          "Existing held receipt disagrees with provider acknowledgment"
        );
      }
    }
    console.log(
      JSON.stringify({
        deployment,
        barrierHeld: true,
        receipt: `${receiptPath}.held`,
      })
    );
    return;
  }
  if (
    !Number.isSafeInteger(receipt.generation) ||
    (receipt.generation ?? 0) < 1
  ) {
    throw new Error("Confirmed held receipt required");
  }
  const held = {
    ...pins,
    holder: receipt.holder,
    generation: receipt.generation,
  };
  await run("migration/workosImportLease:verifyQuiescence", held);
  if (operation === "release") {
    await run("migration/workosImportLease:releaseQuiescence", held);
    await writeFile(
      `${receiptPath}.released.${crypto.randomUUID()}.json`,
      JSON.stringify({
        deployment,
        holder: receipt.holder,
        generation: receipt.generation,
        approvalReference: args["--approval-reference"],
        releasedAt: new Date().toISOString(),
      }),
      { flag: "wx", mode: 0o600 }
    );
  }
  console.log(
    JSON.stringify({
      deployment,
      barrierHeld: operation === "verify",
      mutationExecuted: operation === "release",
    })
  );
}
if (import.meta.main) {
  main(process.argv.slice(2)).catch(() => {
    console.error(
      "Importer barrier stopped; retain private receipts and inspect backend lease state before retrying."
    );
    process.exitCode = 1;
  });
}
