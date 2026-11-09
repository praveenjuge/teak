import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../../../..");
const FETCHER_DIR = resolve(import.meta.dir, "..");

const readLines = (file: string) =>
  readFileSync(join(FETCHER_DIR, file), "utf8")
    .split("\n")
    .map((line) => line.trim());

/** Source paths the build stage copies, relative to the repository root. */
const copiedPaths = (): string[] =>
  readLines("Dockerfile")
    .filter((line) => line.startsWith("COPY ") && !line.includes("--from"))
    .flatMap((line) => line.split(/\s+/).slice(1, -1));

/** Paths the build context keeps (`!path` after a leading `*`). */
const contextPaths = (): string[] =>
  readLines("Dockerfile.dockerignore")
    .filter((line) => line.startsWith("!"))
    .map((line) => line.slice(1));

const isUnder = (path: string, roots: string[]) =>
  roots.some((root) => path === root || path.startsWith(`${root}/`));

// The image builds `server.ts` from only the files the Dockerfile copies, so
// a new import from anywhere else breaks only the image build.
test("the fetcher image copies every source file its server imports", async () => {
  const build = await Bun.build({
    entrypoints: [join(FETCHER_DIR, "src/server.ts")],
    metafile: true,
    target: "bun",
  });
  expect(build.success).toBe(true);
  const sources = Object.keys(build.metafile?.inputs ?? {})
    .map((input) => relative(REPO_ROOT, resolve(process.cwd(), input)))
    .filter((path) => !path.includes("node_modules/"));
  expect(sources.length).toBeGreaterThan(0);
  expect(sources.filter((path) => !isUnder(path, copiedPaths()))).toEqual([]);
  expect(sources.filter((path) => !isUnder(path, contextPaths()))).toEqual([]);
});
