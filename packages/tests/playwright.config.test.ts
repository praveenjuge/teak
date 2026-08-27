import { describe, expect, test } from "bun:test";
import config from "./playwright.config";

describe("production E2E project graph", () => {
  test("bounds shared-key load while parallelizing independent projects", () => {
    const projects = new Map(
      config.projects?.map((project) => [project.name, project])
    );
    for (const name of [
      "journey-web-core",
      "journey-web-surfaces",
      "journey-web-files",
      "journey-web-filters",
    ]) {
      expect(projects.get(name)?.workers).toBe(1);
      expect(projects.get(name)?.dependencies).toEqual(["journey-setup"]);
      expect(projects.get(name)?.use?.storageState).toBe(
        `.state/${name.replace("journey-", "")}.json`
      );
    }
    expect(projects.get("journey-web-surfaces")?.grepInvert).toEqual(
      /settings import and export surface terminal states/
    );
    expect(projects.get("journey-web-files")?.testMatch).toBe(
      "journey/10-file-format-ui.e2e.ts"
    );
    expect(projects.get("journey-web-filters")?.testMatch).toBe(
      "journey/11-quote-favorites-filters.e2e.ts"
    );
    expect(projects.get("journey-web-core")?.use?.storageState).toBe(
      ".state/web-core.json"
    );
    expect(projects.get("journey-web-surfaces")?.use?.storageState).toBe(
      ".state/web-surfaces.json"
    );
    expect(projects.get("journey-web-files")?.use?.storageState).toBe(
      ".state/web-files.json"
    );
    expect(projects.get("journey-web-filters")?.use?.storageState).toBe(
      ".state/web-filters.json"
    );
    expect(projects.get("journey-import-export")?.grep).toEqual(
      /settings import and export surface terminal states/
    );
    expect(projects.get("journey-import-export")?.use?.storageState).toBe(
      ".state/import-export.json"
    );
    expect(projects.get("journey-import-export")?.dependencies).toEqual([
      "journey-setup",
    ]);
    for (const surface of ["api", "cli", "mcp"]) {
      expect(projects.get(`journey-${surface}`)?.workers).toBe(1);
      expect(projects.get(`journey-${surface}`)?.dependencies).toEqual([
        "journey-setup",
      ]);
    }
    expect(projects.get("journey-a11y")?.fullyParallel).toBe(true);
    expect(projects.get("journey-a11y")?.dependencies).toEqual([
      "journey-setup",
    ]);
    expect(projects.get("journey-security")?.dependencies).toEqual([
      "journey-setup",
    ]);
    expect(projects.get("snapshots")?.dependencies).toBeUndefined();
    expect(projects.get("journey-account")?.dependencies).toEqual([
      "journey-setup",
    ]);
    expect(projects.get("journey-account")?.use?.storageState).toBe(
      ".state/account.json"
    );
    expect(projects.get("journey-delete")?.dependencies).toEqual([
      "journey-account",
    ]);
    expect(projects.get("journey-delete")?.use?.storageState).toBe(
      ".state/account.json"
    );
    expect(projects.get("journey-post-delete")?.dependencies).toEqual([
      "journey-delete",
    ]);
    expect(config.use?.screenshot).toBe("only-on-failure");
    expect(config.use?.trace).toBe("retain-on-failure");
    expect(config.use?.video).toBe("retain-on-failure");
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

  test("keeps isolated web projects independent of account lifecycle", () => {
    const projects = new Map(
      config.projects?.map((project) => [project.name, project])
    );
    const isolated = [
      "journey-web-core",
      "journey-web-surfaces",
      "journey-web-files",
      "journey-web-filters",
      "journey-import-export",
      "journey-api",
      "journey-cli",
      "journey-mcp",
      "journey-a11y",
      "journey-security",
    ];
    for (const name of isolated) {
      const deps = projects.get(name)?.dependencies ?? [];
      expect(deps).not.toContain("journey-account");
      expect(deps).not.toContain("journey-delete");
    }
    const accountChain = [
      "journey-account",
      "journey-delete",
      "journey-post-delete",
    ];
    for (const name of accountChain) {
      const deps = projects.get(name)?.dependencies ?? [];
      for (const web of [
        "journey-web-core",
        "journey-web-surfaces",
        "journey-web-files",
        "journey-web-filters",
      ]) {
        expect(deps).not.toContain(web);
      }
    }
  });
});
