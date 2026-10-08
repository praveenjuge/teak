import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(root, "../../.agents/skills");
const outDir = join(root, ".generated/agent-skills");

/**
 * Skills in `.agents/skills` that Teak publishes for agents. The rest of that
 * directory holds contributor skills that stay out of the public site.
 */
export const PUBLIC_SKILLS = ["teak"] as const;

/**
 * Copies the public skills into `.generated/agent-skills` for Blume's
 * `agents.skills`, which serves them under `/.well-known/agent-skills/`.
 * Blume reads real directories only, so a symlink would be skipped.
 */
if (import.meta.main) {
  rmSync(outDir, { force: true, recursive: true });
  for (const skill of PUBLIC_SKILLS) {
    cpSync(join(sourceDir, skill), join(outDir, skill), { recursive: true });
  }
  console.log(`Copied ${PUBLIC_SKILLS.join(", ")} to ${outDir}`);
}
