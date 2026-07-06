import { spawn } from "node:child_process";
import { env } from "./env";

export const runCli = async (
  kind: "repo" | "npm",
  args: string[],
  apiKey: string
) => {
  const npmBin =
    process.env.TEAK_NPM_BIN ||
    `${process.env.RUNNER_TEMP}/teak-npm/node_modules/.bin/teak`;
  const command =
    kind === "repo"
      ? ["bun", "apps/cli/src/index.ts", ...args]
      : [npmBin, ...args];
  const proc = spawn(command[0], command.slice(1), {
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
    throw new Error(`${kind} CLI failed: ${stderr || stdout}`);
  }
  return stdout.trim();
};
