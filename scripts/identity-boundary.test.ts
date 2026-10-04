import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const lint = (source: string) => {
  // Keep a repeatable fixture artifact without touching backend source files.
  const directory = mkdtempSync(join(tmpdir(), "teak-identity-lint-"));
  const config = readFileSync(join(root, "biome.jsonc"), "utf8")
    .replace("{", '{ "vcs": { "enabled": false },')
    .replaceAll(/"ultracite\/biome\/(core|react|next)"/g, (value) =>
      JSON.stringify(Bun.resolveSync(JSON.parse(value), root))
    )
    .replace(
      '"./scripts/lint/no-raw-identity.grit"',
      JSON.stringify(join(root, "scripts/lint/no-raw-identity.grit"))
    );
  writeFileSync(join(directory, "biome.jsonc"), config);
  mkdirSync(join(directory, "packages/convex"), { recursive: true });
  const fixture = join(directory, "packages/convex/fixture.ts");
  writeFileSync(fixture, source);
  return spawnSync(
    process.execPath,
    [
      join(root, "node_modules/@biomejs/biome/bin/biome"),
      "lint",
      "--only=plugin",
      fixture,
    ],
    { cwd: directory, encoding: "utf8" }
  );
};

const unsafeCases = readFileSync(
  new URL("./fixtures/raw-identity.ts.txt", import.meta.url),
  "utf8"
)
  .split("\n")
  .filter((line) => line.trim() && !line.startsWith("declare "));
test.each(unsafeCases)(
  "the configured identity plugin rejects: %s",
  (source) => {
    const result = lint(source);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Read authentication identities only in securitySessions.ts"
    );
    expect(result.stderr).not.toContain("errored");
    expect(result.stderr).not.toContain("parse");
  }
);

test("the configured backend identity plugin accepts the permanent owner boundary", () => {
  const result = lint(
    "const user = await getSessionUser(ctx); const owner = user?.teakUserId;"
  );
  expect(result.status).toBe(0);
});
