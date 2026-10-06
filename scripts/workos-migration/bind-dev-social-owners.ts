import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
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
  let approval: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply" && !apply) {
      apply = true;
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
  if ((apply && argv.includes("--dry-run")) || (apply && !approval)) {
    throw new Error(
      "Applying both exact social repairs requires their separate approval reference"
    );
  }
  return { apply, approval };
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
  const { apply, approval } = argumentsFor(argv);
  if (!apiKey) {
    throw new Error("Explicit WorkOS credential required; dotenv is ignored");
  }
  const pins = {
    environmentId: socialOwnerBindingPins.environmentId,
    clientId: socialOwnerBindingPins.clientId,
    apiKeyFingerprint: digest(apiKey),
  };
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
  for (const row of inspected) {
    const holder = crypto.randomUUID();
    const lease = await ports.run<{ holder: string; generation: number }>(
      "migration/workosImportLease:acquire",
      { ...pins, holder, runId: digest(JSON.stringify(socialOwnerPairs)) }
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
