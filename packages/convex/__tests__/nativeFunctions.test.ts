import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The Apple and Android apps call Convex functions by their string path
// ("cards:getCard"). Released builds keep calling those paths for as long
// as they are installed, so each one must stay a public function there.

const REPO = resolve(import.meta.dir, "../../..");
const NATIVE_FUNCTION_FILES = [
  "apps/apple/Packages/TeakKit/Sources/TeakCore/Backend/ConvexFunctions.swift",
  "apps/android/core/data/src/main/kotlin/com/praveenjuge/teak/core/data/convex/ConvexFunctions.kt",
];

const FUNCTION_PATH = /ConvexFunction(?:<[^>]*>)?\("([\w/]+):(\w+)"/g;

const nativePaths = (file: string) =>
  [...readFileSync(resolve(REPO, file), "utf8").matchAll(FUNCTION_PATH)].map(
    ([, module, name]) => ({ module: module ?? "", name: name ?? "" })
  );

interface RegisteredFunction {
  isAction?: boolean;
  isMutation?: boolean;
  isPublic?: boolean;
  isQuery?: boolean;
}

describe.each(NATIVE_FUNCTION_FILES)("%s", (file) => {
  const paths = nativePaths(file);

  test("names functions", () => {
    expect(paths.length).toBeGreaterThan(20);
  });

  test.each(
    paths.map(({ module, name }) => [`${module}:${name}`, module, name])
  )("%s is a public Convex function", async (_path, module, name) => {
    const exported = (
      (await import(`../${module}.ts`)) as Record<string, unknown>
    )[name as string] as RegisteredFunction | undefined;
    expect(
      Boolean(
        exported?.isPublic &&
          (exported.isQuery || exported.isMutation || exported.isAction)
      )
    ).toBe(true);
  });
});
