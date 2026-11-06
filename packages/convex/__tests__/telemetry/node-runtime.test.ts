import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const convexRoot = resolve(import.meta.dirname, "../..");

const listDeployableSourceFiles = (
  directory: string,
  relativeDirectory = ""
): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;

    if (entry.isDirectory()) {
      if (
        ["__tests__", "_generated", "node_modules", "types"].includes(
          entry.name
        )
      ) {
        return [];
      }
      return listDeployableSourceFiles(
        resolve(directory, entry.name),
        relativePath
      );
    }

    return /\.(?:js|jsx|ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
      ? [relativePath]
      : [];
  });

describe("deployable Convex modules", () => {
  test("uses Convex-compatible deployable module paths", () => {
    const invalidPaths = listDeployableSourceFiles(convexRoot).filter((path) =>
      path.split("/").some((component) => !/^[A-Za-z0-9_.]+$/.test(component))
    );

    expect(invalidPaths).toEqual([]);
  });
});
