/**
 * Runs package scripts in the workspaces a change touches and every
 * workspace that depends on them: `bun run verify` and the pre-commit hook.
 *
 * - A change is everything since HEAD's merge base with main, plus staged,
 *   unstaged and untracked files.
 * - A change to a root manifest or shared config affects every workspace,
 *   and one to a directory in OUTSIDE_INPUTS affects the workspace reading it.
 * - Each script runs as its own `bun run --filter` pass, so a workspace still
 *   waits for its dependencies' run of the same script. Bun fails a filter
 *   that matches no workspace with the script, so those are dropped first.
 *
 * Usage: bun run scripts/run-affected.ts <script> [<script>...]
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const BASE_REFS = ["main", "origin/main"];
const GLOBAL_FILE_RE =
  /^(package\.json|bun\.lock|bunfig\.toml|biome\.jsonc|tsconfig[^/]*\.json)$/;
// Directories outside every workspace that one workspace reads.
const OUTSIDE_INPUTS: Record<string, string> = {
  ".agents/skills/teak/": "@teak/docs",
};

export interface Workspace {
  dependencies: string[];
  dir: string;
  name: string;
  scripts: string[];
}

export const listWorkspaces = (root = ROOT): Workspace[] => {
  const manifest = JSON.parse(
    readFileSync(join(root, "package.json"), "utf-8")
  );
  const workspaces: Workspace[] = [];
  for (const pattern of manifest.workspaces as string[]) {
    const glob = new Bun.Glob(`${pattern}/package.json`);
    for (const path of glob.scanSync({ cwd: root })) {
      const pkg = JSON.parse(readFileSync(join(root, path), "utf-8"));
      // A sibling pinned to a registry version, like Raycast's teak-sdk, is
      // not a workspace dependency.
      const specs: Record<string, string> = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };
      workspaces.push({
        dependencies: Object.keys(specs).filter((dep) =>
          specs[dep]?.startsWith("workspace:")
        ),
        dir: dirname(path),
        name: pkg.name,
        scripts: Object.keys(pkg.scripts ?? {}),
      });
    }
  }
  return workspaces;
};

/** Names of the workspaces the changed files touch, plus their dependents. */
export const affectedWorkspaces = (
  changed: string[],
  workspaces: Workspace[]
): string[] => {
  if (changed.some((file) => GLOBAL_FILE_RE.test(file))) {
    return workspaces.map((workspace) => workspace.name).sort();
  }
  const affected = new Set<string>();
  for (const file of changed) {
    const owner = workspaces.find((workspace) =>
      file.startsWith(`${workspace.dir}/`)
    );
    if (owner) {
      affected.add(owner.name);
    }
    for (const [dir, name] of Object.entries(OUTSIDE_INPUTS)) {
      if (file.startsWith(dir)) {
        affected.add(name);
      }
    }
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const workspace of workspaces) {
      if (
        !affected.has(workspace.name) &&
        workspace.dependencies.some((dep) => affected.has(dep))
      ) {
        affected.add(workspace.name);
        grew = true;
      }
    }
  }
  return [...affected].sort();
};

const git = (args: string[]): string | null => {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf-8" });
  return result.status === 0 ? result.stdout : null;
};

/** Changed paths since the merge base, or null when no base ref exists. */
const changedFiles = (): string[] | null => {
  const base = BASE_REFS.map((ref) => git(["merge-base", "HEAD", ref])).find(
    (output) => output !== null
  );
  if (!base) {
    return null;
  }
  // Without --no-renames a move lists only its destination.
  const diff = git(["diff", "--name-only", "--no-renames", base.trim()]) ?? "";
  const untracked = git(["ls-files", "--others", "--exclude-standard"]) ?? "";
  return `${diff}\n${untracked}`.split("\n").filter(Boolean);
};

if (import.meta.main) {
  const scripts = process.argv.slice(2);
  if (scripts.length === 0) {
    console.error("Usage: bun run scripts/run-affected.ts <script>...");
    process.exit(2);
  }
  const workspaces = listWorkspaces();
  const changed = changedFiles();
  if (!changed) {
    console.log(`No ${BASE_REFS.join(" or ")} to compare with; running all.`);
  }
  const affected = changed
    ? affectedWorkspaces(changed, workspaces)
    : workspaces.map((workspace) => workspace.name);
  for (const script of scripts) {
    const targets = workspaces.filter(
      (workspace) =>
        affected.includes(workspace.name) && workspace.scripts.includes(script)
    );
    if (targets.length === 0) {
      console.log(`${script}: no affected workspace has this script.`);
      continue;
    }
    const filters = targets.flatMap((workspace) => [
      "--filter",
      workspace.name,
    ]);
    const result = spawnSync(process.execPath, ["run", ...filters, script], {
      cwd: ROOT,
      stdio: "inherit",
    });
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
}
