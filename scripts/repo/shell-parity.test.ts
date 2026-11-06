import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const NOISE = {
  TEAK_NOISE_ALPHA: "unrelated-shell-value",
  TEAK_NOISE_BETA: "12345",
  SOME_RANDOM_TOOL_VAR: "/tmp/noise",
};

const runScript = (
  args: string[],
  extraEnv: Record<string, string>
): { exitCode: number; stdout: string } => {
  const env = { ...process.env, ...extraEnv };
  for (const name of Object.keys(NOISE)) {
    if (!extraEnv[name]) {
      delete env[name];
    }
  }
  const result = Bun.spawnSync(["bun", "--no-env-file", "run", ...args], {
    cwd: ROOT,
    env,
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString() };
};

// Each `setup --check` takes a few seconds on a busy runner, and this test runs
// it twice, which can pass Bun's 5 second default.
const SETUP_CHECK_TIMEOUT_MS = 30_000;

describe("shell parity", () => {
  test(
    "setup --check behaves identically with unrelated variables",
    () => {
      const args = ["scripts/setup/setup.ts", "--check"];
      const clean = runScript(args, {});
      const polluted = runScript(args, NOISE);
      expect(clean.exitCode).toBe(0);
      expect(polluted).toEqual(clean);
    },
    SETUP_CHECK_TIMEOUT_MS
  );

  test("dotenv-audit --json behaves identically with unrelated variables", () => {
    const args = ["scripts/env/dotenv-audit.ts", "--json"];
    const clean = runScript(args, {});
    const polluted = runScript(args, NOISE);
    // It exits 1 when this machine's dotenv files have findings; any other
    // code, or no report, means it crashed.
    expect([0, 1]).toContain(clean.exitCode);
    expect(JSON.parse(clean.stdout)).toMatchObject({ version: 1 });
    expect(polluted).toEqual(clean);
  });
});
