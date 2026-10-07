import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { WorkOS } from "@workos-inc/node";
import { parseConvexCliResponse } from "./convex-cli-response";
import type { ImportedUser, ImportOwner } from "./import-engine";
import {
  type PreflightOwner,
  type PreflightProvider,
  preflight,
} from "./preflight";

const execute = promisify(execFile);
const sourcePrefix = "migration/workosImportSource:";
const leasePrefix = "migration/workosImportLease:";
const normalize = (value: string) => value.trim().toLowerCase();
export interface WitnessOptions {
  apiKeyFingerprint: string;
  apply: boolean;
  approvalReference?: string;
  clientId: string;
  deployment: string;
  environmentId: string;
  expectedEmail: string;
  journal: string;
  teakUserId: string;
}
export interface WitnessBoundary {
  createUser: (input: {
    email: string;
    emailVerified: boolean;
    externalId: string;
    name?: string;
  }) => Promise<ImportedUser>;
  getUser: (id: string) => Promise<ImportedUser>;
  listUsers: (after?: string) => Promise<{
    data: PreflightProvider[];
    after: string | null;
  }>;
  run: (name: string, args: unknown) => Promise<unknown>;
  witness: () => Promise<string | null>;
}
function validate(options: WitnessOptions) {
  if (
    !(
      /^[A-Za-z0-9-]+$/.test(options.deployment) &&
      /^environment_[A-Za-z0-9]+$/.test(options.environmentId) &&
      /^client_[A-Za-z0-9]+$/.test(options.clientId) &&
      /^[0-9a-f]{64}$/.test(options.apiKeyFingerprint) &&
      /^[A-Za-z0-9]+$/.test(options.teakUserId) &&
      /^[^\s@]+@[^\s@]+$/.test(options.expectedEmail) &&
      options.journal
    )
  ) {
    throw new Error("Explicit valid witness pins and exact owner required");
  }
  if (options.apply && !options.approvalReference?.trim()) {
    throw new Error("Witness import requires separate recorded approval");
  }
}
// Every journal write and its directory entry reach disk before remote authority.
// Existing files (including symlinks) are refused; there is intentionally no resume.
async function reserveJournal(path: string) {
  const file = await open(path, "wx", 0o600);
  try {
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    await file.close();
    throw error;
  }
  return file;
}
export async function bootstrapWitness(
  options: WitnessOptions,
  boundary: WitnessBoundary
) {
  validate(options);
  const path = resolve(options.journal);
  const file = await reserveJournal(path);
  const holder = randomUUID();
  const runId = createHash("sha256").update(`${path}:${holder}`).digest("hex");
  const pins = {
    environmentId: options.environmentId,
    clientId: options.clientId,
    apiKeyFingerprint: options.apiKeyFingerprint,
  };
  const record = async (
    stage: string,
    fields: Record<string, unknown> = {}
  ) => {
    await file.writeFile(
      `${JSON.stringify({ stage, at: new Date().toISOString(), ...fields })}\n`
    );
    await file.sync();
  };
  const run = async <T>(name: string, args: unknown): Promise<T> =>
    (await boundary.run(name, args)) as T;
  async function rows<T>(name: string, quarantine = false): Promise<T[]> {
    const result: T[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let pages = 0; pages < 5000; pages++) {
      const page: {
        owners: T[];
        done: boolean;
        cursor: string | null;
        unresolvedQuarantine?: boolean;
      } = await run<{
        owners: T[];
        done: boolean;
        cursor: string | null;
        unresolvedQuarantine?: boolean;
      }>(sourcePrefix + name, { ...pins, cursor });
      if (quarantine && page.unresolvedQuarantine !== false) {
        throw new Error("Unresolved quarantine blocks witness");
      }
      result.push(...page.owners);
      if (result.length > 100_000) {
        throw new Error("Source census budget exceeded");
      }
      if (page.done) {
        return result;
      }
      if (!page.cursor || seen.has(page.cursor)) {
        throw new Error("Source cursor cycle");
      }
      seen.add(page.cursor);
      cursor = page.cursor;
    }
    throw new Error("Source page budget exceeded");
  }
  async function candidate() {
    const matches = (await rows<ImportOwner>("page", true)).filter(
      (row) => row.teakUserId === options.teakUserId
    );
    const owner = matches[0];
    if (
      matches.length !== 1 ||
      owner.deletedAt !== null ||
      owner.workosUserId !== null ||
      owner.email !== options.expectedEmail ||
      typeof owner.emailVerified !== "boolean" ||
      !/^[0-9a-f]{64}$/.test(owner.sourceVersion)
    ) {
      throw new Error("Witness must be one exact active unmapped source owner");
    }
    // Deliberate projection: source credential material never leaves memory.
    return {
      teakUserId: owner.teakUserId,
      email: owner.email,
      emailVerified: owner.emailVerified,
      name: owner.name,
      sourceVersion: owner.sourceVersion,
    };
  }
  function exact(
    remote: ImportedUser,
    owner: Awaited<ReturnType<typeof candidate>>
  ) {
    if (
      !/^user_[A-Za-z0-9]+$/.test(remote.id) ||
      remote.externalId !== owner.teakUserId ||
      normalize(remote.email) !== normalize(owner.email) ||
      remote.emailVerified !== owner.emailVerified
    ) {
      throw new Error("Provider witness acknowledgment mismatch");
    }
  }
  try {
    await record("reserved", { ...options, journal: path, holder, runId });
    const mode = await run<{
      primary: string;
      signupsDisabled: boolean;
      authKitClientId?: string;
    }>("auth:getAuthMode", {});
    if (
      mode.primary !== "betterauth" ||
      !mode.signupsDisabled ||
      mode.authKitClientId !== options.clientId
    ) {
      throw new Error("Pinned frozen Better Auth mode required");
    }
    if (await boundary.witness()) {
      throw new Error("Witness already configured; bootstrap cannot overwrite");
    }
    const owners = await rows<PreflightOwner>("preflightPage");
    const providers: PreflightProvider[] = [];
    const seen = new Set<string>();
    let after: string | undefined;
    for (let pages = 0; ; pages++) {
      if (pages >= 1000) {
        throw new Error("Provider page budget exceeded");
      }
      const page = await boundary.listUsers(after);
      providers.push(...page.data);
      if (providers.length > 100_000) {
        throw new Error("Provider census budget exceeded");
      }
      if (!page.after) {
        break;
      }
      if (seen.has(page.after)) {
        throw new Error("Provider cursor cycle");
      }
      seen.add(page.after);
      after = page.after;
    }
    const census = preflight(owners, providers);
    if (
      !census.clear ||
      providers.some(
        (row) =>
          row.externalId === options.teakUserId ||
          normalize(row.email) === normalize(options.expectedEmail)
      )
    ) {
      throw new Error(
        "Global collision census or existing provider blocks witness"
      );
    }
    const owner = await candidate();
    await record("planned", {
      owner,
      ownerRows: census.ownerRows,
      providerRows: census.providerRows,
    });
    if (!options.apply) {
      return { status: "planned" as const };
    }
    // Persist intended acquisition before dispatch; a lost response is not retried.
    await record("acquiring", { holder, runId });
    const writer = await run<{ holder: string; generation: number }>(
      `${leasePrefix}acquire`,
      { ...pins, holder, runId }
    );
    if (
      writer.holder !== holder ||
      !Number.isSafeInteger(writer.generation) ||
      writer.generation < 1
    ) {
      throw new Error("Invalid lease acknowledgment; inspect authority");
    }
    await record("acquired", writer);
    const lease = { ...pins, ...writer };
    const fresh = await candidate();
    const version = await run<string>(`${sourcePrefix}version`, {
      ...pins,
      teakUserId: options.teakUserId,
    });
    if (
      JSON.stringify(fresh) !== JSON.stringify(owner) ||
      version !== owner.sourceVersion
    ) {
      throw new Error(
        "Source changed after lease admission; inspect authority"
      );
    }
    await record("dispatch_prepared", { sourceVersion: owner.sourceVersion });
    const intent = {
      ...lease,
      teakUserId: owner.teakUserId,
      sourceVersion: owner.sourceVersion,
    };
    await run(`${leasePrefix}beginRemote`, { ...intent, kind: "create" });
    await record("armed");
    let remote: ImportedUser;
    try {
      remote = await boundary.createUser({
        email: owner.email,
        emailVerified: owner.emailVerified,
        externalId: owner.teakUserId,
        ...(owner.name === null ? {} : { name: owner.name }),
      });
    } catch (error) {
      const status =
        error instanceof Error && "status" in error
          ? Number(error.status)
          : null;
      if (status !== null && status >= 400 && status < 500 && status !== 408) {
        await record("definite_rejection", { status });
        await run(`${leasePrefix}acknowledgeRemote`, intent);
        await record("rejection_acknowledged");
        await run(`${leasePrefix}release`, lease);
        await record("rejection_released");
      }
      // No provider payload/error text is serialized, including transport headers.
      throw new Error(
        "Provider create stopped; inspect durable intent, never retry automatically"
      );
    }
    // Project returned user too: provider token/extra response fields never persist.
    const acknowledgment: ImportedUser = {
      id: remote.id,
      externalId: remote.externalId,
      email: remote.email,
      emailVerified: remote.emailVerified,
    };
    await record("provider_acknowledged", { user: acknowledgment });
    exact(acknowledgment, owner);
    await run(`${leasePrefix}acknowledgeRemote`, intent);
    await record("intent_acknowledged");
    const linked = await run<string>(`${sourcePrefix}link`, {
      ...intent,
      user: acknowledgment,
    });
    if (linked !== "linked") {
      throw new Error("Witness link quarantined; explicit recovery required");
    }
    await record("linked", { workosUserId: acknowledgment.id });
    exact(await boundary.getUser(acknowledgment.id), owner);
    await run(`${leasePrefix}verify`, lease);
    await run(`${leasePrefix}release`, lease);
    await record("released");
    const drained = await run<{
      ready: boolean;
      pendingRemote: boolean;
      generation: number;
      holder: string;
    }>(`${leasePrefix}quiescence`, pins);
    if (
      !drained.ready ||
      drained.pendingRemote ||
      drained.generation !== writer.generation ||
      drained.holder !== holder
    ) {
      throw new Error("Witness lease not verifiably drained");
    }
    await record("linked_pending_external_verification", {
      workosUserId: acknowledgment.id,
    });
    // Deliberately no env write. Signed-ingress settlement, unchanged card pairs,
    // and an exact fresh admission need the reviewed operator's separate evidence.
    return {
      status: "linked_pending_external_verification" as const,
      workosUserId: acknowledgment.id,
    };
  } finally {
    await file.close();
  }
}
export function parseWitnessArguments(argv: string[]): WitnessOptions {
  const values: Record<string, string> = {};
  const names = [
    "deployment",
    "environment-id",
    "client-id",
    "api-key-fingerprint",
    "teak-user-id",
    "expected-email",
    "journal",
    "approval-reference",
  ];
  let apply = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--apply" && !apply) {
      apply = true;
    } else if (
      names.includes(arg.slice(2)) &&
      arg.startsWith("--") &&
      !values[arg] &&
      argv[index + 1] &&
      !argv[index + 1].startsWith("--")
    ) {
      values[arg] = argv[++index];
    } else {
      throw new Error("Invalid witness arguments");
    }
  }
  const options = {
    deployment: values["--deployment"] ?? "",
    environmentId: values["--environment-id"] ?? "",
    clientId: values["--client-id"] ?? "",
    apiKeyFingerprint: values["--api-key-fingerprint"] ?? "",
    teakUserId: values["--teak-user-id"] ?? "",
    expectedEmail: values["--expected-email"] ?? "",
    journal: values["--journal"] ?? "",
    approvalReference: values["--approval-reference"],
    apply,
  };
  validate(options);
  return options;
}
export async function main(argv: string[]) {
  const options = parseWitnessArguments(argv);
  const key = process.env.WORKOS_API_KEY;
  // This is the backend's API-key equality fingerprint, not password storage.
  // Keep its SHA256 protocol identical to assertImportBinding; user credentials
  // never pass through this hash and are never exported by this operator.
  if (
    !key ||
    createHash("sha256").update(key).digest("hex") !== options.apiKeyFingerprint
  ) {
    throw new Error("Runtime WorkOS key fingerprint mismatch");
  }
  // Deploy keys/tokens and self-hosted pairs outrank --deployment-name in the
  // Convex CLI, which also loads packages/convex/.env.local and .env itself.
  // Empty values read as unset there and stop dotenv from refilling them.
  const environment = { ...process.env };
  for (const name of [
    "CONVEX_DEPLOYMENT",
    "CONVEX_DEPLOY_KEY",
    "CONVEX_DEPLOYMENT_TOKEN",
    "CONVEX_SELF_HOSTED_URL",
    "CONVEX_SELF_HOSTED_ADMIN_KEY",
    "CONVEX_URL",
    "CONVEX_SITE_URL",
    "NEXT_PUBLIC_CONVEX_URL",
  ]) {
    environment[name] = "";
  }
  const cli = async (args: string[]) => {
    const { stdout } = await execute(
      process.execPath,
      [
        "--no-env-file",
        "x",
        "convex",
        ...args,
        "--deployment-name",
        options.deployment,
      ],
      {
        cwd: resolve(import.meta.dir, "../../packages/convex"),
        env: environment,
        maxBuffer: 2 * 1024 * 1024,
      }
    );
    return stdout;
  };
  const workos = new WorkOS(key, {
    clientId: options.clientId,
    maxRetries: 0,
    timeout: 10_000,
  });
  return await bootstrapWitness(options, {
    run: async (name, args) =>
      parseConvexCliResponse(await cli(["run", name, JSON.stringify(args)])),
    witness: async () =>
      (await cli(["env", "get", "WORKOS_RECONCILIATION_WITNESS_ID"])).trim() ||
      null,
    listUsers: async (after) => {
      const page = await workos.userManagement.listUsers({
        after,
        limit: 100,
        order: "asc",
      });
      return {
        data: page.data.map((row) => ({
          id: row.id,
          email: row.email,
          externalId: row.externalId ?? null,
        })),
        after: page.listMetadata.after ?? null,
      };
    },
    createUser: (input) => workos.userManagement.createUser(input),
    getUser: (id) => workos.userManagement.getUser(id),
  });
}
if (import.meta.main) {
  main(process.argv.slice(2))
    .then((result) => console.log(JSON.stringify(result)))
    .catch(() => {
      console.error(
        "Witness bootstrap stopped. Inspect the private journal and exact authority; do not retry or release automatically."
      );
      process.exitCode = 1;
    });
}
