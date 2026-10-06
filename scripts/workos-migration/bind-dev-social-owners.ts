import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { WorkOS } from "@workos-inc/node";
import {
  socialOwnerBindingPins,
  socialOwnerPairs,
} from "../../packages/convex/migration/workosSocialOwnerBindings";

const execute = promisify(execFile);
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
interface Provider {
  email: string;
  emailVerified: boolean;
  externalId: string | null;
  id: string;
}
interface Identity {
  idpId: string;
  provider: string;
}
export interface SocialBindingPorts {
  getIdentities: (id: string) => Promise<Identity[]>;
  getUser: (id: string) => Promise<Provider>;
  listUsers: (
    after?: string
  ) => Promise<{ data: Provider[]; after: string | null }>;
  run: <T>(name: string, args: unknown) => Promise<T>;
  updateUser: (input: {
    userId: string;
    externalId: string;
  }) => Promise<Provider>;
}
function argumentsFor(argv: string[]) {
  let apply = false;
  let recover = false;
  let approval: string | undefined;
  let receipt: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply" && !apply) {
      apply = true;
    } else if (argv[i] === "--recover" && !recover) {
      recover = true;
    } else if (
      argv[i] === "--receipt" &&
      !receipt &&
      argv[i + 1] &&
      !argv[i + 1].startsWith("--")
    ) {
      receipt = argv[++i];
    } else if (
      argv[i] === "--approval-reference" &&
      !approval &&
      argv[i + 1] &&
      !argv[i + 1].startsWith("--")
    ) {
      approval = argv[++i];
    } else if (argv[i] !== "--dry-run") {
      throw new Error("Only the fixed development social pairs are supported");
    }
  }
  if (
    (apply && recover) ||
    ((apply || recover) && argv.includes("--dry-run")) ||
    ((apply || recover) && !approval)
  ) {
    throw new Error(
      "Applying both exact social repairs requires their separate approval reference"
    );
  }
  if ((apply || recover) && !receipt) {
    throw new Error("Private invocation receipt path required");
  }
  return { apply, recover, approval, receipt };
}
interface BindingPins {
  apiKeyFingerprint: string;
  clientId: string;
  environmentId: string;
}
interface InvocationReceipt extends BindingPins {
  approvalReference: string;
  holder: string;
  pair: keyof typeof socialOwnerPairs;
  runId: string;
  version: 1;
}
const bindingRunId = () => digest(JSON.stringify(socialOwnerPairs));
const receiptPath = (base: string, pair: keyof typeof socialOwnerPairs) =>
  resolve(`${base}.${pair}.json`);

export async function acquireSocialBindingLease(
  receiptBase: string,
  pair: keyof typeof socialOwnerPairs,
  pins: BindingPins,
  approvalReference: string,
  run: SocialBindingPorts["run"]
) {
  const receipt: InvocationReceipt = {
    version: 1,
    pair,
    ...pins,
    holder: crypto.randomUUID(),
    runId: bindingRunId(),
    approvalReference,
  };
  const path = receiptPath(receiptBase, pair);
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(receipt));
    await file.sync();
  } finally {
    await file.close();
  }
  const directory = await open(dirname(path), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
  // A committed-but-lost response retains the holder on disk. Never acquire
  // again automatically; explicit recovery verifies and releases only it.
  const held = await run<{ holder: string; generation: number }>(
    "migration/workosImportLease:acquire",
    { ...pins, holder: receipt.holder, runId: receipt.runId }
  );
  if (
    held.holder !== receipt.holder ||
    !Number.isSafeInteger(held.generation) ||
    held.generation < 1
  ) {
    throw new Error("Lease acknowledgment changed; retain invocation receipt");
  }
  return held;
}

async function recoverSocialBindingLeases(
  receiptBase: string,
  pins: BindingPins,
  approval: string,
  run: SocialBindingPorts["run"]
) {
  const pairs: {
    pair: keyof typeof socialOwnerPairs;
    status: "released" | "already-quiescent";
  }[] = [];
  for (const pair of ["google", "apple"] as const) {
    let file: FileHandle;
    try {
      file = await open(
        receiptPath(receiptBase, pair),
        constants.O_RDONLY + constants.O_NOFOLLOW
      );
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
    let receipt: InvocationReceipt;
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > 4096 || info.mode % 0o100 !== 0) {
        throw new Error(
          "Invocation receipt must be an owner-only regular file"
        );
      }
      receipt = JSON.parse(await file.readFile("utf8"));
    } finally {
      await file.close();
    }
    if (
      receipt?.version !== 1 ||
      receipt.pair !== pair ||
      receipt.environmentId !== pins.environmentId ||
      receipt.clientId !== pins.clientId ||
      receipt.apiKeyFingerprint !== pins.apiKeyFingerprint ||
      receipt.approvalReference !== approval ||
      receipt.runId !== bindingRunId() ||
      !/^[0-9a-f-]{36}$/.test(receipt.holder)
    ) {
      throw new Error("Invocation receipt pins or approval changed");
    }
    const state = await run<{
      ready: boolean;
      generation: number | null;
      pendingRemote: boolean;
      barrierHeld: boolean;
    }>("migration/workosImportLease:quiescence", pins);
    if (state.pendingRemote) {
      throw new Error(
        "Pending remote intent requires separate operator resolution"
      );
    }
    if (state.barrierHeld) {
      throw new Error("Lease recovery cannot release a quiescence barrier");
    }
    if (state.ready) {
      pairs.push({ pair, status: "already-quiescent" });
      continue;
    }
    if (
      state.barrierHeld ||
      !Number.isSafeInteger(state.generation) ||
      (state.generation ?? 0) < 1
    ) {
      throw new Error("Lease recovery authority unavailable");
    }
    const authority = {
      ...pins,
      holder: receipt.holder,
      generation: state.generation as number,
    };
    await run("migration/workosImportLease:verify", authority);
    await run("migration/workosImportLease:release", authority);
    pairs.push({ pair, status: "released" });
  }
  if (pairs.length === 0) {
    throw new Error("Existing invocation receipt required for recovery");
  }
  return { mode: "lease-recovery", pairs };
}
async function census(ports: SocialBindingPorts) {
  const rows: Provider[] = [];
  const cursors = new Set<string>();
  let after: string | undefined;
  // The fixed dev roster must fit ten 100-user requests. A row cap alone
  // cannot bound distinct cursors that return empty or undersized pages.
  for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
    const page = await ports.listUsers(after);
    rows.push(...page.data);
    if (rows.length > 1000) {
      throw new Error("Provider census budget reached");
    }
    if (!page.after) {
      return rows;
    }
    if (
      page.data.length === 0 ||
      cursors.has(page.after) ||
      rows.length >= 1000
    ) {
      throw new Error("Provider census incomplete");
    }
    cursors.add(page.after);
    after = page.after;
  }
  throw new Error("Provider census incomplete: page budget reached");
}
async function observation(
  ports: SocialBindingPorts,
  key: keyof typeof socialOwnerPairs,
  all: Provider[]
) {
  const pair = socialOwnerPairs[key];
  const user = await ports.getUser(pair.providerId);
  const targetRows = all.filter((row) => row.id === pair.providerId);
  const emailOwners = all.filter(
    (row) => digest(row.email.trim().toLowerCase()) === pair.emailHash
  );
  if (
    user.id !== pair.providerId ||
    targetRows.length !== 1 ||
    targetRows[0].email !== user.email ||
    targetRows[0].externalId !== user.externalId ||
    targetRows[0].emailVerified !== user.emailVerified ||
    emailOwners.length !== 1 ||
    emailOwners[0].id !== pair.providerId
  ) {
    throw new Error("Provider census disagrees with current user");
  }
  const identities = await ports.getIdentities(pair.providerId);
  const identity = identities.filter(
    (row) => row.provider === (key === "google" ? "GoogleOAuth" : "AppleOAuth")
  );
  const emailHash = digest(user.email.trim().toLowerCase());
  if (
    user.id !== pair.providerId ||
    emailHash !== pair.emailHash ||
    !user.emailVerified ||
    identity.length !== 1 ||
    digest(identity[0].idpId) !== pair.subjectHash ||
    (user.externalId !== null && user.externalId !== pair.ownerId) ||
    all.some(
      (row) => row.externalId === pair.ownerId && row.id !== pair.providerId
    )
  ) {
    throw new Error("Approved social provider census or identity changed");
  }
  return {
    id: user.id,
    externalId: user.externalId,
    emailHash,
    emailVerified: user.emailVerified,
    subjectHash: pair.subjectHash,
  };
}
// Default is read-only. No signup/auth/pause setting is changed by this operator.
// A pending/uncertain intent never authorizes an automatic network retry.
export async function runSocialBindings(
  argv: string[],
  apiKey: string,
  ports: SocialBindingPorts
) {
  const { apply, recover, approval, receipt } = argumentsFor(argv);
  if (!apiKey) {
    throw new Error("Explicit WorkOS credential required; dotenv is ignored");
  }
  const pins = {
    environmentId: socialOwnerBindingPins.environmentId,
    clientId: socialOwnerBindingPins.clientId,
    apiKeyFingerprint: digest(apiKey),
  };
  if ((apply || recover) && !(receipt && approval)) {
    throw new Error("Private receipt and approval reference required");
  }
  if (recover && receipt && approval) {
    await ports.run(
      "migration/workosSocialOwnerBindings:recoveryAdmission",
      pins
    );
    return recoverSocialBindingLeases(receipt, pins, approval, ports.run);
  }
  await ports.run("migration/workosSocialOwnerBindings:admission", pins);
  const all = await census(ports);
  const inspected: {
    key: keyof typeof socialOwnerPairs;
    observed: Awaited<ReturnType<typeof observation>>;
    state: { sourceVersion: string; mapped: boolean };
  }[] = [];
  for (const key of ["google", "apple"] as const) {
    const observed = await observation(ports, key, all);
    const state = await ports.run<{ sourceVersion: string; mapped: boolean }>(
      "migration/workosSocialOwnerBindings:inspect",
      { ...pins, pair: key, observed }
    );
    inspected.push({ key, observed, state });
  }
  if (!apply) {
    return {
      mode: "dry-run",
      pairs: inspected.map((row) => ({
        pair: row.key,
        mapped: row.state.mapped,
        externalIdAssigned: row.observed.externalId !== null,
      })),
    };
  }
  if (!(receipt && approval)) {
    throw new Error("Private receipt and approval reference required");
  }
  for (const row of inspected) {
    const lease = await acquireSocialBindingLease(
      receipt,
      row.key,
      pins,
      approval,
      ports.run
    );
    const authority = { ...pins, ...lease };
    let pending = false;
    try {
      const observed = await observation(ports, row.key, await census(ports));
      const state = await ports.run<{ sourceVersion: string }>(
        "migration/workosSocialOwnerBindings:inspect",
        { ...pins, pair: row.key, observed }
      );
      const prepared = await ports.run<{ sourceVersion: string }>(
        "migration/workosSocialOwnerBindings:prepare",
        {
          ...authority,
          pair: row.key,
          observed,
          sourceVersion: state.sourceVersion,
        }
      );
      pending = true;
      const before = await observation(ports, row.key, await census(ports));
      if (before.externalId !== observed.externalId) {
        throw new Error("Provider changed after durable intent");
      }
      const pair = socialOwnerPairs[row.key];
      const updated = await ports.updateUser({
        userId: pair.providerId,
        externalId: pair.ownerId,
      });
      if (
        updated.id !== pair.providerId ||
        updated.externalId !== pair.ownerId ||
        digest(updated.email.trim().toLowerCase()) !== pair.emailHash ||
        !updated.emailVerified
      ) {
        throw new Error("Provider update response changed");
      }
      const after = await observation(ports, row.key, await census(ports));
      await ports.run("migration/workosSocialOwnerBindings:acknowledge", {
        ...authority,
        pair: row.key,
        observed: after,
        sourceVersion: prepared.sourceVersion,
      });
      pending = false;
      await ports.run("migration/workosImportLease:release", authority);
    } catch {
      if (pending) {
        try {
          await ports.run(
            "migration/workosImportLease:markUncertain",
            authority
          );
        } catch {
          /* Intent remains fenced even if marking fails. */
        }
      } else {
        try {
          await ports.run("migration/workosImportLease:release", authority);
        } catch {
          /* Never force-release changed authority. */
        }
      }
      throw new Error(
        "Social binding stopped; inspect lease and authenticated delivery before any retry"
      );
    }
  }
  return {
    mode: "provider-bindings-written",
    approvalReference: approval,
    profileProof: "pending-authenticated-webhook-verification",
  };
}
if (import.meta.main) {
  try {
    const argv = process.argv.slice(2);
    argumentsFor(argv);
    const key = process.env.WORKOS_API_KEY;
    if (!key) {
      throw new Error("Explicit WorkOS credential required");
    }
    const workos = new WorkOS(key, {
      clientId: socialOwnerBindingPins.clientId,
      maxRetries: 0,
      timeout: 10_000,
    });
    const run: SocialBindingPorts["run"] = async <T>(
      name: string,
      args: unknown
    ) => {
      try {
        const result = await execute(
          "bun",
          [
            "--no-env-file",
            "x",
            "convex",
            "run",
            name,
            JSON.stringify(args),
            "--deployment",
            "reminiscent-kangaroo-59",
          ],
          {
            cwd: resolve(import.meta.dirname, "../../packages/convex"),
            maxBuffer: 1024 * 1024,
          }
        );
        return JSON.parse(result.stdout.trim()) as T;
      } catch {
        throw new Error(
          "Pinned Convex operation failed; raw provider output suppressed"
        );
      }
    };
    console.log(
      JSON.stringify(
        await runSocialBindings(argv, key, {
          run,
          getUser: (id) => workos.userManagement.getUser(id),
          getIdentities: (id) => workos.userManagement.getUserIdentities(id),
          listUsers: async (after) => {
            const page = await workos.userManagement.listUsers({
              limit: 100,
              after,
            });
            return { data: page.data, after: page.listMetadata.after ?? null };
          },
          updateUser: (input) => workos.userManagement.updateUser(input),
        })
      )
    );
  } catch {
    console.error(
      "Social binding refused or stopped; no raw credentials or identity data disclosed"
    );
    process.exitCode = 1;
  }
}
