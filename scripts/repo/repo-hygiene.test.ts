import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import biome from "../../biome.jsonc";

const ROOT = join(import.meta.dir, "../..");
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies"] as const;
// Raycast installs from its own npm lockfile for the Raycast store and pins
// React to the version its runtime ships, so its ranges move on their own.
const INDEPENDENT_WORKSPACES = new Set(["apps/raycast"]);
// `npm publish` ships these manifests as they are and doesn't resolve
// `catalog:`, so they write out the catalog's range instead.
const NPM_PUBLISHED_WORKSPACES = new Set(["apps/cli"]);

interface BiomeConfig {
  overrides?: { includes?: string[] }[];
  plugins?: ({ includes?: string[]; path: string } | string)[];
}

const literalPath = (pattern: string): string | null => {
  const path = pattern.replace(/^!/, "").replace(/^\*\*\//, "");
  return /[*?[{]/.test(path) ? null : path;
};

const biomePaths = (config: BiomeConfig): string[] => {
  const patterns = [
    ...(config.plugins ?? []).flatMap((plugin) =>
      typeof plugin === "string"
        ? [plugin]
        : [plugin.path, ...(plugin.includes ?? [])]
    ),
    ...(config.overrides ?? []).flatMap((override) => override.includes ?? []),
  ];
  return patterns
    .map(literalPath)
    .filter((path): path is string => path !== null);
};

const workspaces = (): string[] =>
  ["apps", "packages"].flatMap((area) =>
    readdirSync(join(ROOT, area), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          existsSync(join(ROOT, area, entry.name, "package.json"))
      )
      .map((entry) => `${area}/${entry.name}`)
  );

const rootCatalog = (): Record<string, string> =>
  (
    JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as {
      catalog?: Record<string, string>;
    }
  ).catalog ?? {};

interface Dependency {
  field: (typeof DEPENDENCY_FIELDS)[number];
  name: string;
  range: string;
  workspace: string;
}

const dependencies = (): Dependency[] =>
  workspaces()
    .filter((workspace) => !INDEPENDENT_WORKSPACES.has(workspace))
    .flatMap((workspace) => {
      const manifest = JSON.parse(
        readFileSync(join(ROOT, workspace, "package.json"), "utf-8")
      ) as Partial<Record<string, Record<string, string>>>;
      return DEPENDENCY_FIELDS.flatMap((field) =>
        Object.entries(manifest[field] ?? {})
          .filter(([, range]) => !range.startsWith("workspace:"))
          .map(([name, range]) => ({ workspace, field, name, range }))
      );
    });

describe("repo hygiene", () => {
  test("every file biome.jsonc names exists", () => {
    const paths = biomePaths(biome as BiomeConfig);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(existsSync(join(ROOT, path)), `biome.jsonc names ${path}`).toBe(
        true
      );
    }
  });

  test("a dependency two workspaces share comes from the root catalog", () => {
    const catalog = rootCatalog();
    const users = new Map<string, string[]>();
    for (const { workspace, name } of dependencies()) {
      users.set(name, [...(users.get(name) ?? []), workspace]);
    }
    const missing = [...users]
      .filter(([name, using]) => new Set(using).size > 1 && !(name in catalog))
      .map(([name, using]) => `${name}: ${using.join(", ")}`);
    expect(missing).toEqual([]);
  });

  test("workspaces take catalog dependencies from the catalog", () => {
    const catalog = rootCatalog();
    const wrong = dependencies()
      .filter(({ workspace, name, range }) => {
        if (!(name in catalog)) {
          return range === "catalog:";
        }
        const expected = NPM_PUBLISHED_WORKSPACES.has(workspace)
          ? catalog[name]
          : "catalog:";
        return range !== expected;
      })
      .map(
        ({ workspace, field, name, range }) =>
          `${workspace} ${field}.${name}: ${range}`
      );
    expect(wrong).toEqual([]);
  });

  test("every catalog entry has a workspace using it", () => {
    const used = new Set(dependencies().map(({ name }) => name));
    const unused = Object.keys(rootCatalog()).filter((name) => !used.has(name));
    expect(unused).toEqual([]);
  });
});
