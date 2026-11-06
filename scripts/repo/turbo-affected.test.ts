import { expect, test } from "bun:test";
import { dirname, join, relative } from "node:path";

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

const SCRIPTS = join(ROOT, "scripts");
const APP_IMPORT = /(?:from |import\()"((?:\.\.\/)+apps\/[^"]+)"/g;

const readJsonc = async (file: string) =>
  Bun.JSONC.parse(await Bun.file(file).text()) as Record<string, unknown>;

// The scripts typecheck reads other apps' source, which are not workspace
// dependencies, so a change there only reruns it if its inputs name that source.
test("the scripts typecheck reruns when an app file it imports changes", async () => {
  const tsconfig = (await readJsonc(join(SCRIPTS, "tsconfig.json"))) as {
    exclude: string[];
  };
  const turbo = (await readJsonc(join(SCRIPTS, "turbo.json"))) as {
    tasks: { typecheck: { inputs: string[] } };
  };
  const inputs = turbo.tasks.typecheck.inputs
    .filter((input) => input.startsWith("$TURBO_ROOT$/"))
    .map((input) => new Bun.Glob(input.slice("$TURBO_ROOT$/".length)));
  const excluded = new Set(tsconfig.exclude);
  const uncovered: string[] = [];
  for await (const file of new Bun.Glob("**/*.ts").scan(SCRIPTS)) {
    if (file.includes("node_modules/") || excluded.has(file)) {
      continue;
    }
    const source = await Bun.file(join(SCRIPTS, file)).text();
    for (const [, specifier] of source.matchAll(APP_IMPORT)) {
      const target = relative(ROOT, join(SCRIPTS, dirname(file), specifier));
      const candidates = [target, `${target}.ts`, `${target}.tsx`];
      if (!inputs.some((glob) => candidates.some((c) => glob.match(c)))) {
        uncovered.push(`${file} → ${target}`);
      }
    }
  }
  expect(uncovered).toEqual([]);
});
