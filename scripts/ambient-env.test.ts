import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const POISON_NAME = "TEAK_AMBIENT_PROBE_POISON";
const POISON_VALUE = "poison-from-dotenv-file";

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs = [];
});

const makeFixture = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "teak-ambient-"));
  dirs.push(dir);
  writeFileSync(join(dir, ".env.local"), `${POISON_NAME}=${POISON_VALUE}\n`);
  writeFileSync(join(dir, "package.json"), '{"name":"ambient-fixture"}\n');
  writeFileSync(
    join(dir, "show.ts"),
    `console.log(process.env.${POISON_NAME} ?? "<absent>");\n`
  );
  return dir;
};

const runBun = (
  dir: string,
  args: string[],
  extraEnv: Record<string, string> = {}
): string => {
  // Start clean: the probe name must not leak in from the parent shell.
  // Pin NODE_ENV=development because `bun test` sets NODE_ENV=test, under
  // which Bun skips `.env.local` (the file our commands must ignore).
  const env = { ...process.env, NODE_ENV: "development", ...extraEnv };
  if (!extraEnv[POISON_NAME]) {
    delete env[POISON_NAME];
  }
  const result = Bun.spawnSync(["bun", ...args], { cwd: dir, env });
  return result.stdout.toString().trim();
};

describe("ambient dotenv", () => {
  test("supported root scripts opt out of Bun dotenv loading", () => {
    const packageJson = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "package.json"), "utf-8")
    ) as { scripts: Record<string, string> };
    const supported = Object.entries(packageJson.scripts).filter(([, value]) =>
      value.includes("scripts/")
    );
    expect(supported.length).toBeGreaterThan(0);
    for (const [, value] of supported) {
      expect(value).toContain("--no-env-file");
    }
  });

  test("plain bun run consumes .env.local implicitly", () => {
    const dir = makeFixture();
    expect(runBun(dir, ["run", "./show.ts"])).toBe(POISON_VALUE);
  });

  test("--no-env-file ignores .env.local", () => {
    const dir = makeFixture();
    expect(runBun(dir, ["--no-env-file", "run", "./show.ts"])).toBe("<absent>");
  });

  test("--no-env-file preserves explicit shell exports", () => {
    const dir = makeFixture();
    expect(
      runBun(dir, ["--no-env-file", "run", "./show.ts"], {
        [POISON_NAME]: "shell-value",
      })
    ).toBe("shell-value");
  });
});
