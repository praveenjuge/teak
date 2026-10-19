import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
};

function staticTiptapImports(entry: string): string[] {
  const seen = new Set<string>();
  const chains: string[] = [];
  const pending: Array<{ chain: string[]; file: string }> = [
    { chain: [entry], file: entry },
  ];
  for (let next = pending.pop(); next; next = pending.pop()) {
    const { chain, file } = next;
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    const transpiler = file.endsWith(".tsx") ? transpilers.tsx : transpilers.ts;
    for (const { kind, path } of transpiler.scanImports(
      readFileSync(file, "utf8")
    )) {
      if (kind !== "import-statement") {
        continue;
      }
      if (path.startsWith("@tiptap/")) {
        chains.push([...chain, path].join(" -> "));
        continue;
      }
      let resolved: string;
      try {
        resolved = Bun.resolveSync(path, dirname(file));
      } catch {
        continue;
      }
      if (!(resolved.includes("node_modules") || !/\.tsx?$/.test(resolved))) {
        pending.push({ chain: [...chain, resolved], file: resolved });
      }
    }
  }
  return chains;
}

const source = (path: string) => join(import.meta.dir, "../../..", path);

describe("the first page load", () => {
  test.each([
    "screens/CardsScreen.tsx",
    "components/text-editor/noteCapture.ts",
    "components/lazyDialogs.ts",
  ])("%s reaches the rich editor only through a lazy import", (entry) => {
    expect(staticTiptapImports(source(entry))).toEqual([]);
  });

  test("the rich editor itself imports Tiptap, so the check can fail", () => {
    expect(
      staticTiptapImports(
        source("components/text-editor/RichMarkdownEditor.tsx")
      ).length
    ).toBeGreaterThan(0);
  });
});
