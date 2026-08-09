import { describe, expect, test } from "bun:test";
import config from "./playwright.config";

describe("production E2E project graph", () => {
  test("bounds shared-key load while parallelizing independent projects", () => {
    const projects = new Map(
      config.projects?.map((project) => [project.name, project])
    );
    expect(projects.get("journey-web")?.workers).toBe(1);
    expect(projects.get("journey-web")?.grepInvert).toEqual(
      /settings import and export surface terminal states/
    );
    expect(projects.get("journey-import-export")?.grep).toEqual(
      /settings import and export surface terminal states/
    );
    expect(projects.get("journey-import-export")?.use?.storageState).toBe(
      ".state/import-export.json"
    );
    for (const surface of ["api", "cli", "mcp"]) {
      expect(projects.get(`journey-${surface}`)?.workers).toBe(1);
    }
    expect(projects.get("journey-a11y")?.fullyParallel).toBe(true);
    expect(projects.get("snapshots")?.dependencies).toBeUndefined();
    expect(projects.get("journey-account")?.dependencies).toEqual([
      "journey-web",
      "journey-api",
      "journey-cli",
      "journey-mcp",
      "journey-a11y",
      "journey-security",
    ]);
    expect(projects.get("journey-delete")?.dependencies).toEqual([
      "journey-account",
    ]);
  });

  test("allows all three browser-matrix projects to run concurrently", () => {
    const matrix = config.projects?.filter((project) =>
      project.name.startsWith("matrix-")
    );
    expect(matrix?.map((project) => project.name).sort()).toEqual([
      "matrix-chromium",
      "matrix-firefox",
      "matrix-webkit",
    ]);
    expect(matrix?.every((project) => project.fullyParallel)).toBe(true);
    expect(config.workers).toBe(4);
  });
});
