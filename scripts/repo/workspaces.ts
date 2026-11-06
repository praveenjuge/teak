import fs from "node:fs";
import path from "node:path";

/**
 * The workspace directories the root package.json declares, such as
 * `apps/web` for `apps/*`, that hold a package.json. Release scripts run it
 * under Node too, so it imports nothing but Node.
 */
export function workspaceDirectories(repoRoot: string): string[] {
  const { workspaces = [] } = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
  ) as { workspaces?: string[] };
  const directories = workspaces.flatMap((pattern) => {
    if (!pattern.includes("*")) {
      return [pattern];
    }
    if (!pattern.endsWith("/*") || pattern.slice(0, -2).includes("*")) {
      throw new Error(`Unsupported workspace pattern: ${pattern}`);
    }
    const parent = pattern.slice(0, -2);
    return fs
      .readdirSync(path.join(repoRoot, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`);
  });
  return directories
    .filter((directory) =>
      fs.existsSync(path.join(repoRoot, directory, "package.json"))
    )
    .sort();
}
