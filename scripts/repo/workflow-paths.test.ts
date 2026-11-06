import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = realpathSync(join(import.meta.dir, "../.."));
const WORKFLOWS = join(ROOT, ".github/workflows");

interface Triggers {
  pull_request?: { paths?: string[] };
  push?: { paths?: string[] };
}

const triggers = (name: string): Triggers =>
  (
    Bun.YAML.parse(readFileSync(join(WORKFLOWS, name), "utf8")) as {
      on: Triggers;
    }
  ).on;

/** Every path a workflow's push or pull request trigger filters on. */
const filteredPaths = (name: string): string[] => {
  const on = triggers(name);
  return [
    ...new Set([...(on.push?.paths ?? []), ...(on.pull_request?.paths ?? [])]),
  ];
};

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

/** Every repository file `entries` load through static imports, JSON included. */
const loadedFiles = (entries: string[]): string[] => {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) {
      return;
    }
    seen.add(file);
    if (file.endsWith(".json")) {
      return;
    }
    const source = readFileSync(file, "utf8").replace(/^#!.*\n/, "");
    const imports = transpilerFor(file).scanImports(source);
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
        /\.(?:[cm]?[jt]sx?|json)$/.test(resolved)
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

const glob = (pattern: string, exclude: RegExp = /$^/): string[] =>
  [...new Bun.Glob(pattern).scanSync({ cwd: ROOT })]
    .filter((file) => !exclude.test(file))
    .sort();

/**
 * The code each path-filtered workflow ships or runs, by entry point. A change
 * to any file those entries import must trigger the workflow, or the change
 * never ships (a locale added in packages/i18n once never reached the
 * deployed backend). Workflows that trigger on data rather than code say why.
 */
const CODE_ENTRIES: Record<string, (() => string[]) | string> = {
  "backend-deploy.yml": () => [
    // `convex deploy` bundles every module in packages/convex.
    ...glob(
      "packages/convex/**/*.ts",
      /(^|\/)(node_modules|_generated|__tests__|edge)\/|\.test\.ts$|\.d\.ts$/
    ),
    // The deploy waits for a Core Worker that serves this protocol.
    "scripts/setup/check-files-readiness.ts",
  ],
  "extension-oauth-runtime.yml": () => [
    "packages/tests/e2e.hermetic.config.ts",
    ...glob("packages/tests/src/{auth-runtime,extension}/**/*.e2e.ts"),
    // oauth-runtime.e2e.ts bundles these by path for the page.
    "apps/extension/lib/oauthAuth.ts",
    "apps/extension/lib/captureOwner.ts",
  ],
  "claude-plugin-sync.yml":
    "mirrors plugins/teak as files; it runs no repository code",
  "version-tag.yml":
    "tags a version when a manifest's version changes; the release scripts it runs ship nothing",
};

const pathFiltered = readdirSync(WORKFLOWS)
  .filter((name) => /\.ya?ml$/.test(name))
  .filter((name) => filteredPaths(name).length > 0)
  .sort();

test("every path-filtered workflow names the code it runs", () => {
  expect(pathFiltered).toEqual(Object.keys(CODE_ENTRIES).sort());
});

describe.each(pathFiltered)("%s", (name) => {
  const entries = CODE_ENTRIES[name];
  const paths = filteredPaths(name);

  test("pushes and pull requests filter on the same paths", () => {
    const on = triggers(name);
    if (on.push?.paths && on.pull_request?.paths) {
      expect(on.push.paths).toEqual(on.pull_request.paths);
    }
  });

  test("its own file triggers it", () => {
    if (typeof entries === "string") {
      return;
    }
    expect(uncovered([`.github/workflows/${name}`], paths)).toEqual([]);
  });

  test("covers every file its code imports", () => {
    if (typeof entries === "string") {
      return;
    }
    const files = loadedFiles(entries());
    expect(files.length).toBeGreaterThan(0);
    expect(uncovered(files, paths)).toEqual([]);
  });
});

describe("Extension OAuth Runtime paths", () => {
  const paths = filteredPaths("extension-oauth-runtime.yml");

  test("cover the local actions the workflow runs", () => {
    const text = readFileSync(
      join(WORKFLOWS, "extension-oauth-runtime.yml"),
      "utf8"
    );
    const actions = [...text.matchAll(/uses: \.\/(\S+)/g)].map(
      (match) => `${match[1]}/action.yml`
    );
    expect(actions.length).toBeGreaterThan(0);
    // setup-bun reads the pinned Bun and Node versions from the root manifest.
    expect(uncovered([...actions, "package.json"], paths)).toEqual([]);
  });
});

test("an uncovered import is reported", () => {
  expect(
    uncovered(
      ["apps/extension/lib/a.ts", "scripts/lib/b.ts"],
      ["apps/extension/**"]
    )
  ).toEqual(["scripts/lib/b.ts"]);
});

test("a workspace package import resolves to its source", () => {
  // packages/convex/settings/preferences.ts imports @teak/i18n; the closure
  // must follow the workspace link, or the backend's i18n gap goes unseen.
  expect(
    loadedFiles(["packages/convex/settings/preferences.ts"]).some((file) =>
      file.startsWith("packages/i18n/")
    )
  ).toBe(true);
});
