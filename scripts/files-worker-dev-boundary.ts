import { join } from "node:path";
import {
  classifyDevStorage,
  DEVELOPMENT_STORAGE_BUCKET,
  parseConvexEnvOutput,
} from "./check-cloudflare";

// Pinned like packages/convex/devUrls.ts: `--deployment dev` follows the
// caller's personal selection, which differs per checkout and worktree.
// `--deployment-name` selects exactly this deployment.
export const DEVELOPMENT_DEPLOYMENT = "reminiscent-kangaroo-59";
export const DEVELOPMENT_FILES_WORKER = "teak-files-development";
const CLOUDFLARE_ACCOUNT_ID = "dd19e45b8f2f3cc0393cc2deb51fa27d";

export interface DevelopmentFilesRouting {
  bucket: string | undefined;
  filesBase: string | undefined;
  prefix: string | undefined;
  signingSecret: string | undefined;
}

/**
 * The isolated development Worker may only start or receive a key once Convex
 * dev has switched to it. Messages never include the supplied values.
 */
export const assertIsolatedDevelopmentFiles = (
  routing: DevelopmentFilesRouting
): string => {
  const state = classifyDevStorage(routing);
  if (state === "shared") {
    throw new Error(
      "Convex dev still uses the shared production Files Worker and bucket. The isolated development Worker is available only after the approved storage switch; keep using `bun run dev:files` until then."
    );
  }
  if (state === "invalid") {
    throw new Error(
      "Convex dev Files routing is neither the shared nor the isolated configuration; run `bun run check:cloudflare`."
    );
  }
  const secret = routing.signingSecret;
  if (!secret || /[\s\0'"`#$\\]/.test(secret)) {
    throw new Error(
      "Convex dev FILES_SIGNING_SECRET is missing or not a safe dotenv value."
    );
  }
  return secret;
};

export interface CommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}
export type RunCommand = (
  argv: string[],
  options: { cwd: string; env: Record<string, string | undefined> }
) => Promise<CommandResult>;

const runCommand: RunCommand = async (argv, { cwd, env }) => {
  const proc = Bun.spawn(argv, { cwd, env, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};

// Deploy keys or tokens and self-hosted pairs outrank --deployment-name in the Convex CLI,
// which also loads packages/convex/.env.local and .env itself. Empty values
// read as unset there and stop dotenv from refilling them.
export const CONVEX_SELECTOR_VARIABLES = [
  "CONVEX_DEPLOYMENT",
  "CONVEX_DEPLOY_KEY",
  "CONVEX_DEPLOYMENT_TOKEN",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
  "CONVEX_URL",
  "CONVEX_SITE_URL",
  "NEXT_PUBLIC_CONVEX_URL",
] as const;

export const readDevelopmentFilesRouting = async (
  root: string,
  run: RunCommand = runCommand,
  ambient: Record<string, string | undefined> = process.env
): Promise<DevelopmentFilesRouting> => {
  const env = { ...ambient };
  for (const name of CONVEX_SELECTOR_VARIABLES) {
    env[name] = "";
  }
  const read = async (name: string) => {
    const result = await run(
      [
        process.execPath,
        "--no-env-file",
        "x",
        "convex",
        "env",
        "get",
        name,
        "--deployment-name",
        DEVELOPMENT_DEPLOYMENT,
      ],
      { cwd: join(root, "packages/convex"), env }
    );
    const parsed = parseConvexEnvOutput(
      result.stdout,
      result.stderr,
      result.exitCode
    );
    if (parsed.status === "unavailable") {
      throw new Error(`Cannot read Convex dev ${name}; nothing was changed.`);
    }
    return parsed.status === "found" ? parsed.value : undefined;
  };
  const [bucket, prefix, filesBase, signingSecret] = await Promise.all([
    read("R2_BUCKET"),
    read("R2_KEY_PREFIX"),
    read("FILES_BASE"),
    read("FILES_SIGNING_SECRET"),
  ]);
  return { bucket, prefix, filesBase, signingSecret };
};

export interface WranglerConfigShape {
  account_id?: string;
  durable_objects?: {
    bindings?: {
      name?: string;
      class_name?: string;
      script_name?: string;
      environment?: string;
    }[];
  };
  main?: string;
  name?: string;
  r2_buckets?: {
    binding?: string;
    bucket_name?: string;
    preview_bucket_name?: string;
  }[];
  routes?: unknown[];
}

/** Only the development bucket, no routes, and a gate namespace of its own. */
export const assertDevelopmentWorkerConfig = (config: WranglerConfigShape) => {
  const bucket = config.r2_buckets?.[0];
  const gate = config.durable_objects?.bindings?.[0];
  if (
    config.name !== DEVELOPMENT_FILES_WORKER ||
    config.account_id !== CLOUDFLARE_ACCOUNT_ID ||
    config.main !== "../src/index.ts" ||
    config.routes?.length !== 0 ||
    config.r2_buckets?.length !== 1 ||
    bucket?.binding !== "BUCKET" ||
    bucket.bucket_name !== DEVELOPMENT_STORAGE_BUCKET ||
    bucket.preview_bucket_name !== DEVELOPMENT_STORAGE_BUCKET ||
    config.durable_objects?.bindings?.length !== 1 ||
    gate?.name !== "OBJECT_GATES" ||
    gate.class_name !== "ObjectDeletionGate" ||
    gate.script_name ||
    gate.environment
  ) {
    throw new Error(
      "development/wrangler.jsonc must bind only the development bucket, no routes, and its own Durable Object namespace."
    );
  }
};
