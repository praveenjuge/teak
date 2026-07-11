import { describe, expect, test } from "bun:test";
import config from "./playwright.config";

describe("production E2E project graph", () => {
  test("bounds shared-key load while parallelizing independent projects", () => {
    const projects = new Map(
      config.projects?.map((project) => [project.name, project])
    );
    expect(projects.get("journey-web")?.workers).toBe(1);
    expect(projects.get("journey-services")?.fullyParallel).not.toBe(true);
    expect(projects.get("journey-services")?.workers).toBe(1);
    expect(projects.get("journey-a11y")?.fullyParallel).toBe(true);
    expect(projects.get("snapshots")?.dependencies).toEqual(["snapshot-setup"]);
    expect(projects.get("journey-account")?.dependencies).toEqual([
      "journey-web",
      "journey-services",
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
