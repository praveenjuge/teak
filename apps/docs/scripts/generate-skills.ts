import { cpSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectSkills } from "blume/ai/skills.ts";
import { validatePublicSkill } from "../lib/agentSkills";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(root, "../../.agents/skills");
const outDir = join(root, ".generated/agent-skills");

export const PUBLIC_SKILLS = ["teak"] as const;

/** Every reason the public skills can't be published as they are. */
export const checkPublicSkills = async (
  skillsDir: string,
  names: readonly string[]
): Promise<string[]> => {
  const errors = names.flatMap((name) => {
    const dir = join(skillsDir, name);
    try {
      return validatePublicSkill(
        name,
        readFileSync(join(dir, "SKILL.md"), "utf8"),
        readdirSync(dir)
      ).errors;
    } catch {
      return [`${name}/SKILL.md is missing.`];
    }
  });
  if (errors.length > 0) {
    return errors;
  }
  // Blume skips a skill it can't publish with only a warning.
  const { skills, warnings } = await collectSkills(skillsDir);
  const published = new Set(skills.map((skill) => skill.name));
  return [
    ...warnings,
    ...names
      .filter((name) => !published.has(name))
      .map((name) => `Blume would not publish ${name}.`),
  ];
};

/**
 * Copies the public skills into `.generated/agent-skills` for Blume's
 * `agents.skills`, which serves them under `/.well-known/agent-skills/`.
 * Blume reads real directories only, so a symlink would be skipped. A skill
 * Blume would skip fails here instead, so it never silently drops out of the
 * discovery index.
 */
if (import.meta.main) {
  rmSync(outDir, { force: true, recursive: true });
  for (const skill of PUBLIC_SKILLS) {
    cpSync(join(sourceDir, skill), join(outDir, skill), { recursive: true });
  }
  const errors = await checkPublicSkills(outDir, PUBLIC_SKILLS);
  if (errors.length > 0) {
    console.error(
      ["Public skills can't be published:", ...errors].join("\n  ")
    );
    process.exit(1);
  }
  console.log(`Copied ${PUBLIC_SKILLS.join(", ")} to ${outDir}`);
}
