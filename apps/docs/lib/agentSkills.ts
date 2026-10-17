/**
 * The rules Blume applies before it publishes a skill in the discovery index
 * (`blume/src/ai/skills.ts`), which skips a skill that breaks them with only
 * a build warning. The docs build checks them first and fails instead.
 */

/** Lowercase letters and digits in words joined by single hyphens. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SKILL_NAME_MAX = 64;
/** The Agent Skills spec caps `description` at 1,024 characters. */
export const SKILL_DESCRIPTION_MAX = 1024;
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;

export interface PublicSkillCheck {
  errors: string[];
  /**
   * How Blume publishes it: a lone `SKILL.md` verbatim, or a skill with
   * other files as a `.tar.gz` archive.
   */
  type: "archive" | "skill-md";
}

const readFrontMatter = (markdown: string): Record<string, unknown> | null => {
  const match = FRONT_MATTER.exec(markdown.replace(/^﻿/u, ""));
  if (!match) {
    return null;
  }
  try {
    const data = Bun.YAML.parse(match[1] ?? "");
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

/**
 * Checks a public skill: `dir` is its directory name, `markdown` its
 * `SKILL.md`, and `files` every file in the directory. It needs front matter
 * with a `name` equal to the directory and a `description` of at most 1,024
 * characters. Errors read as sentences.
 */
export const validatePublicSkill = (
  dir: string,
  markdown: string,
  files: readonly string[] = ["SKILL.md"]
): PublicSkillCheck => {
  const published = files.filter((file) => !file.startsWith("."));
  const type =
    published.length === 1 && published[0] === "SKILL.md"
      ? "skill-md"
      : "archive";
  const data = readFrontMatter(markdown);
  if (!data) {
    return {
      errors: [`${dir}/SKILL.md has no readable front matter.`],
      type,
    };
  }
  const errors: string[] = [];
  const { description, name } = data;
  if (typeof name !== "string" || !name) {
    errors.push(`${dir}/SKILL.md has no name.`);
  } else if (!SKILL_NAME.test(name) || name.length > SKILL_NAME_MAX) {
    errors.push(
      `${dir}/SKILL.md names itself "${name}"; use lowercase letters, digits and single hyphens, up to ${SKILL_NAME_MAX} characters.`
    );
  } else if (name !== dir) {
    errors.push(`${dir}/SKILL.md names itself "${name}", not "${dir}".`);
  }
  if (typeof description !== "string" || !description.trim()) {
    errors.push(`${dir}/SKILL.md has no description.`);
  } else if (description.length > SKILL_DESCRIPTION_MAX) {
    errors.push(
      `${dir}/SKILL.md has a ${description.length}-character description; the limit is ${SKILL_DESCRIPTION_MAX}.`
    );
  }
  return { errors, type };
};
