import { expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

// `bun run verify` and the pre-commit hook select tasks by their inputs
// (futureFlags.affectedUsingTaskInputs). An input glob Turbo can't read, such
// as one with parentheses, silently selects every task instead.
test("Turbo can tell which tasks a change affects", () => {
  const result = Bun.spawnSync(
    [
      join(ROOT, "node_modules/.bin/turbo"),
      "run",
      "typecheck",
      "lint",
      "test",
      "build",
      "--affected",
      "--dry=json",
    ],
    {
      cwd: ROOT,
      env: { ...process.env, TURBO_SCM_BASE: "HEAD", TURBO_UI: "false" },
    }
  );
  expect(result.exitCode).toBe(0);
  const warnings = result.stderr.toString();
  expect(warnings).not.toContain("unable to project task affectedness");
  expect(warnings).not.toContain("could not determine changed files");
});
