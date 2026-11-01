import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONVEX_DOTENV_FILE,
  getTargetSpec,
  type SupportedTarget,
} from "./env-targets.ts";

export interface ParsedDotenv {
  names: string[];
  values: Map<string, string>;
}

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
    const raw = trimmed.slice(index + 1).trim();
    // Unquoted values end at an inline comment, as `convex dev` writes them
    // (`CONVEX_DEPLOYMENT=dev:name # team: …`).
    const value = (
      /^['"]/.test(raw) ? raw : raw.replace(/\s+#.*$/, "")
    ).replace(/^(['"])(.*)\1$/, "$2");
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
  names: string[];
  path: string;
}

export interface TargetEnv {
  files: LoadedEnvFile[];
  target: SupportedTarget;
  values: Map<string, string>;
}

export const loadTargetEnv = (
  target: SupportedTarget,
  root: string = join(import.meta.dir, "../..")
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

export const readConvexDotenv = (
  root: string = join(import.meta.dir, "../..")
): ParsedDotenv | null => readDotenvFile(join(root, CONVEX_DOTENV_FILE));
