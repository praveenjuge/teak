#!/usr/bin/env bun
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { auditDotenv, hasDotenvErrors } from "./dotenv-audit.ts";
import { isFrameworkAlias } from "./env-aliases.ts";
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
    | "direct-alias-read";
  name: string;
  path: string;
}

const ALIAS_ACCESSOR_FILES = new Set([
  "apps/web/src/lib/public-env.ts",
  "apps/extension/lib/env.ts",
]);

export const isAliasAccessorPath = (path: string): boolean => {
  if (ALIAS_ACCESSOR_FILES.has(path) || path.startsWith("scripts/")) {
    return true;
  }
  if (path.startsWith("packages/tests/")) {
    return true;
  }
  return (
    path.includes("__tests__") ||
    path.includes("/tests/") ||
    path.includes(".test.") ||
    path.includes(".e2e.")
  );
};

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
  ".next",
  ".vercel",
  "node_modules",
  "dist",
  "build",
  "out",
  ".output",
  "coverage",
  ".e2e",
  "test-results",
  ".state",
  ".tmp",
  ".convex",
  "_generated",
  "ios",
  "android",
]);

const META_FILES = new Set([
  "scripts/env-contract.ts",
  "scripts/env-audit.ts",
  "scripts/env-contract.test.ts",
  "scripts/env-audit.test.ts",
]);

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
const RUBY_ENV_RE =
  /ENV(?:\.fetch\(\s*|\[\s*)["']([A-Za-z_][A-Za-z0-9_]*)["']/g;
const SHELL_VAR_RE =
  /\$\{([A-Za-z_][A-Za-z0-9_]*)[^}]*\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
const SECRETS_REF_RE = /\$\{\{[^}]*?\bsecrets\.([A-Za-z_][A-Za-z0-9_]*)/g;
const VARS_REF_RE = /\$\{\{[^}]*?\bvars\.([A-Za-z_][A-Za-z0-9_]*)/g;
const ENV_BLOCK_KEY_RE = /^\s*env:\s*(?:#.*)?$/;
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
  const isReadBeforeAssignment = (name: string, line: number) => {
    const firstLine = firstAssignLine.get(name);
    return firstLine === undefined || line <= firstLine;
  };
  const externalBrace = new Set<string>();
  const braceRe = /\$\{([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const brace of content.matchAll(braceRe)) {
    if (isReadBeforeAssignment(brace[1], lineOf(brace.index ?? 0))) {
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

const GITHUB_ENV_WRITE_RE =
  /"([A-Za-z_][A-Za-z0-9_]*)=[^"]*"\s*>>\s*"?\$GITHUB_ENV"?/g;

export const extractGithubEnvWrites = (content: string): NameUse[] =>
  collectMatches(content, GITHUB_ENV_WRITE_RE, makeLineOf(content));

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
    if (/^\s*(?:#.*)?$/.test(line)) {
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

const PLATFORM_DIAGNOSTIC_SECRETS = ["GH_TOKEN", "GITHUB_TOKEN"];

const readsSecretValue = (fragment: string, name: string): boolean => {
  if (
    fragment.includes(`process.env.${name}`) ||
    fragment.includes(`process.env["${name}"]`) ||
    fragment.includes(`process.env['${name}']`)
  ) {
    return true;
  }
  return new RegExp(`(?:^|[^\\w$.])env\\??\\.${name}(?![\\w])`).test(fragment);
};

export const findSecretDiagnostics = (
  path: string,
  content: string
): AuditFinding[] => {
  const findings: AuditFinding[] = [];
  const names = [...SECRET_VAR_NAMES, ...PLATFORM_DIAGNOSTIC_SECRETS];
  const lines = content.split("\n");
  const aliases = new Map<string, string>();
  for (const line of lines) {
    const assigned =
      /^(?:.*?\b)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(line);
    if (!assigned) {
      continue;
    }
    const rhs = line.slice(line.indexOf("=", assigned.index) + 1);
    for (const name of names) {
      if (readsSecretValue(rhs, name)) {
        aliases.set(assigned[1], name);
        break;
      }
    }
  }
  lines.forEach((line, index) => {
    if (!(line.includes("console.") || line.includes("${"))) {
      return;
    }
    for (const name of names) {
      if (readsSecretValue(line, name)) {
        findings.push({
          detail: "secret value is reachable from diagnostic output",
          kind: "secret-in-diagnostics",
          name,
          path: `${path}:${index + 1}`,
        });
      }
    }
    for (const [alias, name] of aliases) {
      if (new RegExp(`(^|[^\\w$])${alias}([^\\w$]|$)`).test(line)) {
        findings.push({
          detail: `secret value is reachable from diagnostic output via ${alias}`,
          kind: "secret-in-diagnostics",
          name,
          path: `${path}:${index + 1}`,
        });
        break;
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
    // package.json scripts are shell, like `${DOCS_PORT:-3001}`.
    const uses =
      ext === ".sh" || path.endsWith("package.json")
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
      } else if (isFrameworkAlias(use.name) && !isAliasAccessorPath(path)) {
        findings.push({
          kind: "direct-alias-read",
          name: use.name,
          path: `${path}:${use.line}`,
          detail:
            "generated alias is read outside its workspace accessor; use the accessor instead",
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
  for (const finding of findings) {
    console.log(
      `✗ [${finding.kind}] ${finding.path} ${finding.name}: ${finding.detail}`
    );
  }
  const dotenvFindings = auditDotenv(ROOT);
  for (const finding of dotenvFindings) {
    console.log(
      `${finding.severity === "error" ? "✗" : "~"} [dotenv:${finding.kind}] ${finding.path} ${finding.name}: ${finding.detail}`
    );
  }
  if (findings.length === 0 && dotenvFindings.length === 0) {
    console.log(
      `env-audit: ok (${ENV_CONTRACT.length} contract entries, ${files.size} files scanned).`
    );
    return;
  }
  const failed = findings.length > 0 || hasDotenvErrors(dotenvFindings);
  console.log(
    failed
      ? `env-audit: ${findings.length + dotenvFindings.length} finding(s).`
      : `env-audit: warnings only (${ENV_CONTRACT.length} contract entries, ${files.size} files scanned).`
  );
  process.exitCode = failed ? 1 : 0;
};

if (import.meta.main) {
  main();
}
