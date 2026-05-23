import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// `@teak/convex` ships raw `.ts` source files (its package.json exports map
// `"./<name>"` to `"./<name>.ts"`). That works for apps that bundle everything
// (web, mobile, desktop, extension) and for `tsx watch` in dev, but `apps/api`
// is compiled with `tsc` to `dist/` and run with plain Node in production on
// Vercel. Node cannot resolve a `.ts` specifier at runtime, so any
// `from "@teak/convex/..."` import that survives into compiled JS causes the
// serverless function to crash at cold start with ERR_MODULE_NOT_FOUND.
//
// If you need a helper from `@teak/convex` in `apps/api/src`, copy the
// relevant pure logic into `apps/api/src/shared/` instead of importing it.

const SRC_DIR = path.resolve(import.meta.dir);

const collectSourceFiles = (dir: string, acc: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectSourceFiles(full, acc);
      continue;
    }
    if (!entry.endsWith(".ts")) {
      continue;
    }
    if (entry.endsWith(".test.ts")) {
      continue;
    }
    acc.push(full);
  }
  return acc;
};

const IMPORT_PATTERN = /from\s+["']@teak\/convex(?:\/[^"']*)?["']/g;

describe("apps/api runtime dependencies", () => {
  test("no runtime source file imports from @teak/convex", () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_DIR)) {
      const source = readFileSync(file, "utf8");
      if (IMPORT_PATTERN.test(source)) {
        offenders.push(path.relative(SRC_DIR, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
