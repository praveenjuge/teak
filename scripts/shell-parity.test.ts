import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const NOISE = {
  TEAK_NOISE_ALPHA: "unrelated-shell-value",
  TEAK_NOISE_BETA: "12345",
  SOME_RANDOM_TOOL_VAR: "/tmp/noise",
};

const runSetupCheck = (extraEnv: Record<string, string>): string => {
  const env = { ...process.env, ...extraEnv };
  for (const name of Object.keys(NOISE)) {
    if (!extraEnv[name]) {
      delete env[name];
    }
  }
  const result = Bun.spawnSync(
    ["bun", "--no-env-file", "run", "scripts/setup.ts", "--check"],
    { cwd: ROOT, env }
  );
  expect(result.exitCode).toBe(0);
  return result.stdout.toString();
};

describe("shell parity", () => {
  test("setup --check behaves identically with unrelated variables", () => {
    const clean = runSetupCheck({});
    const polluted = runSetupCheck(NOISE);
    expect(polluted).toBe(clean);
  });

  test("dotenv-audit --json behaves identically with unrelated variables", () => {
    const run = (extraEnv: Record<string, string>): string => {
      const env = { ...process.env, ...extraEnv };
      for (const name of Object.keys(NOISE)) {
        if (!extraEnv[name]) {
          delete env[name];
        }
      }
      const result = Bun.spawnSync(
        ["bun", "--no-env-file", "run", "scripts/dotenv-audit.ts", "--json"],
        { cwd: ROOT, env }
      );
      return result.stdout.toString();
    };
    expect(run(NOISE)).toBe(run({}));
  });
});
