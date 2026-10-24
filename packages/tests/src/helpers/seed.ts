import { spawn } from "node:child_process";
import { findEmulatorUser } from "./emulator";

const CONVEX_DIR = new URL("../../../convex/", import.meta.url).pathname;

/**
 * Adds a `devSeed:seedScenario` pack to an E2E account, as `bunx convex run`
 * does from packages/convex. While the stack runs, packages/convex/.env.local
 * selects its local backend; a cloud deploy key is never passed on, so this
 * can only reach the local anonymous backend (as the stack's own Convex CLI
 * calls do, `src/stack/backend.ts`).
 */
export const seedScenario = async (
  email: string,
  scenario: string,
  options: { origin?: string } = {}
) => {
  const user = await findEmulatorUser(email);
  if (!user) {
    throw new Error(`No emulator user for ${email}`);
  }
  const { CONVEX_DEPLOY_KEY: _cloudKey, ...env } = process.env;
  const proc = spawn(
    "bunx",
    [
      "convex",
      "run",
      "devSeed:seedScenario",
      JSON.stringify({ workosUserId: user.id, scenario, ...options }),
    ],
    { cwd: CONVEX_DIR, env: { ...env, CONVEX_AGENT_MODE: "anonymous" } }
  );
  let output = "";
  for (const stream of [proc.stdout, proc.stderr]) {
    stream.on("data", (chunk) => {
      output += String(chunk);
    });
  }
  const code = await new Promise<number | null>((resolve) => {
    proc.on("close", resolve);
  });
  if (code !== 0) {
    throw new Error(`Seeding ${scenario} failed: ${output}`);
  }
};
