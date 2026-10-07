import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

// Convex CLI emits no stdout for a successful function returning null. The
// process exit status is checked by execFile before this parser is called.
export function parseConvexCliResponse(stdout: string): unknown {
  if (!stdout.trim()) {
    return null;
  }
  try {
    return JSON.parse(stdout);
  } catch {
    // Captured responses can contain credentials; never include them in errors.
    throw new Error("Convex CLI returned invalid JSON");
  }
}

// Deploy keys/tokens and self-hosted pairs outrank --deployment-name in the
// Convex CLI, which also loads packages/convex/.env.local and .env itself.
// Empty values read as unset there and stop dotenv from refilling them.
export const convexDeploymentSelectors = [
  "CONVEX_DEPLOYMENT",
  "CONVEX_DEPLOY_KEY",
  "CONVEX_DEPLOYMENT_TOKEN",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
  "CONVEX_URL",
  "CONVEX_SITE_URL",
  "NEXT_PUBLIC_CONVEX_URL",
] as const;

type Execute = (
  file: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; maxBuffer: number }
) => Promise<{ stdout: string }>;

// Runs one function on exactly `deployment`: Bun dotenv is off, every ambient
// selector is blank, and the operator's WorkOS key never reaches the CLI child.
export async function runConvexFunction(
  deployment: string,
  name: string,
  args: unknown,
  maxBuffer: number,
  execute: Execute = promisify(execFile) as Execute
): Promise<unknown> {
  const { WORKOS_API_KEY: _operatorKey, ...inherited } = process.env;
  const environment: NodeJS.ProcessEnv = { ...inherited };
  for (const selector of convexDeploymentSelectors) {
    environment[selector] = "";
  }
  const { stdout } = await execute(
    process.execPath,
    [
      "--no-env-file",
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
      env: environment,
      maxBuffer,
    }
  );
  return parseConvexCliResponse(stdout);
}
