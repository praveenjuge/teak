import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

/** Nested skill copies outside the canonical root source. */
const findNestedSkills = (root: string): string[] => {
  const nested: string[] = [];
  for (const area of ["apps", "packages"]) {
    const areaDir = join(root, area);
    if (!existsSync(areaDir)) {
      continue;
    }
    for (const entry of readdirSync(areaDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const skills = join(areaDir, entry.name, ".agents", "skills");
        if (existsSync(skills)) {
          nested.push(`${area}/${entry.name}/.agents/skills`);
        }
      }
    }
  }
  return nested;
};

describe("skills drift", () => {
  test("convex skills live only in the canonical root source", () => {
    expect(findNestedSkills(ROOT)).toEqual([]);
    expect(existsSync(join(ROOT, ".agents/skills"))).toBe(true);
  });

  test("every locked convex skill resolves to the canonical source", () => {
    const lock = JSON.parse(
      readFileSync(join(ROOT, "skills-lock.json"), "utf-8")
    ) as { skills: Record<string, { ref?: string; source?: string }> };
    const convex = Object.entries(lock.skills).filter(([, skill]) =>
      skill.source?.startsWith("get-convex/")
    );
    expect(convex.length).toBeGreaterThan(0);
    for (const [name] of convex) {
      expect(
        existsSync(join(ROOT, ".agents/skills", name, "SKILL.md")),
        `${name} is locked but missing from .agents/skills`
      ).toBe(true);
    }
  });
});
