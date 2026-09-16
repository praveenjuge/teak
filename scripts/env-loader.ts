/**
 * Explicit dotenv loading for supported commands (issue #407).
 *
 * Bun no longer loads dotenv files implicitly for our scripts
 * (`--no-env-file` in package.json), so every read goes through here: the
 * caller names a target/profile and receives values from ONLY the declared
 * files in ./env-targets.ts. Names and values stay in memory; diagnostics
 * built from this loader must report names only.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EnvProfile } from "./env-contract-types.ts";
import {
  CONVEX_DOTENV_FILE,
  getTargetSpec,
  type SupportedTarget,
} from "./env-targets.ts";

export interface ParsedDotenv {
  names: string[];
  values: Map<string, string>;
}

/** First-wins dotenv parser: comments, blanks, and quotes handled. */
export const parseDotenvContent = (content: string): ParsedDotenv => {
  const values = new Map<string, string>();
  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    if (!key || values.has(key)) {
      continue;
    }
    const value = trimmed
      .slice(index + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
    values.set(key, value);
  }
  return { names: [...values.keys()], values };
};

export const parseDotenvValue = (
  content: string,
  name: string
): string | undefined => parseDotenvContent(content).values.get(name);

export const readDotenvFile = (path: string): ParsedDotenv | null => {
  if (!existsSync(path)) {
    return null;
  }
  return parseDotenvContent(readFileSync(path, "utf-8"));
};

export interface LoadedEnvFile {
  exists: boolean;
  /** Names only; values are never exposed for diagnostics. */
  names: string[];
  path: string;
}

export interface TargetEnv {
  files: LoadedEnvFile[];
  target: SupportedTarget;
  values: Map<string, string>;
}

/**
 * Load the declared dotenv files for a (target, profile) pair. Later files
 * override earlier ones; the caller decides how shell values interact.
 */
export const loadTargetEnv = (
  target: SupportedTarget,
  _profile: EnvProfile,
  root: string = join(import.meta.dir, "..")
): TargetEnv => {
  const spec = getTargetSpec(target);
  const files: LoadedEnvFile[] = [];
  const values = new Map<string, string>();
  for (const rel of spec.dotenvFiles) {
    const path = join(root, rel);
    const parsed = readDotenvFile(path);
    files.push({
      path: rel,
      exists: parsed !== null,
      names: parsed?.names ?? [],
    });
    for (const [name, value] of parsed?.values ?? []) {
      values.set(name, value);
    }
  }
  return { target, files, values };
};

/** Read the Convex CLI deployment pointer without ambient semantics. */
export const readConvexDotenv = (
  root: string = join(import.meta.dir, "..")
): ParsedDotenv | null => readDotenvFile(join(root, CONVEX_DOTENV_FILE));
