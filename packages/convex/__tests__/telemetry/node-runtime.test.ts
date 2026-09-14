import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const convexRoot = resolve(import.meta.dirname, "../..");
const repositoryRoot = resolve(convexRoot, "../..");
const readConvexSource = (relativePath: string) =>
  readFileSync(resolve(convexRoot, relativePath), "utf8");

const listDeployableSourceFiles = (
  directory: string,
  relativeDirectory = ""
): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;

    if (entry.isDirectory()) {
      if (
        ["__tests__", "_generated", "node_modules", "types"].includes(
          entry.name
        )
      ) {
        return [];
      }
      return listDeployableSourceFiles(
        resolve(directory, entry.name),
        relativePath
      );
    }

    return /\.(?:js|jsx|ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
      ? [relativePath]
      : [];
  });

// Only value imports cross the runtime boundary at bundle time. Re-export
// barrels (`export ... from`) are excluded: cards.ts re-exports the
// "use node" card/uploadCardAction.ts and production deploys stay green,
// while the value import of telemetry/sentry.ts in auth.ts broke the deploy.
const IMPORT_FROM_RE =
  /import\s[^"']*?\sfrom\s*["']([^"']+)["']|import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

const TYPE_ONLY_RE = /(?:import|export)\s+type\s[^;]*?(?:;|$)/gs;

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"];

// A "use node" directive is the first statement of a module, but license
// headers and doc comments may precede it. Strip leading line and block
// comments (block comments may span lines), then check the first statement.
// Anything after the directive does not matter.
const hasUseNodeDirective = (source: string): boolean => {
  let rest = source;
  for (;;) {
    rest = rest.trimStart();
    if (rest.startsWith("//")) {
      const newline = rest.indexOf("\n");
      if (newline === -1) {
        return false;
      }
      rest = rest.slice(newline + 1);
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/", 2);
      if (end === -1) {
        return false;
      }
      rest = rest.slice(end + 2);
      continue;
    }
    break;
  }
  // The directive must be a standalone expression statement: a continued
  // expression like "use node".trim() is not a directive.
  return /^["']use node["'];?(?=\s|$|\/)/.test(rest);
};

const resolveRelativeImport = (
  importer: string,
  specifier: string
): string[] => {
  const directory = importer.includes("/")
    ? importer.slice(0, importer.lastIndexOf("/"))
    : "";
  const parts = `${directory ? `${directory}/` : ""}${specifier}`
    .split("/")
    .filter((part) => part.length > 0);
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      resolved.pop();
    } else if (part !== ".") {
      resolved.push(part);
    }
  }
  const base = resolved.join("/");
  if (SOURCE_EXTENSIONS.some((extension) => base.endsWith(extension))) {
    return [base];
  }
  return [
    ...SOURCE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...SOURCE_EXTENSIONS.map((ext) => `${base}/index${ext}`),
  ];
};

describe("backend telemetry Node runtime", () => {
  test("recognizes the Node directive prologue", () => {
    for (const source of [
      '"use node";',
      '"use node";\n// trailing comment',
      '"use node"; /* trailing block */',
      '"use node"; /* trailing\nmultiline block */',
      "// doc comment\n\"use node\";",
      '/* header */\n"use node";\n\nexport {};',
      "'use node'",
    ]) {
      expect(hasUseNodeDirective(source)).toBe(true);
    }
    for (const source of [
      'export const x = 1;\n"use node";',
      '// "use node";',
      '/* "use node"; */\nexport {};',
      '"use strict";',
      '"use node".trim();',
    ]) {
      expect(hasUseNodeDirective(source)).toBe(false);
    }
  });

  test("marks every Node-only AI telemetry helper", () => {
    for (const relativePath of [
      "ai/telemetry.ts",
      "workflows/aiMetadata/generators.ts",
      "workflows/aiMetadata/transcript.ts",
    ]) {
      expect(hasUseNodeDirective(readConvexSource(relativePath))).toBe(true);
    }
  });

  test("keeps Node-only helpers out of the default-runtime workflow barrel", () => {
    const source = readConvexSource("workflows/aiMetadata/index.ts");

    expect(source).not.toContain('from "./generators"');
    expect(source).not.toContain('from "./transcript"');
  });

  test("uses Convex-compatible deployable module paths", () => {
    const invalidPaths = listDeployableSourceFiles(convexRoot).filter((path) =>
      path.split("/").some((component) => !/^[A-Za-z0-9_.]+$/.test(component))
    );

    expect(invalidPaths).toEqual([]);
  });

  test("isolate modules never import a \"use node\" module", () => {
    const files = listDeployableSourceFiles(convexRoot);
    const nodeModules = new Set(
      files.filter((path) => hasUseNodeDirective(readConvexSource(path)))
    );

    const offenders: string[] = [];
    for (const path of files) {
      if (nodeModules.has(path)) {
        continue;
      }
      const source = readConvexSource(path).replace(TYPE_ONLY_RE, "");
      for (const match of source.matchAll(IMPORT_FROM_RE)) {
        const specifier = match[1] ?? match[2] ?? match[3];
        if (!specifier?.startsWith(".")) {
          continue;
        }
        const target = resolveRelativeImport(path, specifier).find(
          (candidate) => nodeModules.has(candidate)
        );
        if (target) {
          offenders.push(`${path} imports ${target}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("typechecks regenerated declarations without a hoisted-typescript symlink", () => {
    const workflow = readFileSync(
      resolve(repositoryRoot, ".github/workflows/backend-deploy.yml"),
      "utf8"
    );

    expect(workflow).toContain("bunx convex codegen");
    expect(workflow).toContain("bun run typecheck");
    expect(workflow).toContain("--typecheck disable");
    expect(workflow).not.toContain(
      'ln -s "$GITHUB_WORKSPACE/node_modules/typescript" node_modules/typescript'
    );
    expect(workflow).not.toContain("--typecheck-components");
  });
});
