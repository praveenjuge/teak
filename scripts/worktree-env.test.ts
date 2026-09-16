import { describe, expect, test } from "bun:test";
import {
  MAIN_PORTS,
  MAIN_SITE_URL,
  mainWorktreePorts,
  resolveWorktreeFromPaths,
} from "./worktree-env.ts";

describe("worktree-env", () => {
  test("main checkout keeps fixed ports and site url", () => {
    expect(mainWorktreePorts()).toEqual({
      namespace: "main",
      namespaced: false,
      web: MAIN_PORTS.web,
      docs: MAIN_PORTS.docs,
      convex: MAIN_PORTS.convex,
      convexSite: MAIN_PORTS.convexSite,
      siteUrl: MAIN_SITE_URL,
    });
    expect(resolveWorktreeFromPaths("/repo", "/repo")).toEqual(
      mainWorktreePorts()
    );
    expect(resolveWorktreeFromPaths("/repo", null)).toEqual(
      mainWorktreePorts()
    );
  });

  test("linked worktrees get deterministic non colliding ports", () => {
    const first = resolveWorktreeFromPaths("/work/a", "/repo");
    const again = resolveWorktreeFromPaths("/work/a", "/repo");
    expect(first).toEqual(again);
    expect(first.namespaced).toBe(true);
    expect(first.web).toBeGreaterThanOrEqual(4000);
    expect(first.web).toBeLessThan(8000);
    expect(
      new Set([first.web, first.docs, first.convex, first.convexSite]).size
    ).toBe(4);
    expect(first.siteUrl).toBe(`http://localhost:${first.web}`);
  });

  test("slots never overlap the main ports", () => {
    const main = new Set(Object.values(MAIN_PORTS));
    for (let i = 0; i < 200; i++) {
      const ports = resolveWorktreeFromPaths(`/work/tree-${i}`, "/repo");
      for (const port of [
        ports.web,
        ports.docs,
        ports.convex,
        ports.convexSite,
      ]) {
        expect(main.has(port)).toBe(false);
      }
    }
  });
});
