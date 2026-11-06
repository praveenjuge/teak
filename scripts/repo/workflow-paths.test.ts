import { describe, expect, test } from "bun:test";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = realpathSync(join(import.meta.dir, "../.."));

interface Workflow {
  on: { pull_request?: { paths?: string[] }; push?: { paths?: string[] } };
}

const workflow = (name: string): Workflow =>
  Bun.YAML.parse(
    readFileSync(join(ROOT, ".github/workflows", name), "utf8")
  ) as Workflow;

const transpilers = {
  js: new Bun.Transpiler({ loader: "js" }),
  jsx: new Bun.Transpiler({ loader: "jsx" }),
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
};

const transpilerFor = (file: string) => {
  const extension = file.slice(file.lastIndexOf(".") + 1);
  if (extension === "tsx" || extension === "jsx" || extension === "ts") {
    return transpilers[extension];
  }
  return transpilers.js;
};

/** Every repository file `entries` load through static imports. */
const loadedFiles = (entries: string[]): string[] => {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) {
      return;
    }
    seen.add(file);
    const imports = transpilerFor(file).scanImports(readFileSync(file, "utf8"));
    for (const { path } of imports) {
      let resolved: string;
      try {
        resolved = realpathSync(Bun.resolveSync(path, dirname(file)));
      } catch {
        continue;
      }
      if (
        resolved.startsWith(`${ROOT}/`) &&
        !resolved.includes("/node_modules/") &&
        /\.(?:[cm]?[jt]sx?)$/.test(resolved)
      ) {
        visit(resolved);
      }
    }
  };
  for (const entry of entries) {
    visit(join(ROOT, entry));
  }
  return [...seen].map((file) => relative(ROOT, file)).sort();
};

const uncovered = (files: string[], paths: string[]): string[] =>
  files.filter(
    (file) => !paths.some((pattern) => new Bun.Glob(pattern).match(file))
  );

describe("Extension OAuth Runtime paths", () => {
  const { on } = workflow("extension-oauth-runtime.yml");
  const paths = on.pull_request?.paths ?? [];

  test("pushes and pull requests run on the same paths", () => {
    expect(paths.length).toBeGreaterThan(0);
    expect(on.push?.paths).toEqual(paths);
  });

  test("cover every file the hermetic OAuth specs load", () => {
    const specs = [
      ...new Bun.Glob(
        "packages/tests/src/{auth-runtime,extension}/**/*.e2e.ts"
      ).scanSync({ cwd: ROOT }),
    ];
    expect(specs.length).toBeGreaterThan(0);
    const files = loadedFiles([
      "packages/tests/e2e.hermetic.config.ts",
      ...specs,
      // oauth-runtime.e2e.ts bundles these by path for the page.
      "apps/extension/lib/oauthAuth.ts",
      "apps/extension/lib/captureOwner.ts",
    ]);
    expect(uncovered(files, paths)).toEqual([]);
  });

  test("cover the local actions the workflow runs", () => {
    const text = readFileSync(
      join(ROOT, ".github/workflows/extension-oauth-runtime.yml"),
      "utf8"
    );
    const actions = [...text.matchAll(/uses: \.\/(\S+)/g)].map(
      (match) => `${match[1]}/action.yml`
    );
    expect(actions.length).toBeGreaterThan(0);
    // setup-bun reads the pinned Bun and Node versions from the root manifest.
    expect(uncovered([...actions, "package.json"], paths)).toEqual([]);
  });

  test("an uncovered import is reported", () => {
    expect(
      uncovered(["apps/extension/lib/a.ts", "scripts/lib/b.ts"], paths)
    ).toEqual(["scripts/lib/b.ts"]);
  });
});
