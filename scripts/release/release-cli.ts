import fs from "node:fs";

/** Helpers the release scripts share; they run under Node as well as Bun. */

export function required(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`Missing ${label}.`);
  }
  return normalized;
}

/** Parses `--name value` pairs; every flag needs a value. */
export function parseArguments(
  args: readonly string[]
): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!(flag?.startsWith("--") && value !== undefined)) {
      throw new Error(`Invalid argument near ${flag ?? "end of command"}.`);
    }
    values[flag.slice(2)] = value;
  }
  return values;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function readJson<T = unknown>(
  path: string | undefined,
  label: string
): T {
  try {
    // A file the workflow wrote and passed by flag.
    // nosemgrep: javascript_pathtraversal_rule-non-literal-fs-filename
    return JSON.parse(fs.readFileSync(required(path, label), "utf8")) as T;
  } catch (error) {
    throw new Error(`Could not read ${label}: ${errorMessage(error)}`);
  }
}

/** A GitHub Actions run link, the only URL release issues link to. */
export function githubWorkflowUrl(value: string | undefined): string {
  const url = new URL(required(value, "workflow URL"));
  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    throw new Error("Workflow URL must be an https://github.com URL.");
  }
  return url.toString();
}
