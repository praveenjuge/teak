import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const convexRoot = resolve(import.meta.dirname, "../..");
const repositoryRoot = resolve(convexRoot, "../..");
const readConvexSource = (relativePath: string) =>
  readFileSync(resolve(convexRoot, relativePath), "utf8");

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

describe("backend telemetry Node runtime", () => {
  test("marks every Node-only AI telemetry helper", () => {
    for (const relativePath of [
      "ai/telemetry.ts",
      "workflows/aiMetadata/generators.ts",
      "workflows/aiMetadata/transcript.ts",
    ]) {
      expect(readConvexSource(relativePath).trimStart()).toStartWith(
        '"use node";'
      );
    }
  });

  test("keeps Node-only helpers out of the default-runtime workflow barrel", () => {
    const source = readConvexSource("workflows/aiMetadata/index.ts");

    expect(source).not.toContain('from "./generators"');
    expect(source).not.toContain('from "./transcript"');
  });

  test("uses Convex-compatible deployable module paths", () => {
    const invalidPaths = listDeployableSourceFiles(convexRoot).filter((path) =>
      path.split("/").some((component) => !/^[A-Za-z0-9_.]+$/.test(component))
    );

    expect(invalidPaths).toEqual([]);
  });

  test("links hoisted TypeScript where Convex deploy resolves it", () => {
    const workflow = readFileSync(
      resolve(repositoryRoot, ".github/workflows/backend-deploy.yml"),
      "utf8"
    );

    expect(workflow).toContain(
      'ln -s "$GITHUB_WORKSPACE/node_modules/typescript" node_modules/typescript'
    );
    expect(workflow).toContain("test -f node_modules/typescript/bin/tsc");
    expect(workflow).toContain("--typecheck enable");
    expect(workflow).toContain("--typecheck-components");
  });
});
