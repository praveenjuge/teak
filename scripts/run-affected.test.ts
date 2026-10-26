import { describe, expect, test } from "bun:test";
import {
  affectedWorkspaces,
  listWorkspaces,
  type Workspace,
} from "./run-affected.ts";

const workspace = (
  name: string,
  dir: string,
  dependencies: string[] = []
): Workspace => ({ dependencies, dir, name, scripts: [] });

const WORKSPACES = [
  workspace("@teak/i18n", "packages/i18n"),
  workspace("@teak/convex", "packages/convex", ["@teak/i18n"]),
  workspace("teak-sdk", "packages/sdk", ["@teak/convex"]),
  workspace("teak-cli", "apps/cli", ["teak-sdk"]),
  workspace("@teak/email-worker", "apps/email-worker"),
];

describe("affectedWorkspaces", () => {
  test("a leaf change affects only its workspace", () => {
    expect(affectedWorkspaces(["apps/cli/src/index.ts"], WORKSPACES)).toEqual([
      "teak-cli",
    ]);
  });

  test("a shared package change reaches every transitive dependent", () => {
    expect(
      affectedWorkspaces(["packages/i18n/src/locales.ts"], WORKSPACES)
    ).toEqual(["@teak/convex", "@teak/i18n", "teak-cli", "teak-sdk"]);
  });

  test("a root manifest change affects every workspace", () => {
    expect(affectedWorkspaces(["bun.lock"], WORKSPACES)).toHaveLength(
      WORKSPACES.length
    );
  });

  test("the public Teak skill affects the docs that publish it", () => {
    expect(
      affectedWorkspaces(
        [".agents/skills/teak/SKILL.md"],
        [...WORKSPACES, workspace("@teak/docs", "apps/docs", ["teak-sdk"])]
      )
    ).toEqual(["@teak/docs"]);
  });

  test("files outside every workspace affect none", () => {
    expect(
      affectedWorkspaces([".github/workflows/e2e.yml", "README.md"], WORKSPACES)
    ).toEqual([]);
  });

  test("a directory name prefix is not a match", () => {
    expect(affectedWorkspaces(["apps/cli-old/x.ts"], WORKSPACES)).toEqual([]);
  });
});

describe("listWorkspaces", () => {
  test("reads every workspace with its scripts and dependencies", () => {
    const sdk = listWorkspaces().find((entry) => entry.name === "teak-sdk");
    expect(sdk?.dir).toBe("packages/sdk");
    expect(sdk?.scripts).toContain("build");
    expect(sdk?.dependencies).toContain("@teak/convex");
  });

  test("a sibling pinned to a registry version is not a dependency", () => {
    const raycast = listWorkspaces().find(
      (entry) => entry.name === "teak-raycast"
    );
    expect(raycast?.dependencies).not.toContain("teak-sdk");
  });
});
