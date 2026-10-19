import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkPublicSkills, PUBLIC_SKILLS } from "../scripts/generate-skills";
import { SKILL_DESCRIPTION_MAX, validatePublicSkill } from "./agentSkills";

const skill = (frontMatter: string, body = "\n# Teak\n") =>
  `---\n${frontMatter}\n---\n${body}`;
const VALID = skill("name: teak\ndescription: Save and search Teak cards.");

describe("validatePublicSkill", () => {
  test.each([
    ["a valid SKILL.md", VALID, []],
    ["CRLF line endings", VALID.replaceAll("\n", "\r\n"), []],
    ["a BOM", `﻿${VALID}`, []],
    [
      "a folded description",
      skill("name: teak\ndescription: >\n  Save and\n  search cards."),
      [],
    ],
    [
      "no front matter",
      "# Teak\n",
      ["teak/SKILL.md has no readable front matter."],
    ],
    [
      "unparsable front matter",
      skill("name: [teak\ndescription: x"),
      ["teak/SKILL.md has no readable front matter."],
    ],
    [
      "a mismatched name",
      skill("name: teak-cli\ndescription: x"),
      ['teak/SKILL.md names itself "teak-cli", not "teak".'],
    ],
    [
      "an invalid name",
      skill("name: Teak\ndescription: x"),
      [
        'teak/SKILL.md names itself "Teak"; use lowercase letters, digits and single hyphens, up to 64 characters.',
      ],
    ],
    [
      "no description",
      skill("name: teak"),
      ["teak/SKILL.md has no description."],
    ],
    [
      "a 1,025-character description",
      skill(
        `name: teak\ndescription: ${"a".repeat(SKILL_DESCRIPTION_MAX + 1)}`
      ),
      ["teak/SKILL.md has a 1025-character description; the limit is 1024."],
    ],
  ])("%s", (_label, markdown, errors) => {
    expect(validatePublicSkill("teak", markdown).errors).toEqual(errors);
  });

  test("a 1,024-character description is allowed", () => {
    const markdown = skill(
      `name: teak\ndescription: ${"a".repeat(SKILL_DESCRIPTION_MAX)}`
    );
    expect(validatePublicSkill("teak", markdown).errors).toEqual([]);
  });

  test("a skill with other files publishes as an archive", () => {
    expect(validatePublicSkill("teak", VALID).type).toBe("skill-md");
    expect(
      validatePublicSkill("teak", VALID, ["SKILL.md", ".DS_Store"]).type
    ).toBe("skill-md");
    expect(
      validatePublicSkill("teak", VALID, ["SKILL.md", "references/api.md"])
    ).toEqual({ errors: [], type: "archive" });
  });

  test.each([...PUBLIC_SKILLS])(
    "the published %s skill passes",
    (name: string) => {
      const dir = join(import.meta.dir, "../../../.agents/skills", name);
      const markdown = readFileSync(join(dir, "SKILL.md"), "utf8");
      expect(validatePublicSkill(name, markdown, readdirSync(dir))).toEqual({
        errors: [],
        type: "skill-md",
      });
    }
  );
});

describe("checkPublicSkills", () => {
  const skillsDir = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "teak-skills-"));
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    return dir;
  };

  test("a valid skill passes, as Blume would publish it", async () => {
    expect(
      await checkPublicSkills(skillsDir({ "teak/SKILL.md": VALID }), ["teak"])
    ).toEqual([]);
  });

  test("a broken or missing skill fails before Blume can skip it", async () => {
    expect(
      await checkPublicSkills(
        skillsDir({ "teak/SKILL.md": skill("name: other\ndescription: x") }),
        ["teak"]
      )
    ).toEqual(['teak/SKILL.md names itself "other", not "teak".']);
    expect(await checkPublicSkills(skillsDir({}), ["teak"])).toEqual([
      "teak/SKILL.md is missing.",
    ]);
  });
});
