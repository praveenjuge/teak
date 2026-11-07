import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// Convex loads each module once, in import order. A module that imports
// itself back through others reads its own exports before they exist, and
// the code that ends up in such a loop can't change apart again. Type-only
// imports don't load anything, so they don't count.

const ROOT = resolve(import.meta.dir, "..");
const SKIPPED_DIRECTORIES = new Set([
  "__tests__",
  "_generated",
  "edge",
  "node_modules",
]);

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      return SKIPPED_DIRECTORIES.has(name) ? [] : sourceFiles(path);
    }
    return path.endsWith(".ts") && !path.endsWith(".d.ts") ? [path] : [];
  });

const transpiler = new Bun.Transpiler({ loader: "ts" });

const resolveImport = (from: string, specifier: string): string | null => {
  if (!specifier.startsWith(".")) {
    return null;
  }
  const base = resolve(dirname(from), specifier);
  return (
    [`${base}.ts`, join(base, "index.ts")].find((candidate) =>
      existsSync(candidate)
    ) ?? null
  );
};

const runtimeImportGraph = (): Map<string, string[]> =>
  new Map(
    sourceFiles(ROOT).map((file) => [
      file,
      transpiler
        .scanImports(readFileSync(file, "utf8"))
        .flatMap(({ path }) => resolveImport(file, path) ?? []),
    ])
  );

/** Strongly connected components with more than one module (Tarjan). */
export const importCycles = (graph: Map<string, string[]>): string[][] => {
  let next = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];
  const visit = (node: string) => {
    index.set(node, next);
    low.set(node, next);
    next += 1;
    stack.push(node);
    onStack.add(node);
    for (const target of graph.get(node) ?? []) {
      if (!index.has(target)) {
        visit(target);
        low.set(node, Math.min(low.get(node)!, low.get(target)!));
      } else if (onStack.has(target)) {
        low.set(node, Math.min(low.get(node)!, index.get(target)!));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      let member: string | undefined;
      do {
        member = stack.pop();
        if (member !== undefined) {
          onStack.delete(member);
          component.push(member);
        }
      } while (member !== undefined && member !== node);
      if (component.length > 1) {
        cycles.push(component.map((file) => relative(ROOT, file)).sort());
      }
    }
  };
  for (const node of graph.keys()) {
    if (!index.has(node)) {
      visit(node);
    }
  }
  return cycles;
};

describe("Convex module imports", () => {
  test("finds a loop between modules", () => {
    expect(
      importCycles(
        new Map([
          ["a.ts", ["b.ts"]],
          ["b.ts", ["c.ts"]],
          ["c.ts", ["a.ts"]],
          ["d.ts", ["a.ts"]],
        ])
      )
    ).toEqual([["a.ts", "b.ts", "c.ts"]]);
  });

  test("no module imports itself back at runtime", () => {
    expect(importCycles(runtimeImportGraph())).toEqual([]);
  });
});
