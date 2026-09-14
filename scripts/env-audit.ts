#!/usr/bin/env bun
/**
 * Environment audit: the contract in ./env-contract.ts against the repo.
 *
 * Scans process.env / import.meta.env reads, Worker bindings, workflows, and
 * Turbo declarations. Fails on undeclared variables, stale contract entries,
 * secret values reachable from diagnostics, or deleted aliases returning.
 * Reports variable names only, never values.
 *
 * Usage: bun run scripts/env-audit.ts
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  ENV_CONTRACT,
  ENV_VAR_NAMES,
  isDeletedAlias,
  isPlatformVar,
  SECRET_VAR_NAMES,
} from "./env-contract.ts";

const ROOT = join(import.meta.dir, "..");

export interface AuditFinding {
  detail: string;
  kind:
    | "undeclared"
    | "stale"
    | "secret-in-diagnostics"
    | "deleted-alias"
    | "turbo-wildcard";
  name: string;
  path: string;
}

const SCAN_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".rb",
  ".sh",
  ".yml",
  ".yaml",
  ".json",
  ".jsonc",
]);

const SKIP_DIRS = new Set([
  ".git",
  ".turbo",
  ".next",
  ".vercel",
  ".expo",
  "node_modules",
  "dist",
  "build",
  "out",
  ".output",
  "coverage",
  "playwright-report",
  "test-results",
  ".state",
  ".tmp",
  ".convex",
  "_generated",
  "ios",
  "android",
]);

/** Files that meta-reference names (contract, audit, tests) are not evidence. */
const META_FILES = new Set([
  "scripts/env-contract.ts",
  "scripts/env-audit.ts",
  "scripts/env-contract.test.ts",
  "scripts/env-audit.test.ts",
]);

/** Docs may name deleted aliases when documenting the migration. */
const DOC_EXTENSIONS = new Set([".md", ".mdx", ".txt"]);

export const listScannedFiles = (root: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = relative(root, full);
      if (entry.startsWith(".env") || entry === ".dev.vars") {
        continue;
      }
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (!(SKIP_DIRS.has(entry) || entry.startsWith("."))) {
          walk(full);
        } else if (entry === ".github") {
          walk(full);
        }
        continue;
      }
      if (stat.isFile()) {
        if (entry.endsWith(".d.ts")) {
          continue;
        }
        const dot = entry.lastIndexOf(".");
        const ext = dot >= 0 ? entry.slice(dot) : "";
        if (SCAN_EXTENSIONS.has(ext) || DOC_EXTENSIONS.has(ext)) {
          out.push(rel);
        }
      }
    }
  };
  walk(root);
  return out.sort();
};

const PROCESS_ENV_RE =
  /process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[['"]([A-Za-z_][A-Za-z0-9_]*)['"]\])/g;
const IMPORT_META_ENV_RE = /import\.meta\.env(?:\.([A-Za-z_][A-Za-z0-9_]*))/g;
const RUBY_ENV_RE = /ENV(?:\.fetch|\[)\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g;
const SHELL_VAR_RE =
  /\$\{([A-Za-z_][A-Za-z0-9_]*)[^}]*\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
const SECRETS_REF_RE = /\$\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const VARS_REF_RE = /\$\{\{\s*vars\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const ENV_BLOCK_KEY_RE = /^\s{2,}env:\s*$/;
/** Convex typed env reads: env.NAME and env?.NAME. */
const TYPED_ENV_RE = /(?:^|[^\w$.])env\??\.([A-Z][A-Za-z0-9_]*)/g;

export interface NameUse {
  line: number;
  name: string;
}

const collectMatches = (
  content: string,
  re: RegExp,
  lineOf: (index: number) => number
): NameUse[] => {
  const uses: NameUse[] = [];
  for (const match of content.matchAll(re)) {
    const name = match[1] ?? match[2];
    if (name) {
      uses.push({ name, line: lineOf(match.index ?? 0) });
    }
  }
  return uses;
};

const makeLineOf = (content: string): ((index: number) => number) => {
  const offsets: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") {
      offsets.push(i + 1);
    }
  }
  return (index: number): number => {
    let line = 1;
    for (const offset of offsets) {
      if (offset > index) {
        break;
      }
      line++;
    }
    return line - 1;
  };
};

export const extractCodeUses = (content: string): NameUse[] => {
  const lineOf = makeLineOf(content);
  return [
    ...collectMatches(content, PROCESS_ENV_RE, lineOf),
    ...collectMatches(content, IMPORT_META_ENV_RE, lineOf),
    ...collectMatches(content, RUBY_ENV_RE, lineOf),
  ];
};

export const extractTypedEnvUses = (content: string): NameUse[] =>
  collectMatches(content, TYPED_ENV_RE, makeLineOf(content));

const SHELL_ASSIGN_RE =
  /^\s*(?:export\s+|local\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/gm;

export const extractShellUses = (content: string): NameUse[] => {
  const lineOf = makeLineOf(content);
  const firstAssignLine = new Map<string, number>();
  for (const assign of content.matchAll(SHELL_ASSIGN_RE)) {
    if (!firstAssignLine.has(assign[1])) {
      firstAssignLine.set(assign[1], lineOf(assign.index ?? 0));
    }
  }
  // A ${NAME...} expansion inherits external input only when it appears on
  // or before the name's first assignment (the `NAME="${NAME:-default}"`
  // idiom). Later brace reads are local self-transforms.
  const externalBrace = new Set<string>();
  const braceRe = /\$\{([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const brace of content.matchAll(braceRe)) {
    const firstLine = firstAssignLine.get(brace[1]);
    if (firstLine === undefined || lineOf(brace.index ?? 0) <= firstLine) {
      externalBrace.add(brace[1]);
    }
  }
  return collectMatches(content, SHELL_VAR_RE, lineOf).filter(
    ({ name }) =>
      name === name.toUpperCase() &&
      (!firstAssignLine.has(name) || externalBrace.has(name)) &&
      !isPlatformVar(name)
  );
};

export const extractWorkflowRefs = (
  content: string
): { secrets: NameUse[]; vars: NameUse[] } => {
  const lineOf = makeLineOf(content);
  return {
    secrets: collectMatches(content, SECRETS_REF_RE, lineOf),
    vars: collectMatches(content, VARS_REF_RE, lineOf),
  };
};

/** Names materialized for later steps via `echo "NAME=..." >> $GITHUB_ENV`. */
const GITHUB_ENV_WRITE_RE =
  /"([A-Za-z_][A-Za-z0-9_]*)=[^"]*"\s*>>\s*"?\$GITHUB_ENV"?/g;

export const extractGithubEnvWrites = (content: string): NameUse[] =>
  collectMatches(content, GITHUB_ENV_WRITE_RE, makeLineOf(content));

/** Keys declared by `env:` blocks are self-declaring workflow-local or contract names. */
export const extractWorkflowEnvKeys = (content: string): NameUse[] => {
  const uses: NameUse[] = [];
  const lines = content.split("\n");
  let inEnvBlock = false;
  let envIndent = 0;
  lines.forEach((line, index) => {
    if (ENV_BLOCK_KEY_RE.test(line)) {
      inEnvBlock = true;
      envIndent = line.search(/\S/);
      return;
    }
    if (!inEnvBlock) {
      return;
    }
    const match = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line);
    if (!(match && match[1].length > envIndent)) {
      inEnvBlock = false;
      return;
    }
    uses.push({ name: match[2], line: index + 1 });
  });
  return uses;
};

export interface TurboDecl {
  name: string;
  path: string;
}

export const extractTurboDecls = (
  content: string,
  path: string
): TurboDecl[] => {
  let parsed: {
    globalEnv?: string[];
    globalPassThroughEnv?: string[];
    tasks?: Record<string, { env?: string[]; passThroughEnv?: string[] }>;
  };
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const decls: TurboDecl[] = [];
  for (const name of parsed.globalEnv ?? []) {
    decls.push({ name, path });
  }
  for (const name of parsed.globalPassThroughEnv ?? []) {
    decls.push({ name, path });
  }
  for (const task of Object.values(parsed.tasks ?? {})) {
    for (const name of task.env ?? []) {
      decls.push({ name, path });
    }
    for (const name of task.passThroughEnv ?? []) {
      decls.push({ name, path });
    }
  }
  return decls;
};

/** Wrangler bindings (r2_buckets, ai, images) plus declared vars. */
export const extractWranglerDecls = (content: string): string[] => {
  const names: string[] = [];
  const bindingRe = /"binding"\s*:\s*"([A-Za-z_][A-Za-z0-9_]*)"/g;
  for (const match of content.matchAll(bindingRe)) {
    names.push(match[1]);
  }
  const varsMatch = /"vars"\s*:\s*\{([^}]*)\}/.exec(content);
  if (varsMatch) {
    const keyRe = /"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g;
    for (const key of varsMatch[1].matchAll(keyRe)) {
      names.push(key[1]);
    }
  }
  return names;
};

const DIAGNOSTIC_FILES = ["scripts/doctor.ts", "scripts/setup.ts"];

export const findSecretDiagnostics = (
  path: string,
  content: string
): AuditFinding[] => {
  const findings: AuditFinding[] = [];
  content.split("\n").forEach((line, index) => {
    if (!(line.includes("console.") || line.includes("${"))) {
      return;
    }
    for (const name of SECRET_VAR_NAMES) {
      if (
        line.includes(`process.env.${name}`) ||
        line.includes(`process.env["${name}"]`) ||
        line.includes(`process.env['${name}']`)
      ) {
        findings.push({
          kind: "secret-in-diagnostics",
          name,
          path: `${path}:${index + 1}`,
          detail: "secret value is reachable from diagnostic output",
        });
      }
    }
  });
  return findings;
};

export const auditFiles = (files: Map<string, string>): AuditFinding[] => {
  const findings: AuditFinding[] = [];
  const referenced = new Set<string>();

  for (const [path, content] of files) {
    if (META_FILES.has(path)) {
      continue;
    }
    const ext = path.slice(path.lastIndexOf("."));
    if (DOC_EXTENSIONS.has(ext)) {
      continue;
    }
    if (path.endsWith("turbo.json")) {
      for (const decl of extractTurboDecls(content, path)) {
        if (decl.name.includes("*")) {
          findings.push({
            kind: "turbo-wildcard",
            name: decl.name,
            path,
            detail: "wildcard Turbo env declaration; declare exact names",
          });
          continue;
        }
        referenced.add(decl.name);
        if (
          !(ENV_VAR_NAMES.has(decl.name) || isPlatformVar(decl.name)) ||
          isDeletedAlias(decl.name)
        ) {
          findings.push({
            kind: isDeletedAlias(decl.name) ? "deleted-alias" : "undeclared",
            name: decl.name,
            path,
            detail: "Turbo env declaration is not in the contract",
          });
        }
      }
      continue;
    }
    if (path.endsWith("wrangler.jsonc") || path.endsWith("wrangler.json")) {
      for (const name of extractWranglerDecls(content)) {
        referenced.add(name);
        if (
          !(ENV_VAR_NAMES.has(name) || isPlatformVar(name)) ||
          isDeletedAlias(name)
        ) {
          findings.push({
            kind: isDeletedAlias(name) ? "deleted-alias" : "undeclared",
            name,
            path,
            detail: "Worker binding or var is not in the contract",
          });
        }
      }
      continue;
    }
    if (path.startsWith(".github/workflows/")) {
      const { secrets, vars } = extractWorkflowRefs(content);
      for (const use of [...secrets, ...vars]) {
        referenced.add(use.name);
        if (
          !(ENV_VAR_NAMES.has(use.name) || isPlatformVar(use.name)) ||
          isDeletedAlias(use.name)
        ) {
          findings.push({
            kind: isDeletedAlias(use.name) ? "deleted-alias" : "undeclared",
            name: use.name,
            path: `${path}:${use.line}`,
            detail: "workflow secrets/vars reference is not in the contract",
          });
        }
      }
      for (const use of extractWorkflowEnvKeys(content)) {
        referenced.add(use.name);
        if (isDeletedAlias(use.name)) {
          findings.push({
            kind: "deleted-alias",
            name: use.name,
            path: `${path}:${use.line}`,
            detail: "deleted alias set in a workflow env block",
          });
        }
      }
      for (const use of extractGithubEnvWrites(content)) {
        referenced.add(use.name);
      }
      continue;
    }
    const uses =
      ext === ".sh"
        ? extractShellUses(content)
        : [...extractCodeUses(content), ...extractTypedEnvUses(content)];
    for (const use of uses) {
      referenced.add(use.name);
      if (isDeletedAlias(use.name)) {
        findings.push({
          kind: "deleted-alias",
          name: use.name,
          path: `${path}:${use.line}`,
          detail: "deleted alias is referenced again",
        });
      } else if (!(ENV_VAR_NAMES.has(use.name) || isPlatformVar(use.name))) {
        findings.push({
          kind: "undeclared",
          name: use.name,
          path: `${path}:${use.line}`,
          detail: "env read is not in the contract",
        });
      }
    }
    if (DIAGNOSTIC_FILES.includes(path)) {
      findings.push(...findSecretDiagnostics(path, content));
    }
  }

  for (const entry of ENV_CONTRACT) {
    if (entry.implicit || referenced.has(entry.name)) {
      continue;
    }
    findings.push({
      kind: "stale",
      name: entry.name,
      path: "scripts/env-contract.ts",
      detail: `contract entry has no reference (owner ${entry.owners.join(", ")})`,
    });
  }

  return findings.sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      a.path.localeCompare(b.path) ||
      a.name.localeCompare(b.name)
  );
};

const main = (): void => {
  const files = new Map<string, string>();
  for (const rel of listScannedFiles(ROOT)) {
    files.set(rel, readFileSync(join(ROOT, rel), "utf-8"));
  }
  const findings = auditFiles(files);
  if (findings.length === 0) {
    console.log(
      `env-audit: ok (${ENV_CONTRACT.length} contract entries, ${files.size} files scanned).`
    );
    return;
  }
  for (const finding of findings) {
    console.log(
      `✗ [${finding.kind}] ${finding.path} ${finding.name}: ${finding.detail}`
    );
  }
  console.log(`env-audit: ${findings.length} finding(s).`);
  process.exitCode = 1;
};

if (import.meta.main) {
  main();
}
