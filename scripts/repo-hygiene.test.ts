import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import biome from "../biome.jsonc";

const ROOT = join(import.meta.dir, "..");
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies"] as const;
// Raycast installs from its own npm lockfile for the Raycast store and pins
// React to the version its runtime ships, so its ranges move on their own.
const INDEPENDENT_WORKSPACES = new Set(["apps/raycast"]);

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

  test("a dependency has one version range across workspaces", () => {
    const ranges = new Map<string, Map<string, string[]>>();
    for (const workspace of workspaces()) {
      if (INDEPENDENT_WORKSPACES.has(workspace)) {
        continue;
      }
      const manifest = JSON.parse(
        readFileSync(join(ROOT, workspace, "package.json"), "utf-8")
      ) as Partial<Record<string, Record<string, string>>>;
      for (const field of DEPENDENCY_FIELDS) {
        for (const [name, range] of Object.entries(manifest[field] ?? {})) {
          if (range.startsWith("workspace:")) {
            continue;
          }
          const byRange = ranges.get(name) ?? new Map<string, string[]>();
          byRange.set(range, [...(byRange.get(range) ?? []), workspace]);
          ranges.set(name, byRange);
        }
      }
    }
    const mismatched = [...ranges]
      .filter(([, byRange]) => byRange.size > 1)
      .map(([name, byRange]) => `${name}: ${JSON.stringify([...byRange])}`);
    expect(mismatched).toEqual([]);
  });
});
