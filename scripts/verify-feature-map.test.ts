import { describe, expect, test } from "bun:test";
import {
  accessSync,
  constants,
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const SKILL = join(import.meta.dir, "../.agents/skills/verify-teak");
const FEATURES = join(SKILL, "features");

const FEATURE_SECTIONS = [
  /^Sub-features$/,
  /^How to get to it \(user POV\)$/,
  /^Driving it with .+$/,
  /^Gotchas$/,
];

const featureFiles = (): string[] =>
  readdirSync(FEATURES)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort();

const relativeLinks = (markdown: string): string[] =>
  [...markdown.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)]
    .map((match) => match[1] ?? "")
    .filter((target) => !/^[a-z]+:/.test(target));

describe("verify-teak feature map", () => {
  test("the skill registers with a name and description", () => {
    const skill = readFileSync(join(SKILL, "SKILL.md"), "utf-8");
    expect(skill).toMatch(/^---\nname: verify-teak\ndescription: .+\n---\n/);
  });

  test("every feature file is listed in the index, and every index link resolves", () => {
    const index = readFileSync(join(FEATURES, "README.md"), "utf-8");
    const linked = relativeLinks(index).map((target) =>
      target.replace(/^\.\//, "")
    );
    expect(featureFiles().length).toBeGreaterThan(0);
    for (const file of featureFiles()) {
      expect(linked, `${file} is missing from features/README.md`).toContain(
        file
      );
    }
    for (const target of linked) {
      expect(
        existsSync(join(FEATURES, target)),
        `features/README.md links to missing ${target}`
      ).toBe(true);
    }
  });

  test.each(featureFiles())(
    "%s has a title, a summary and the four sections in order",
    (file) => {
      const text = readFileSync(join(FEATURES, file), "utf-8");
      expect(text, `${file} must start with an H1`).toMatch(/^# \S/);
      const intro = text.slice(text.indexOf("\n"), text.indexOf("\n## "));
      expect(
        intro.trim(),
        `${file} needs a summary paragraph before its first section`
      ).not.toBe("");
      const headings = [...text.matchAll(/^## (.+)$/gm)].map(
        (match) => match[1] ?? ""
      );
      expect(headings).toHaveLength(FEATURE_SECTIONS.length);
      headings.forEach((heading, i) => {
        expect(heading).toMatch(FEATURE_SECTIONS[i] as RegExp);
      });
    }
  );

  test("links from the skill and its features resolve", () => {
    const files = [
      join(SKILL, "SKILL.md"),
      ...featureFiles().map((f) => join(FEATURES, f)),
    ];
    for (const file of files) {
      for (const target of relativeLinks(readFileSync(file, "utf-8"))) {
        expect(
          existsSync(join(dirname(file), target)),
          `${file} links to missing ${target}`
        ).toBe(true);
      }
    }
  });

  test.each(["doctor.ts", "api-key.ts"])("helper %s is executable", (name) => {
    expect(() =>
      accessSync(join(SKILL, "scripts", name), constants.X_OK)
    ).not.toThrow();
  });
});
