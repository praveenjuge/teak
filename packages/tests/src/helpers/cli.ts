import { spawn } from "node:child_process";
import { env } from "./env";

// Runs the CLI from this checkout against the local API.
export const runCli = async (args: string[], apiKey: string) => {
  const proc = spawn("bun", ["apps/cli/src/index.ts", ...args], {
    cwd: new URL("../../../../", import.meta.url).pathname,
    env: { ...process.env, TEAK_API_KEY: apiKey, TEAK_API_URL: env.apiUrl },
  });
  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  proc.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const code = await new Promise<number | null>((resolve) => {
    proc.on("close", resolve);
  });
  if (code !== 0) {
    throw new Error(`CLI failed: ${stderr || stdout}`);
  }
  return stdout.trim();
};
