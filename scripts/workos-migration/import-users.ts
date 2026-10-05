import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { NotFoundException, WorkOS } from "@workos-inc/node";
import {
  type ImportedUser,
  type ImportOwner,
  type ImportPorts,
  importOwners,
} from "./import-engine";
import {
  admission,
  type ImportJournal,
  readJournal,
  writeJournal,
} from "./import-journal";
import {
  type PreflightOwner,
  type PreflightProvider,
  preflight,
} from "./preflight";

const execute = promisify(execFile);
function argumentsFor(argv: string[]) {
  const known = new Set([
    "--deployment",
    "--environment-id",
    "--client-id",
    "--journal",
    "--approval-reference",
    "--witness-email",
    "--witness-external-id",
  ]);
  const flags = new Set([
    "--dry-run",
    "--resume",
    "--delta",
    "--apply",
    "--hashes-proven",
    "--preflight",
  ]);
  const values: Record<string, string> = {};
  const selected = new Set<string>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (flags.has(arg)) {
      selected.add(arg);
      continue;
    }
    if (
      !(known.has(arg) && argv[index + 1]) ||
      argv[index + 1].startsWith("--") ||
      values[arg]
    ) {
      throw new Error("Invalid importer arguments");
    }
    values[arg] = argv[++index];
  }
  for (const arg of [
    "--deployment",
    "--environment-id",
    "--client-id",
    "--journal",
    "--witness-email",
    "--witness-external-id",
  ]) {
    if (!values[arg]) {
      throw new Error(`Required ${arg}`);
    }
  }
  if (
    !(
      /^[A-Za-z0-9-]+$/.test(values["--deployment"]) &&
      /^environment_[A-Za-z0-9]+$/.test(values["--environment-id"]) &&
      /^client_[A-Za-z0-9]+$/.test(values["--client-id"]) &&
      /^[^\s@]+@[^\s@]+$/.test(values["--witness-email"])
    )
  ) {
    throw new Error("Invalid explicit deployment pins");
  }
  if (selected.has("--apply") && selected.has("--dry-run")) {
    throw new Error("Choose dry-run or apply");
  }
  if (selected.has("--apply") && !values["--approval-reference"]) {
    throw new Error(
      "Actual imports/deltas require a recorded separate approval"
    );
  }
  return { values, selected };
}
export async function main(
  argv: string[],
  convexTransport?: (name: string, args: unknown) => Promise<unknown>
) {
  const { values, selected } = argumentsFor(argv);
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "WORKOS_API_KEY must be supplied explicitly; dotenv is not loaded"
    );
  }
  const deployment = values["--deployment"],
    environmentId = values["--environment-id"],
    clientId = values["--client-id"],
    journalPath = resolve(values["--journal"]);
  const apiKeyFingerprint = createHash("sha256").update(apiKey).digest("hex"),
    workos = new WorkOS(apiKey, { clientId, maxRetries: 0, timeout: 10_000 });
  const dryRun = !selected.has("--apply");
  const binding = await run<{ witnessUserId: string }>(
    "migration/workosImportSource:admission",
    { environmentId, clientId, apiKeyFingerprint }
  );
  const witnessEmail = values["--witness-email"].trim().toLowerCase();
  const witnessExternalId =
    values["--witness-external-id"] === "none"
      ? null
      : values["--witness-external-id"];
  if (!/^user_[A-Za-z0-9]+$/.test(binding.witnessUserId)) {
    throw new Error("Malformed importer witness binding");
  }
  const witness = await workos.userManagement.getUser(binding.witnessUserId);
  if (
    witness.id !== binding.witnessUserId ||
    witness.email.trim().toLowerCase() !== witnessEmail ||
    (witness.externalId ?? null) !== witnessExternalId
  ) {
    throw new Error("Importer provider witness mismatch");
  }
  const pins = {
    witnessUserId: binding.witnessUserId,
    witnessEmail,
    witnessExternalId,
    deployment,
    environmentId,
    clientId,
    apiKeyFingerprint,
    hashesProven: selected.has("--hashes-proven"),
  };
  let previous: ImportJournal | null = null;
  if (selected.has("--resume") || selected.has("--delta")) {
    previous = await readJournal(journalPath, pins);
  } else {
    try {
      await stat(journalPath);
      throw new Error("Existing journal requires resume or delta");
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
  }
  if (selected.has("--resume") && selected.has("--delta")) {
    throw new Error(
      "Choose resume or a new delta; resume preserves its admitted mode"
    );
  }
  let mode: "initial" | "delta" | "resume" = "initial";
  if (selected.has("--resume")) {
    mode = "resume";
  } else if (selected.has("--delta")) {
    mode = "delta";
  }
  let journal = admission(
    pins,
    previous,
    mode,
    values["--approval-reference"] ?? null
  );
  async function run<T>(name: string, args: unknown): Promise<T> {
    if (convexTransport) {
      return (await convexTransport(name, args)) as T;
    }
    // argv avoids shell substitution; secrets are returned only in captured stdout.
    const { stdout } = await execute(
      process.execPath,
      [
        "x",
        "convex",
        "run",
        "--deployment-name",
        deployment,
        name,
        JSON.stringify(args),
      ],
      {
        cwd: resolve(import.meta.dir, "../../packages/convex"),
        maxBuffer: 2 * 1024 * 1024,
      }
    );
    return JSON.parse(stdout);
  }
  const user = (remote: {
    id: string;
    externalId?: string | null;
    email: string;
    emailVerified: boolean;
  }): ImportedUser => ({
    id: remote.id,
    externalId: remote.externalId ?? null,
    email: remote.email,
    emailVerified: remote.emailVerified,
  });
  let writer: { holder: string; generation: number } | null = null;
  let remoteOpen = false;
  const leaseArgs = () => ({
    environmentId,
    clientId,
    apiKeyFingerprint,
    ...writer,
  });
  if (!dryRun) {
    writer = await run("migration/workosImportLease:acquire", {
      environmentId,
      clientId,
      apiKeyFingerprint,
      holder: crypto.randomUUID(),
      runId: createHash("sha256")
        .update(`${journalPath}:${journal.startedAt}`)
        .digest("hex"),
    });
  }
  async function remote<T>(
    kind: "create" | "update" | "delete",
    owner: ImportOwner,
    operation: () => Promise<T>
  ): Promise<T> {
    await run("migration/workosImportLease:beginRemote", {
      ...leaseArgs(),
      kind,
      teakUserId: owner.teakUserId,
      sourceVersion: owner.sourceVersion,
    });
    remoteOpen = true;
    const acknowledge = () =>
      run("migration/workosImportLease:acknowledgeRemote", {
        ...leaseArgs(),
        teakUserId: owner.teakUserId,
        sourceVersion: owner.sourceVersion,
      });
    let result: T;
    try {
      result = await operation();
    } catch (error) {
      const status =
        error instanceof Error && "status" in error
          ? Number(error.status)
          : null;
      // An acknowledged client rejection did not authorize a provider write.
      // Transport failures and server errors leave intent sticky, even on timeout.
      if (status !== null && status >= 400 && status < 500 && status !== 408) {
        await acknowledge();
        remoteOpen = false;
      }
      throw error;
    }
    await acknowledge();
    remoteOpen = false;
    return result;
  }
  try {
    if (selected.has("--preflight") || selected.has("--apply")) {
      if (selected.has("--preflight") && selected.has("--apply")) {
        throw new Error("Preflight is read-only");
      }
      const owners: PreflightOwner[] = [],
        providers: PreflightProvider[] = [];
      let cursor: string | null = null;
      let done = false;
      const seen = new Set<string>();
      do {
        const page: {
          owners: PreflightOwner[];
          done: boolean;
          cursor: string | null;
        } = await run("migration/workosImportSource:preflightPage", {
          environmentId,
          clientId,
          apiKeyFingerprint,
          cursor,
        });
        owners.push(...page.owners);
        if (owners.length > 100_000) {
          throw new Error(
            "Preflight process budget exceeded; no partial clear result"
          );
        }
        done = page.done;
        if (done) {
          break;
        }
        if (!page.cursor || seen.has(page.cursor)) {
          throw new Error("Preflight cursor cycle");
        }
        seen.add(page.cursor);
        cursor = page.cursor;
      } while (!done);
      let after: string | undefined;
      const providerCursors = new Set<string>();
      do {
        const page = await workos.userManagement.listUsers({
          limit: 100,
          after,
          order: "asc",
        });
        providers.push(
          ...page.data.map((remote) => ({
            id: remote.id,
            email: remote.email,
            externalId: remote.externalId ?? null,
          }))
        );
        if (providers.length > 100_000) {
          throw new Error(
            "Preflight provider budget exceeded; no partial clear result"
          );
        }
        after = page.listMetadata.after ?? undefined;
        if (after && providerCursors.has(after)) {
          throw new Error("Preflight provider cursor cycle");
        }
        if (after) {
          providerCursors.add(after);
        }
      } while (after);
      const result = preflight(owners, providers, journal.mode === "delta");
      if (selected.has("--preflight") || !result.clear) {
        await writeFile(
          selected.has("--preflight")
            ? `${journalPath}.preflight.json`
            : `${journalPath}.collision.${crypto.randomUUID()}.json`,
          JSON.stringify(
            {
              deployment,
              environmentId,
              clientId,
              observedAt: new Date().toISOString(),
              ...result,
            },
            null,
            2
          ),
          { flag: "wx", mode: 0o600 }
        );
      }
      console.log(
        JSON.stringify({
          deployment,
          environmentId,
          clientId,
          ownerRows: result.ownerRows,
          providerRows: result.providerRows,
          passwords: result.passwords,
          issues: result.issues.length,
          clear: result.clear,
        })
      );
      if (!result.clear) {
        if (!dryRun) {
          const receipts = result.issues
            .flatMap((issue) =>
              (issue.teakUserIds.length ? issue.teakUserIds : [undefined]).map(
                (teakUserId) => ({
                  email: issue.email,
                  reason: issue.reason,
                  ...(teakUserId ? { teakUserId } : {}),
                  ...(issue.workosUserId
                    ? { workosUserId: issue.workosUserId }
                    : {}),
                })
              )
            )
            .slice(0, 20);
          await run("migration/workosImportSource:quarantinePreflight", {
            environmentId,
            clientId,
            apiKeyFingerprint,
            ...writer,
            receipts,
          });
        }
        throw new Error("Global normalized-email preflight blocks import");
      }
      if (selected.has("--preflight")) {
        return;
      }
    }
    const ports: ImportPorts = {
      quarantine: (owner, remote, reason) =>
        run("migration/workosImportSource:quarantine", {
          environmentId,
          clientId,
          apiKeyFingerprint,
          ...writer,
          teakUserId: owner.teakUserId,
          sourceVersion: owner.sourceVersion,
          workosUserId: remote?.id ?? owner.workosUserId,
          reason,
        }),
      source: (cursor) =>
        run("migration/workosImportSource:page", {
          environmentId,
          clientId,
          apiKeyFingerprint,
          cursor,
        }),
      lookup: async (externalId) => {
        if (remoteOpen) {
          throw new Error(
            "Uncertain importer remote intent; no automatic retry"
          );
        }
        try {
          return user(
            await workos.userManagement.getUserByExternalId(externalId)
          );
        } catch (error) {
          if (error instanceof NotFoundException) {
            return null;
          }
          throw error;
        }
      },
      create: (owner, passwordHash) =>
        remote("create", owner, async () =>
          user(
            await workos.userManagement.createUser({
              email: owner.email,
              name: owner.name ?? undefined,
              emailVerified: owner.emailVerified,
              externalId: owner.teakUserId,
              ...(passwordHash
                ? { passwordHash, passwordHashType: "scrypt" as const }
                : {}),
            })
          )
        ),
      update: (existing, owner, passwordHash) =>
        remote("update", owner, async () =>
          user(
            await workos.userManagement.updateUser({
              userId: existing.id,
              email: owner.email,
              name: owner.name ?? undefined,
              emailVerified: owner.emailVerified,
              ...(passwordHash
                ? { passwordHash, passwordHashType: "scrypt" as const }
                : {}),
            })
          )
        ),
      remove: (existing, owner) =>
        remote("delete", owner, () =>
          workos.userManagement.deleteUser(existing.id)
        ),
      link: (owner, remote) =>
        run("migration/workosImportSource:link", {
          environmentId,
          clientId,
          apiKeyFingerprint,
          ...writer,
          teakUserId: owner.teakUserId,
          sourceVersion: owner.sourceVersion,
          user: remote,
        }),
      checkpoint: async (cursor, completed, watermark) => {
        await run("migration/workosImportLease:verify", leaseArgs());
        journal = {
          ...journal,
          cursor,
          completed,
          watermark: completed ? watermark : journal.watermark,
        };
        await writeJournal(journalPath, journal, false);
      },
      sleep: (milliseconds) =>
        new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
    };
    // Persist admission before the first source/provider mutation, including page1.
    if (!dryRun && mode !== "resume") {
      await writeJournal(journalPath, journal, previous === null);
    }
    const report = await importOwners(ports, {
      dryRun,
      mutationApproved: selected.has("--apply"),
      hashesProven: selected.has("--hashes-proven"),
      delta: journal.mode === "delta",
      changedSince: journal.mode === "delta" ? journal.watermark : 0,
      cursor: journal.cursor,
      startedAt: journal.startedAt,
    });
    console.log(
      JSON.stringify({ deployment, environmentId, clientId, ...report })
    );
  } finally {
    if (writer) {
      await run(
        remoteOpen
          ? "migration/workosImportLease:markUncertain"
          : "migration/workosImportLease:release",
        leaseArgs()
      );
    }
  }
}
if (import.meta.main) {
  main(process.argv.slice(2)).catch(() => {
    console.error(
      "Migration stopped. Journal remains at the last committed page; inspect the private runtime error safely before resuming."
    );
    process.exitCode = 1;
  });
}
